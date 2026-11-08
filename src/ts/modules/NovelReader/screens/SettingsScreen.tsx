import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Video from 'react-native-video';
import {
  ConfigurationError,
  defaultConfig,
  EngineConfig,
  loadConfig,
  saveConfig,
  SettingsGroup,
  validateConfig,
  validateTtsConfig,
} from '../local/config';
import {nativeCall} from '../local/native';
import {callLlm, generateSpeech} from '../local/providers';
import {listAudio} from '../local/repository';
import {clearGeneratedAudio, isGenerationBusy} from '../local/engine';

interface Props {
  canClearStorage: boolean;
  visible: boolean;
  initialGroup?: SettingsGroup;
  onClose: () => void;
  onOpenAudio: () => void;
  onSaved: () => void;
}
const titles: Record<SettingsGroup, string> = {
  llm: '正文解析',
  prescan: '角色预扫描',
  tts: '语音合成',
  generation: '生成与预取',
  advanced: '高级设置',
  storage: '本地存储',
};
const groups = Object.keys(titles) as SettingsGroup[];
type Section =
  | 'llm'
  | 'prescan'
  | 'siliconflow'
  | 'mimoTTS'
  | 'indextts2'
  | 'generation'
  | 'advanced';

/** 覆盖展示以保留阅读页和原生播放会话；保存配置不会发出模型请求。 */
export default function SettingsScreen({
  canClearStorage,
  visible,
  initialGroup,
  onClose,
  onOpenAudio,
  onSaved,
}: Props) {
  const [config, setConfig] = useState<EngineConfig>(defaultConfig);
  const [saved, setSaved] = useState('');
  const [group, setGroup] = useState<SettingsGroup | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState(0);
  const [preview, setPreview] = useState('');
  const dirty = JSON.stringify(config) !== saved;
  useEffect(() => {
    if (!visible) {
      return;
    }
    let live = true;
    setLoading(true);
    setError('');
    setPreview('');
    setGroup(initialGroup || null);
    loadConfig()
      .then(value => {
        if (live) {
          setConfig(value);
          setSaved(JSON.stringify(value));
        }
      })
      .catch(() => {
        if (live) {
          setError('无法读取设置，请确认安装了支持端侧引擎的新版本。');
        }
      })
      .finally(() => {
        if (live) {
          setLoading(false);
        }
      });
    nativeCall<number>('stats')
      .then(value => {
        if (live) {
          setSize(value);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [visible, initialGroup]);
  const leave = () => {
    if (busy) {
      return;
    }
    const action = () => {
      setPreview('');
      if (group) {
        setGroup(null);
      } else {
        onClose();
      }
    };
    if (dirty && saved) {
      Alert.alert('尚未保存', '是否放弃未保存的配置？', [
        {text: '继续编辑', style: 'cancel'},
        {
          text: '放弃',
          style: 'destructive',
          onPress: () => {
            setConfig(JSON.parse(saved));
            action();
          },
        },
      ]);
    } else {
      action();
    }
  };
  const update = (
    section: Section,
    key: string,
    value: string | number | boolean,
  ) =>
    setConfig(current => ({
      ...current,
      [section]: {...current[section], [key]: value},
    }));
  const field = (
    section: Section,
    key: string,
    label: string,
    numeric = false,
    multiline = false,
  ) => {
    const value = (config[section] as unknown as Record<string, unknown>)[key];
    return (
      <View key={`${section}.${key}`} style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          accessibilityLabel={label}
          style={[styles.input, multiline && styles.multiline]}
          value={Number.isNaN(value) ? '' : String(value)}
          onChangeText={text =>
            update(
              section,
              key,
              numeric ? (text === '' ? Number.NaN : Number(text)) : text,
            )
          }
          secureTextEntry={key === 'apiKey'}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={numeric ? 'number-pad' : 'default'}
          multiline={multiline}
        />
        {key.toLowerCase().includes('endpoint') && (
          <Text style={styles.hint}>填写完整请求地址，不会自动追加路径。</Text>
        )}
      </View>
    );
  };
  const modelFields = (
    section: 'llm' | 'prescan' | 'siliconflow' | 'mimoTTS' | 'indextts2',
  ) => (
    <>
      {field(section, 'endpoint', 'API 完整端点')}
      {field(
        section,
        'apiKey',
        section === 'indextts2' ? 'API Key（可选，Bearer 鉴权）' : 'API Key',
      )}
      {section !== 'indextts2' && field(section, 'model', '模型名称')}
    </>
  );
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await saveConfig(config);
      setSaved(JSON.stringify(config));
      onSaved();
      Alert.alert('保存成功', '新任务将使用此配置，进行中的任务不变。');
    } catch (e) {
      if (e instanceof ConfigurationError) {
        setGroup(e.group);
      }
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };
  const performTest = async (speech: boolean) => {
    setBusy(true);
    setError('');
    setPreview('');
    try {
      validateConfig(config);
      const signal = new AbortController().signal;
      if (speech) {
        const records = (await listAudio()).filter(record => !record.disabled);
        if (!records.length) {
          throw new Error('请先在音色库导入参考录音。');
        }
        const testConfig = {...config};
        validateTtsConfig(testConfig);
        const uri = await generateSpeech(
          {
            type: 'narration',
            role: '旁白',
            emotion: 'neutral',
            text: '你好，欢迎使用多角色听书。',
            referenceAudio: {id: records[0].id, mode: 1},
          },
          testConfig,
          {},
          signal,
        );
        setPreview(uri);
      } else {
        const model =
          group === 'prescan'
            ? config.prescan.independent
              ? config.prescan
              : {...config.llm, model: config.prescan.model || config.llm.model}
            : config.llm;
        if (
          !model.apiKey.trim() ||
          !model.model.trim() ||
          !model.endpoint.trim()
        ) {
          throw new Error('请先填写地址、API Key 和模型。');
        }
        await callLlm(
          model,
          '请返回严格 JSON 对象：{"ok":true}',
          '测试连接',
          config.advanced.llmTimeout,
          signal,
          group === 'prescan' ? '预扫描配置测试' : '正文解析配置测试',
        );
        Alert.alert('测试成功', '解析服务返回了有效 JSON。');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '测试失败');
    } finally {
      setBusy(false);
    }
  };
  const test = (speech: boolean) =>
    Alert.alert(
      '模型调用测试',
      speech
        ? '将使用音色库第一条录音朗读“你好，欢迎使用多角色听书。”，会将参考录音发送至所选服务，可能产生费用。'
        : `将发送“测试连接”，可能产生费用。\n\n地址：${
            group === 'prescan' && config.prescan.independent
              ? config.prescan.endpoint
              : config.llm.endpoint
          }\n模型：${
            group === 'prescan'
              ? config.prescan.model || config.llm.model
              : config.llm.model
          }`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '开始测试',
          onPress: () => {
            void performTest(speech);
          },
        },
      ],
    );
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={leave}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={leave} disabled={busy}>
            <Text style={styles.link}>‹ 返回</Text>
          </TouchableOpacity>
          <Text style={styles.title}>
            {group ? titles[group] : '听书与 API 设置'}
          </Text>
          <TouchableOpacity onPress={save} disabled={busy || loading || !saved}>
            <Text style={styles.link}>{busy ? '处理中' : '保存'}</Text>
          </TouchableOpacity>
        </View>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled">
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            {!group && (
              <>
                {groups.map(item => (
                  <TouchableOpacity
                    key={item}
                    style={styles.row}
                    onPress={() => setGroup(item)}>
                    <Text style={styles.label}>{titles[item]}</Text>
                    <Text style={styles.hint}>›</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => {
                    if (dirty) {
                      Alert.alert('请先保存', '保存或放弃修改后再打开音色库。');
                      return;
                    }
                    onOpenAudio();
                  }}>
                  <Text style={styles.link}>音色库与参考录音 ›</Text>
                </TouchableOpacity>
                <Text style={styles.hint}>
                  模型与 API
                  配置均保存在本机。首次使用请配置正文解析服务（LLM）、语音合成服务（TTS），并导入参考录音以开启多角色智能听书。
                </Text>
              </>
            )}
            {group === 'llm' && (
              <>
                {modelFields('llm')}
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => test(false)}
                  disabled={busy}>
                  <Text style={styles.link}>测试解析</Text>
                </TouchableOpacity>
              </>
            )}
            {group === 'prescan' && (
              <>
                <View style={styles.row}>
                  <Text style={styles.label}>独立配置地址与密钥</Text>
                  <Switch
                    value={config.prescan.independent}
                    onValueChange={value =>
                      update('prescan', 'independent', value)
                    }
                  />
                </View>
                {config.prescan.independent ? (
                  modelFields('prescan')
                ) : (
                  <>
                    <Text style={styles.hint}>
                      地址与密钥共用正文解析服务，模型可单独指定。
                    </Text>
                    {field('prescan', 'model', '预扫描模型')}
                  </>
                )}
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => test(false)}
                  disabled={busy}>
                  <Text style={styles.link}>测试解析</Text>
                </TouchableOpacity>
              </>
            )}
            {group === 'tts' && (
              <>
                {(['siliconflow', 'mimoTTS', 'indextts2'] as const).map(
                  provider => (
                    <TouchableOpacity
                      key={provider}
                      style={styles.row}
                      onPress={() =>
                        setConfig(current => ({...current, provider}))
                      }>
                      <Text style={styles.label}>
                        {provider === 'mimoTTS'
                          ? 'Mimo'
                          : provider === 'siliconflow'
                          ? 'SiliconFlow'
                          : 'IndexTTS2'}
                      </Text>
                      <Text style={styles.link}>
                        {config.provider === provider ? '✓' : ''}
                      </Text>
                    </TouchableOpacity>
                  ),
                )}
                {modelFields(config.provider)}
                {config.provider === 'mimoTTS' && (
                  <>
                    {field(
                      'mimoTTS',
                      'stylePrompt',
                      'Mimo 风格指令（可选）',
                      false,
                      true,
                    )}
                    <Text style={styles.hint}>
                      可留空，不额外指定朗读风格。
                    </Text>
                    {field('mimoTTS', 'sampleRate', 'Mimo PCM 采样率', true)}
                  </>
                )}
                {config.provider === 'siliconflow' &&
                  field('siliconflow', 'uploadEndpoint', '音色上传完整端点')}
                {config.provider === 'indextts2' && (
                  <Text style={styles.hint}>
                    连接你自己的 IndexTTS2 模型服务，模型不在手机运行。
                  </Text>
                )}
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => test(true)}
                  disabled={busy}>
                  <Text style={styles.link}>测试语音</Text>
                </TouchableOpacity>
              </>
            )}
            {group === 'generation' && (
              <>
                {field(
                  'generation',
                  'prescanCount',
                  '预扫描章节数（0–100）',
                  true,
                )}
                {field(
                  'generation',
                  'prefetchCount',
                  '预取章节数（0–20）',
                  true,
                )}
                <View style={styles.row}>
                  <Text style={styles.label}>允许后台生成</Text>
                  <Switch
                    value={config.generation.background}
                    onValueChange={value =>
                      update('generation', 'background', value)
                    }
                  />
                </View>
                <Text style={styles.hint}>
                  后台执行受系统限制；任务中断后保留已生成片段。
                </Text>
              </>
            )}
            {group === 'advanced' && (
              <>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => setExpanded(!expanded)}>
                  <Text style={styles.link}>
                    {expanded ? '收起高级参数' : '展开高级参数'}
                  </Text>
                </TouchableOpacity>
                {expanded && (
                  <>
                    {field(
                      'advanced',
                      'llmTimeout',
                      '解析等待数据超时（毫秒）',
                      true,
                    )}
                    {field(
                      'advanced',
                      'ttsTimeout',
                      '语音生成超时（毫秒）',
                      true,
                    )}
                    {field(
                      'advanced',
                      'coreMinChapters',
                      '核心角色最少章节数',
                      true,
                    )}
                    {field(
                      'advanced',
                      'coreMinDialogues',
                      '核心角色最少对白数',
                      true,
                    )}
                    {field(
                      'advanced',
                      'temporaryMaxChapters',
                      '临时角色最多章节数',
                      true,
                    )}
                    {field(
                      'advanced',
                      'temporaryMaxDialogues',
                      '临时角色最多对白数',
                      true,
                    )}
                  </>
                )}
              </>
            )}
            {group === 'storage' && (
              <>
                <Text style={styles.label}>
                  生成音频占用：{(size / 1024 / 1024).toFixed(1)} MB
                </Text>
                <TouchableOpacity
                  style={styles.button}
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      '清理生成音频',
                      '将清理本机生成音频，参考录音和阅读进度保留。请先停止播放与生成。',
                      [
                        {text: '取消', style: 'cancel'},
                        {
                          text: '清理',
                          style: 'destructive',
                          onPress: async () => {
                            if (!canClearStorage || isGenerationBusy()) {
                              setError('请先停止播放和生成任务，再清理音频。');
                              return;
                            }
                            setBusy(true);
                            try {
                              await clearGeneratedAudio();
                              setSize(await nativeCall<number>('stats'));
                            } catch (_) {
                              setError('清理失败，请停止播放与生成后重试。');
                            } finally {
                              setBusy(false);
                            }
                          },
                        },
                      ],
                    )
                  }>
                  <Text style={styles.link}>清理生成音频</Text>
                </TouchableOpacity>
              </>
            )}
            {dirty && !!saved && (
              <Text style={styles.hint}>有未保存的修改</Text>
            )}
          </ScrollView>
        )}
        {!!preview && (
          <Video
            source={{uri: preview}}
            playInBackground={false}
            onEnd={() => setPreview('')}
            onError={() => {
              setPreview('');
              setError('测试音频播放失败');
            }}
            style={styles.video}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F8F6F0'},
  header: {
    height: 56,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {fontSize: 20, fontWeight: '700', color: '#1C1917'},
  content: {padding: 18, paddingBottom: 60},
  row: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 18,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EFECE6',
  },
  label: {fontSize: 16, color: '#1C1917', marginBottom: 6},
  link: {fontSize: 16, color: '#B45309', fontWeight: '600'},
  hint: {fontSize: 13, lineHeight: 21, color: '#78716C', marginTop: 6},
  field: {marginBottom: 18},
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#D1D1D6',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#1C1C1E',
    minHeight: 48,
  },
  multiline: {minHeight: 120, textAlignVertical: 'top'},
  button: {
    padding: 16,
    backgroundColor: '#FFF',
    borderRadius: 12,
    marginVertical: 12,
  },
  error: {color: '#B42318', marginBottom: 18, lineHeight: 22},
  video: {width: 1, height: 1},
});

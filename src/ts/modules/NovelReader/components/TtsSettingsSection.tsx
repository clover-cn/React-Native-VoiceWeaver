import React, {useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  BystanderMode,
  DEFAULT_BYSTANDER_MODEL,
  DEFAULT_MIMO_ENDPOINT,
  EngineConfig,
  TtsProvider,
} from '../local/config';

const BYSTANDER_MODES: {value: BystanderMode; label: string}[] = [
  {value: 'voiceDesign', label: '文本生成'},
  {value: 'audioPool', label: '音频路人池'},
];

type Section =
  | 'llm'
  | 'prescan'
  | 'siliconflow'
  | 'mimoTTS'
  | 'indextts2'
  | 'generation'
  | 'advanced';

interface Props {
  config: EngineConfig;
  update: (
    section: Section,
    key: string,
    value: string | number | boolean,
  ) => void;
  setConfig: React.Dispatch<React.SetStateAction<EngineConfig>>;
  onTest: () => void;
  busy: boolean;
}

export interface ProviderMeta {
  key: TtsProvider | string;
  name: string;
  subName: string;
  tag: string;
  code: string;
  desc: string;
}

/**
 * 语音合成服务商元数据列表
 * 未来若增加新的服务商（如 EdgeTTS、Azure、GPT-SoVITS 等），只需在此数组追加即可自适应支持
 */
export const TTS_PROVIDERS: ProviderMeta[] = [
  {
    key: 'siliconflow',
    name: 'SiliconFlow',
    subName: '硅基流动',
    tag: '云端高保真',
    code: 'SF',
    desc: '基于 CosyVoice 等高保真声音复刻模型，支持音色上传与在线云端快速合成。',
  },
  {
    key: 'mimoTTS',
    name: 'MiMo',
    subName: '小米语音',
    tag: '情感风格',
    code: 'MIMO',
    desc: '支持音色克隆与细粒度风格指令，内置支持文本设计的路人角色免配音生成。',
  },
  {
    key: 'indextts2',
    name: 'IndexTTS2',
    subName: '自建私有',
    tag: '本地私有化',
    code: 'IDX',
    desc: '连接您自己部署的 IndexTTS2 离线服务实例，支持 Bearer 鉴权，零外部 API 成本。',
  },
];

/** 具有聚焦高亮与密码显隐切换的表单输入项 */
function FormInputItem({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  isApiKey = false,
  numeric = false,
  multiline = false,
}: {
  label: string;
  value: unknown;
  onChangeText: (text: string) => void;
  placeholder?: string;
  hint?: string;
  isApiKey?: boolean;
  numeric?: boolean;
  multiline?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const displayVal =
    Number.isNaN(value) || value === undefined || value === null
      ? ''
      : String(value);

  return (
    <View style={styles.fieldContainer}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {isApiKey && !!displayVal && (
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowSecret(!showSecret)}
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Text style={styles.eyeBtnText}>
              {showSecret ? '隐藏密钥' : '显示密钥'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View
        style={[
          styles.inputWrapper,
          focused && styles.inputWrapperFocused,
          multiline && styles.inputWrapperMultiline,
        ]}>
        <TextInput
          accessibilityLabel={label}
          style={[
            styles.input,
            multiline && styles.inputMultiline,
            !multiline && !!displayVal && styles.inputWithClear,
          ]}
          value={displayVal}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#A8A29E"
          secureTextEntry={isApiKey && !showSecret}
          autoCapitalize="none"
          autoCorrect={false}
          showSoftInputOnFocus
          keyboardType={numeric ? 'number-pad' : 'default'}
          multiline={multiline}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {!multiline && !!displayVal && (
          <TouchableOpacity
            style={styles.clearBtn}
            accessibilityLabel={`清空${label}`}
            onPress={() => onChangeText('')}
            hitSlop={{top: 4, bottom: 4, left: 4, right: 4}}>
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {!!hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

/** 现代化的语音合成设置组件 */
export default function TtsSettingsSection({
  config,
  update,
  setConfig,
  onTest,
  busy,
}: Props) {
  const currentProvider = config.provider;
  const updateBystander = (fields: Partial<EngineConfig['bystander']>) =>
    setConfig(previous => ({
      ...previous,
      bystander: {...previous.bystander, ...fields},
    }));
  const currentProviderInfo = TTS_PROVIDERS.find(
    p => p.key === currentProvider,
  ) || {
    key: currentProvider,
    name: currentProvider,
    subName: '自定义服务',
    tag: '第三方',
    code: String(currentProvider).slice(0, 3).toUpperCase(),
    desc: '自定义配置的语音合成后端服务。',
  };

  // 获取当前服务商配置对象的字段反射，方便后续动态渲染
  const currentConfigObj = (config[currentProvider] || {}) as Record<
    string,
    unknown
  >;

  const hasModelField = 'model' in currentConfigObj;
  const hasUploadEndpointField = 'uploadEndpoint' in currentConfigObj;
  const hasStylePromptField = 'stylePrompt' in currentConfigObj;
  const hasSampleRateField = 'sampleRate' in currentConfigObj;

  return (
    <View style={styles.container}>
      {/* 模块 1：服务商横向滑动卡片选择器（完美适配后期新增多个服务商） */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>语音合成服务商</Text>
          <Text style={styles.cardSubtitle}>
            选择听书角色朗读与旁白合成所依赖的后端服务
          </Text>
        </View>

        {/* 水平滑动滚动区域，不论后期增加到多少个服务商均可丝滑扩展，绝不挤压变形 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.providerScrollContent}>
          {TTS_PROVIDERS.map(p => {
            const isSelected = currentProvider === p.key;
            return (
              <TouchableOpacity
                key={p.key}
                style={[
                  styles.providerCard,
                  isSelected && styles.providerCardSelected,
                ]}
                activeOpacity={0.8}
                onPress={() =>
                  setConfig(current => ({
                    ...current,
                    provider: p.key as TtsProvider,
                  }))
                }>
                {/* 顶部标签 */}
                <View
                  style={[
                    styles.providerTag,
                    isSelected
                      ? styles.providerTagSelected
                      : styles.providerTagNormal,
                  ]}>
                  <Text
                    style={[
                      styles.providerTagText,
                      isSelected
                        ? styles.providerTagTextSelected
                        : styles.providerTagTextNormal,
                    ]}>
                    {p.tag}
                  </Text>
                </View>

                {/* 服务商主名称 */}
                <Text
                  style={[
                    styles.providerName,
                    isSelected && styles.providerNameSelected,
                  ]}
                  numberOfLines={1}>
                  {p.name}
                </Text>

                {/* 服务商副标题 */}
                <Text
                  style={[
                    styles.providerSubName,
                    isSelected && styles.providerSubNameSelected,
                  ]}
                  numberOfLines={1}>
                  {p.subName}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.providerDescBanner}>
          <Text style={styles.providerDescBannerText}>
            💡 {currentProviderInfo.desc}
          </Text>
        </View>
      </View>

      {/* 模块 2：主服务参数配置卡片（自适应数据驱动） */}
      <View style={styles.card}>
        <View style={styles.cardHeaderWithBadge}>
          <View style={styles.headerLeft}>
            <View style={styles.serviceIcon}>
              <Text style={styles.serviceIconText}>
                {currentProviderInfo.code}
              </Text>
            </View>
            <View style={styles.headerTitleBox}>
              <Text style={styles.cardTitle}>
                {currentProviderInfo.name} 服务配置
              </Text>
              <Text style={styles.cardSubtitle}>主角色与旁白语音合成配置</Text>
            </View>
          </View>
        </View>

        {/* 基础 API 端点 */}
        <FormInputItem
          label="API 完整端点"
          value={currentConfigObj.endpoint}
          placeholder={
            currentProvider === 'siliconflow'
              ? 'https://api.siliconflow.cn/v1/audio/speech'
              : currentProvider === 'mimoTTS'
              ? 'https://api.xiaomimimo.com/v1/chat/completions'
              : currentProvider === 'indextts2'
              ? 'http://192.168.1.100:8000/api/tts/upload'
              : 'https://...'
          }
          hint={
            currentProvider === 'indextts2'
              ? '注意：IndexTTS 完整端点必须以 /api/tts/upload 结尾'
              : '需包含协议与完整路径，系统不会自动追加后缀路径'
          }
          onChangeText={text => update(currentProvider, 'endpoint', text)}
        />

        {/* API Key */}
        <FormInputItem
          label={
            currentProvider === 'indextts2'
              ? 'API Key（可选，Bearer 鉴权）'
              : 'API Key'
          }
          value={currentConfigObj.apiKey}
          placeholder={
            currentProvider === 'indextts2'
              ? '未启用安全认证时可留空'
              : 'sk-...'
          }
          isApiKey
          onChangeText={text => update(currentProvider, 'apiKey', text)}
        />

        {/* 模型名称（根据字段存在性自适应展示） */}
        {hasModelField && (
          <FormInputItem
            label="模型名称"
            value={currentConfigObj.model}
            placeholder={
              currentProvider === 'siliconflow'
                ? '例如 FunAudioLLM/CosyVoice2-0.5B'
                : 'mimo-v2.5-tts-voiceclone'
            }
            hint={
              currentProvider === 'siliconflow'
                ? '可在 SiliconFlow 控制台复制您期望调用的语音模型标识'
                : undefined
            }
            onChangeText={text => update(currentProvider, 'model', text)}
          />
        )}

        {/* 音色上传端点（根据字段存在性自适应展示） */}
        {hasUploadEndpointField && (
          <FormInputItem
            label="音色上传完整端点"
            value={currentConfigObj.uploadEndpoint}
            placeholder="https://api.siliconflow.cn/v1/uploads/audio/voice"
            hint="用于将参考录音上传至音色库，默认通常无需修改"
            onChangeText={text =>
              update(currentProvider, 'uploadEndpoint', text)
            }
          />
        )}

        {/* 风格指令（根据字段存在性自适应展示） */}
        {hasStylePromptField && (
          <FormInputItem
            label="风格指令（可选）"
            value={currentConfigObj.stylePrompt}
            placeholder="例如：声音沉稳、富有感染力，语速适中（可留空）"
            hint="可通过自然语言设定朗读时的语气、情感与角色氛围"
            multiline
            onChangeText={text => update(currentProvider, 'stylePrompt', text)}
          />
        )}

        {/* 采样率（根据字段存在性自适应展示） */}
        {hasSampleRateField && (
          <FormInputItem
            label="PCM 采样率"
            value={currentConfigObj.sampleRate}
            placeholder="24000"
            numeric
            hint="合成音频采样率（Hz），默认推荐 24000"
            onChangeText={text =>
              update(
                currentProvider,
                'sampleRate',
                text === '' ? Number.NaN : Number(text),
              )
            }
          />
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>路人配音</Text>
        </View>
        <View style={styles.bystanderModes} accessibilityRole="radiogroup">
          {BYSTANDER_MODES.map(({value, label}) => {
            const selected = config.bystander.mode === value;
            return (
              <TouchableOpacity
                key={value}
                accessibilityRole="radio"
                accessibilityState={{checked: selected}}
                style={[styles.bystanderMode, selected && styles.providerCardSelected]}
                onPress={() => updateBystander({mode: value})}>
                <Text style={[styles.providerName, selected && styles.providerNameSelected]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {config.bystander.mode === 'audioPool' ? (
          <Text style={styles.cardSubtitle}>
            优先从路人池选择参考录音，使用 {currentProviderInfo.name} 合成。
          </Text>
        ) : (
          <>
            <Text style={styles.cardSubtitle}>文本合成服务商：MiMo</Text>
            <FormInputItem
              label="路人配音模型"
              value={config.bystander.model}
              placeholder={DEFAULT_BYSTANDER_MODEL}
              onChangeText={model => updateBystander({model})}
            />
            <FormInputItem
              label="路人配音 API 完整端点"
              value={config.bystander.endpoint}
              placeholder={DEFAULT_MIMO_ENDPOINT}
              onChangeText={endpoint => updateBystander({endpoint})}
            />
            <FormInputItem
              label="路人配音 API Key"
              value={config.bystander.apiKey}
              placeholder="sk-..."
              isApiKey
              onChangeText={apiKey => updateBystander({apiKey})}
            />
            <FormInputItem
              label="路人配音 PCM 采样率"
              value={config.bystander.sampleRate}
              placeholder="24000"
              numeric
              onChangeText={text =>
                updateBystander({sampleRate: text === '' ? Number.NaN : Number(text)})
              }
            />
          </>
        )}
      </View>

      {/* 模块 4：测试与连通性验证卡片 */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>语音合成连通性测试</Text>
          <Text style={styles.cardSubtitle}>
            使用音色库第 1 条参考录音向当前服务发送试听请求
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.testBtn, busy && styles.testBtnDisabled]}
          disabled={busy}
          activeOpacity={0.8}
          onPress={onTest}>
          {busy ? (
            <View style={styles.testBtnContent}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.testBtnText}>正在请求语音合成服务...</Text>
            </View>
          ) : (
            <View style={styles.testBtnContent}>
              <Text style={styles.testBtnText}>测试语音合成</Text>
            </View>
          )}
        </TouchableOpacity>

        <Text style={styles.testHint}>
          💡
          测试会朗读“你好，欢迎使用多角色听书。”，参考录音将发送至所选服务，可能会产生微量调用费用。
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    marginBottom: 4,
  },
  cardHeader: {
    marginBottom: 14,
  },
  cardHeaderWithBadge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerTitleBox: {
    flex: 1,
  },
  serviceIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF3C7',
  },
  serviceIconText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1917',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#78716C',
    marginTop: 2,
  },
  providerScrollContent: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 2,
    marginBottom: 12,
  },
  providerCard: {
    width: 114,
    backgroundColor: '#FAFAF9',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderColor: '#E7E5E4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerCardSelected: {
    backgroundColor: '#FFFBEB',
    borderColor: '#B45309',
    shadowColor: '#B45309',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  providerTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 6,
  },
  providerTagNormal: {
    backgroundColor: '#F5F5F4',
  },
  providerTagSelected: {
    backgroundColor: '#FEF3C7',
  },
  providerTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  providerTagTextNormal: {
    color: '#78716C',
  },
  providerTagTextSelected: {
    color: '#B45309',
  },
  providerName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#292524',
    textAlign: 'center',
  },
  providerNameSelected: {
    color: '#92400E',
  },
  providerSubName: {
    fontSize: 11,
    color: '#78716C',
    marginTop: 2,
  },
  providerSubNameSelected: {
    color: '#B45309',
  },
  providerDescBanner: {
    backgroundColor: '#F5F5F4',
    padding: 10,
    borderRadius: 8,
  },
  providerDescBannerText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#57534E',
  },
  fieldContainer: {
    marginBottom: 14,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#292524',
  },
  eyeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  eyeBtnText: {
    fontSize: 12,
    color: '#B45309',
    fontWeight: '500',
  },
  inputWrapper: {
    justifyContent: 'center',
    backgroundColor: '#FAFAF9',
    borderWidth: 1,
    borderColor: '#D6D3D1',
    borderRadius: 10,
  },
  inputWrapperFocused: {
    borderColor: '#B45309',
    backgroundColor: '#FFFFFF',
  },
  inputWrapperMultiline: {
    minHeight: 88,
  },
  input: {
    minHeight: 44,
    fontSize: 14,
    color: '#1C1917',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inputWithClear: {
    paddingRight: 44,
  },
  inputMultiline: {
    textAlignVertical: 'top',
    minHeight: 86,
  },
  clearBtn: {
    position: 'absolute',
    right: 6,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtnText: {
    fontSize: 12,
    color: '#A8A29E',
  },
  fieldHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#78716C',
    marginTop: 5,
  },
  bystanderModes: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  bystanderMode: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E7E5E4',
    backgroundColor: '#FAFAF9',
  },
  testBtn: {
    backgroundColor: '#B45309',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B45309',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  testBtnDisabled: {
    backgroundColor: '#D6D3D1',
    shadowOpacity: 0,
    elevation: 0,
  },
  testBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  testBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  testHint: {
    fontSize: 12,
    lineHeight: 18,
    color: '#78716C',
    marginTop: 10,
    textAlign: 'center',
  },
});

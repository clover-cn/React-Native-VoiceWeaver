import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  AppState,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  DeviceEventEmitter,
} from 'react-native';
import {WebView} from 'react-native-webview';
import Video from 'react-native-video';
import {VOICE_GRAPH_HTML} from './voiceGraphHtml';
import {voiceGraphService} from '../local/voiceGraphService';
import {subscribeTasks} from '../local/engine';
import {VoiceGraphRequest} from '../local/voiceGraph';
import VideoPlayerController from '../controllers/VideoPlayerController';

interface Props {
  visible: boolean;
  projectName: string;
  chapterIndex: number;
  playingIndex: number;
  isPlaying: boolean;
  onClose: () => void;
}
const source = {html: VOICE_GRAPH_HTML, baseUrl: 'about:blank'};

/** 本地网页只负责手势与展示；文件、保存和生成均经受校验的应用接口。 */
export default function VoiceAssignmentGraph({
  visible,
  projectName,
  chapterIndex,
  playingIndex,
  isPlaying,
  onClose,
}: Props) {
  const web = useRef<WebView>(null);
  const session = useRef(0);
  const loaded = useRef(false);
  const saving = useRef(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageStatus, setPageStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [pageError, setPageError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active',
  );
  const post = useCallback((message: object) => {
    if (!loaded.current) return;
    const json = JSON.stringify(message)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    web.current?.injectJavaScript(
      'window.voiceGraphReceive(' + json + ');true;',
    );
  }, []);
  const refresh = useCallback(async () => {
    const epoch = session.current;
    try {
      const data = await voiceGraphService.snapshot(projectName);
      if (epoch === session.current && visible) post({type: 'snapshot', data});
    } catch (error) {
      if (epoch === session.current)
        post({
          type: 'error',
          message: error instanceof Error ? error.message : '读取分配失败',
        });
    }
  }, [post, projectName, visible]);
  const invalidateSession = useCallback(() => {
    session.current++;
    loaded.current = false;
  }, []);
  useEffect(() => {
    invalidateSession();
    setPreview(null);
    setBusy(false);
    setPageStatus('loading');
    setPageError('');
    return invalidateSession;
  }, [visible, projectName, reloadKey, invalidateSession]);
  useEffect(() => {
    if (!visible || pageStatus !== 'loading') return;
    const timer = setTimeout(() => {
      if (!loaded.current) {
        setPageError(
          '分配图未能完成初始化，请重新加载。无需重新生成小说音频。',
        );
        setPageStatus('error');
      }
    }, 12000);
    return () => clearTimeout(timer);
  }, [visible, projectName, reloadKey, pageStatus]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state !== 'active') setPreview(null);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    post({
      type: 'runtime',
      data: {
        chapter: chapterIndex,
        index: playingIndex,
        playing: isPlaying,
        active: visible && foreground,
        busy,
      },
    });
  }, [post, chapterIndex, playingIndex, isPlaying, visible, foreground, busy]);
  useEffect(() => {
    if (!visible) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
      }, 180);
    };
    const unsubscribe = subscribeTasks(task => {
      if (task.projectName === projectName) schedule();
    });
    const sub = DeviceEventEmitter.addListener(
      'VoiceWeaverBindingsChanged',
      event => {
        if (event.projectName === projectName) schedule();
      },
    );
    return () => {
      unsubscribe();
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, [visible, projectName, refresh]);
  const close = useCallback(() => {
    setPreview(null);
    onClose();
  }, [onClose]);
  const requestClose = useCallback(() => {
    if (saving.current) return;
    if (loaded.current) post({type: 'closeRequest'});
    else close();
  }, [post, close]);
  const onMessage = useCallback(
    async (raw: string) => {
      if (!visible || raw.length > 512000) return;
      const epoch = session.current;
      const current = () => epoch === session.current;
      try {
        const message = JSON.parse(raw) as {type: string; payload?: any};
        const payload = message.payload || {};
        switch (message.type) {
          case 'ready':
            loaded.current = true;
            setPageStatus('ready');
            post({
              type: 'runtime',
              data: {
                chapter: chapterIndex,
                index: playingIndex,
                playing: isPlaying,
                active: foreground,
                busy,
              },
            });
            await refresh();
            break;
          case 'refresh':
            await refresh();
            break;
          case 'close':
            close();
            break;
          case 'confirmClose':
            Alert.alert(
              '放弃未保存分配？',
              '节点布局已保存，音色分配草稿尚未生效。',
              [
                {text: '继续编辑', style: 'cancel'},
                {text: '放弃草稿', style: 'destructive', onPress: close},
              ],
            );
            break;
          case 'layout':
            await voiceGraphService.saveLayout(
              projectName,
              payload.positions,
              payload.revision,
            );
            break;
          case 'previewAudio': {
            if (typeof payload.audioId !== 'string')
              throw new Error('无效的音频标识。');
            const uri = await voiceGraphService.audioUri(payload.audioId);
            if (current()) {
              VideoPlayerController.pause();
              setPreview(uri);
            }
            break;
          }
          case 'save': {
            if (saving.current || busy) return;
            const request = payload as VoiceGraphRequest;
            const impact = await voiceGraphService.preview(
              projectName,
              request,
            );
            if (!current()) return;
            Alert.alert(
              '确认保存音色分配',
              '影响 ' +
                impact.roles.length +
                ' 个角色、' +
                impact.emotions.length +
                ' 种情绪、' +
                impact.chapters.length +
                ' 个章节、' +
                impact.segments +
                ' 个片段；保留 ' +
                impact.exceptions +
                ' 个片段特例。\n保存后需要手动重新生成。',
              [
                {text: '继续编辑', style: 'cancel'},
                {
                  text: '保存分配',
                  onPress: () => {
                    if (!current() || saving.current) return;
                    saving.current = true;
                    void voiceGraphService
                      .save(projectName, request)
                      .then(() => {
                        if (current()) post({type: 'saved'});
                      })
                      .catch(error => {
                        if (current())
                          post({
                            type: 'error',
                            message: error.message || '保存失败',
                          });
                      })
                      .finally(() => {
                        saving.current = false;
                      });
                  },
                },
              ],
            );
            break;
          }
          case 'regenerate': {
            if (busy || saving.current) return;
            const chapter = payload.chapter;
            if (
              chapter !== undefined &&
              (!Number.isInteger(chapter) ||
                chapter < 0 ||
                chapter !== chapterIndex)
            )
              throw new Error('章节标识无效。');
            setPreview(null);
            VideoPlayerController.pause();
            setBusy(true);
            try {
              await voiceGraphService.regenerate(projectName, chapter);
            } finally {
              if (current()) {
                setBusy(false);
                await refresh();
              }
            }
            break;
          }
          default:
            throw new Error('不支持的关系图操作。');
        }
      } catch (error) {
        if (current())
          post({
            type: 'error',
            message:
              error instanceof Error ? error.message : '操作失败，请刷新重试',
          });
      }
    },
    [
      visible,
      projectName,
      chapterIndex,
      playingIndex,
      isPlaying,
      foreground,
      busy,
      post,
      refresh,
      close,
    ],
  );
  if (!visible) return null;
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={requestClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={requestClose}
            accessibilityLabel="关闭音色分配图">
            <Text style={styles.back}>‹ 返回听书</Text>
          </TouchableOpacity>
          <Text style={styles.caption}>
            {busy ? '正在重新生成…' : '本机音色管理'}
          </Text>
        </View>
        <WebView
          key={projectName + ':' + reloadKey}
          ref={web}
          source={source}
          onLoad={() => {
            web.current?.injectJavaScript(
              'window.voiceGraphAnnounceReady && window.voiceGraphAnnounceReady();true;',
            );
          }}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={request =>
            request.url === 'about:blank' ||
            request.url.startsWith('data:text/html')
          }
          onMessage={event => {
            void onMessage(event.nativeEvent.data);
          }}
          javaScriptEnabled
          domStorageEnabled={false}
          allowFileAccess={false}
          mixedContentMode="never"
          setSupportMultipleWindows={false}
          onError={event => {
            setPageError(
              event.nativeEvent.description || '本地分配图加载失败。',
            );
            setPageStatus('error');
          }}
          containerStyle={styles.web}
          style={styles.web}
        />
        {pageStatus !== 'ready' ? (
          <View style={styles.pageStatus}>
            <Text style={styles.caption}>
              {pageStatus === 'loading' ? '正在加载本地音色分配图…' : pageError}
            </Text>
            {pageStatus === 'error' ? (
              <TouchableOpacity
                onPress={() => setReloadKey(value => value + 1)}>
                <Text style={styles.back}>重新加载分配图</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
        {preview && visible && foreground ? (
          <View style={styles.preview}>
            <Text style={styles.caption}>参考录音试听 · 小说播放已暂停</Text>
            <TouchableOpacity onPress={() => setPreview(null)}>
              <Text style={styles.back}>停止试听</Text>
            </TouchableOpacity>
            <Video
              key={preview}
              source={{uri: preview}}
              paused={false}
              playInBackground={false}
              playWhenInactive={false}
              onEnd={() => setPreview(null)}
              onError={() => {
                setPreview(null);
                Alert.alert('试听失败', '请检查参考录音是否有效。');
              }}
              style={styles.player}
            />
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#F5F3ED'},
  header: {
    height: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {fontSize: 15, color: '#98551D', paddingVertical: 8},
  caption: {fontSize: 12, color: '#77756E'},
  web: {flex: 1, backgroundColor: '#F5F3ED'},
  pageStatus: {
    position: 'absolute',
    top: 70,
    left: 24,
    right: 24,
    padding: 16,
    backgroundColor: '#FFFDF8',
    borderRadius: 12,
    alignItems: 'center',
  },
  preview: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#EAF1ED',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  player: {width: 1, height: 1, position: 'absolute'},
});

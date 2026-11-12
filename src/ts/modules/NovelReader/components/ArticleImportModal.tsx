import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {WebView} from 'react-native-webview';
import {AppImages} from '../../../../assets';
import {MAX_ARTICLE_LENGTH, normalizeArticleUrl} from '../utils/article';
import {
  browserArticleScript,
  browserReadyScript,
  parseBrowserArticle,
} from '../utils/browserArticle';
import {loadConfig} from '../local/config';
import {cleanArticleText} from '../local/articleCleaning';
import ArticleVoicePicker from './ArticleVoicePicker';
import {AudioOption} from '../types/audio';
import {
  deleteLocalTxtBookFile,
  importLocalTxtBook,
  readLocalTxtBookContent,
} from '../utils/localBookStorage';

interface Props {
  visible?: boolean;
  onOpenSettings: () => void;
  onClose: () => void;
  onSave: (
    title: string,
    text: string,
    sourceUrl: string | undefined,
    play: boolean,
    referenceAudioId?: string,
  ) => Promise<void>;
}

/** 浏览器提取全部可见文字，经模型筛选原文段落后由用户编辑确认。 */
export default function ArticleImportModal({
  visible = true,
  onClose,
  onSave,
  onOpenSettings,
}: Props) {
  const web = useRef<WebView>(null);
  const mounted = useRef(true);
  const request = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pageTimer = useRef<ReturnType<typeof setTimeout>>();
  const pageProbe = useRef<ReturnType<typeof setInterval>>();
  const pageProbeId = useRef('');
  const currentUrl = useRef('');
  const remote = useRef<AbortController | null>(null);

  const [address, setAddress] = useState('');
  const [uri, setUri] = useState('');
  const [browserSession, setBrowserSession] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pageError, setPageError] = useState('');
  const [warning, setWarning] = useState('');
  const [textSource, setTextSource] = useState('');
  const [rawText, setRawText] = useState('');
  const [progress, setProgress] = useState('');
  const [paragraphMode, setParagraphMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [voicePickerVisible, setVoicePickerVisible] = useState(false);
  const [referenceAudio, setReferenceAudio] = useState<AudioOption | null>(
    null,
  );

  const paragraphs = text.split(/\n+/).filter(part => part.trim());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      clearTimeout(pageTimer.current);
      clearInterval(pageProbe.current);
      pageProbeId.current = '';
      remote.current?.abort();
    };
  }, []);

  const cancelExtraction = () => {
    clearTimeout(timer.current);
    request.current = '';
    remote.current?.abort();
    remote.current = null;
    setExtracting(false);
    setProgress('');
  };

  const finishPageLoad = () => {
    clearTimeout(pageTimer.current);
    clearInterval(pageProbe.current);
    pageProbe.current = undefined;
    pageProbeId.current = '';
    pageTimer.current = undefined;
    setLoading(false);
  };

  /** 重定向不延长等待时间；缺少完成事件时停止等待并提供恢复入口。 */
  const beginPageLoad = () => {
    setLoading(true);
    setPageError('');
    if (!pageTimer.current) {
      const id = `page_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      pageProbeId.current = id;
      // 部分网页刷新后不回传原生完成事件，主动询问主文档是否已经可读。
      pageProbe.current = setInterval(() => {
        web.current?.injectJavaScript(browserReadyScript(id));
      }, 750);
      pageTimer.current = setTimeout(() => {
        finishPageLoad();
        setPageError(
          '网页加载超时。若正文已显示可继续提取，空白时请点击重试。',
        );
        web.current?.stopLoading();
      }, 30000);
    }
  };

  const reloadPage = () => {
    cancelExtraction();
    finishPageLoad();
    beginPageLoad();
    web.current?.reload();
  };

  /** 失败后重新创建浏览器，清除组件内部残留的加载或错误状态。 */
  const retryPage = () => {
    cancelExtraction();
    finishPageLoad();
    const url = currentUrl.current || uri;
    setUri(url);
    setCanGoBack(false);
    setBrowserSession(value => value + 1);
    beginPageLoad();
  };

  const openBrowser = (input: string) => {
    try {
      const url = normalizeArticleUrl(input);
      cancelExtraction();
      finishPageLoad();
      setEditing(false);
      setPageError('');
      currentUrl.current = url;
      if (url === uri) {
        reloadPage();
      } else {
        beginPageLoad();
        setUri(url);
      }
    } catch (error) {
      Alert.alert('地址无效', (error as Error).message);
    }
  };

  const open = () => openBrowser(address);

  const close = () => {
    cancelExtraction();
    finishPageLoad();
    onClose();
  };

  const cleanPage = async (result: {
    title: string;
    text: string;
    url: string;
  }) => {
    cancelExtraction();
    finishPageLoad();
    const controller = new AbortController();
    remote.current = controller;
    setTitle(result.title);
    setText(result.text);
    setRawText(result.text);
    setSourceUrl(result.url);
    setTextSource('页面全部文字');
    setWarning('尚未完成清洗，当前保留网页原文，可手动删除无关内容。');
    setParagraphMode(false);
    setSelected([]);
    setEditing(true);
    setExtracting(true);
    setProgress('正在连接模型清洗正文…');
    try {
      const config = await loadConfig();
      if (controller.signal.aborted) {
        return;
      }
      const cleaned = await cleanArticleText(
        result.text,
        result.title,
        config,
        controller.signal,
        (done, total) => {
          if (mounted.current && !controller.signal.aborted) {
            setProgress(`正在清洗正文 (${done}/${total})`);
          }
        },
      );
      if (!mounted.current || controller.signal.aborted) {
        return;
      }
      setText(cleaned);
      setTextSource('大模型清洗后的正文');
      setWarning(
        '已按原文顺序保留正文段落。大模型已自动过滤广告与噪音；请核对章节与结尾，如发现误删可点击「恢复原文」。',
      );
    } catch (_) {
      if (mounted.current && !controller.signal.aborted) {
        setWarning(
          '正文清洗失败，请检查正文解析模型配置及网络。当前已保留网页原文，可重试清洗或手动删除段落。',
        );
      }
    } finally {
      if (remote.current === controller) {
        remote.current = null;
        if (mounted.current) {
          setExtracting(false);
          setProgress('');
        }
      }
    }
  };

  const extract = () => {
    cancelExtraction();
    const id = `article_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    request.current = id;
    setExtracting(true);
    timer.current = setTimeout(() => {
      cancelExtraction();
      Alert.alert('提取超时', '请等待网页加载完成后重试，也可以粘贴正文。');
    }, 10000);
    web.current?.injectJavaScript(browserArticleScript(id));
  };

  const importText = async () => {
    cancelExtraction();
    setImporting(true);
    try {
      const imported = await importLocalTxtBook();
      if (!imported) {
        return;
      }
      let content: string;
      try {
        content = await readLocalTxtBookContent(imported.book.localBookId!);
      } finally {
        await deleteLocalTxtBookFile(imported.book.localBookId!);
      }
      if (!mounted.current) {
        return;
      }
      if (content.length > MAX_ARTICLE_LENGTH) {
        throw new Error('文件过大，请分篇导入，每篇不超过 20 万字符。');
      }
      setTitle(imported.fileName.replace(/\.txt$/i, ''));
      setText(content);
      setRawText('');
      setParagraphMode(false);
      setSelected([]);
      setSourceUrl(undefined);
      setWarning('');
      setTextSource('本地 TXT');
      setEditing(true);
    } catch (error) {
      if (mounted.current) {
        Alert.alert('导入失败', (error as Error).message);
      }
    } finally {
      if (mounted.current) {
        setImporting(false);
      }
    }
  };

  const openPasteMode = () => {
    cancelExtraction();
    setTitle('');
    setText('');
    setRawText('');
    setParagraphMode(false);
    setSelected([]);
    setSourceUrl(undefined);
    setWarning('');
    setTextSource('粘贴文字');
    setEditing(true);
  };

  const save = async (play: boolean) => {
    if (saving || extracting) {
      return;
    }
    setSaving(true);
    try {
      await onSave(title, text, sourceUrl, play, referenceAudio?.id);
    } catch (error) {
      if (mounted.current) {
        Alert.alert('保存失败', (error as Error).message);
      }
    } finally {
      if (mounted.current) {
        setSaving(false);
      }
    }
  };

  return (
    <>
      <Modal
        visible={visible && !voicePickerVisible}
        animationType="slide"
        onRequestClose={() => {
          if (!saving && !importing) {
            close();
          }
        }}>
        <SafeAreaView style={styles.root}>
          <StatusBar barStyle="dark-content" backgroundColor="#F8F6F0" />

          {/* 1. 初始导入选择界面 */}
          {!editing && !uri && (
            <View style={styles.flexOne}>
              <View style={styles.header}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="关闭"
                  disabled={saving || importing}
                  onPress={close}
                  style={styles.headerSide}>
                  <Text style={styles.headerLink}>‹ 关闭</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>导入文章</Text>
                <View style={styles.headerSide} />
              </View>

              <ScrollView
                style={styles.scrollBody}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
                {/* 卡片 1: 网页链接导入 */}
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderInfo}>
                      <Text style={styles.cardTitle}>网页文章导入</Text>
                      <Text style={styles.cardSubtitle}>
                        支持各大公众号、新闻与文学网页
                      </Text>
                    </View>
                  </View>

                  <View style={styles.urlInputWrap}>
                    <TextInput
                      style={styles.urlInput}
                      accessibilityLabel="文章网页地址输入框"
                      value={address}
                      onChangeText={value => {
                        cancelExtraction();
                        setAddress(value);
                      }}
                      placeholder="输入或长按粘贴文章 URL (https://...)"
                      placeholderTextColor="#A8A29E"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      onSubmitEditing={open}
                      returnKeyType="go"
                    />
                    {address ? (
                      <TouchableOpacity
                        onPress={() => setAddress('')}
                        hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                        style={styles.clearBtn}>
                        <Image source={AppImages.delete} style={styles.clearBtnIcon} />
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="打开网页"
                    disabled={importing || extracting || !address.trim()}
                    onPress={open}
                    style={[
                      styles.primaryButton,
                      (!address.trim() || importing || extracting) &&
                        styles.disabledButton,
                    ]}>
                    <Text style={styles.primaryButtonText}>开始导入</Text>
                  </TouchableOpacity>
                </View>

                {/* 卡片 2: 其他导入方式 */}
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>其他导入方式</Text>
                </View>
                <View style={styles.quickGrid}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="导入本地 TXT"
                    disabled={importing || extracting}
                    onPress={importText}
                    activeOpacity={0.7}
                    style={styles.quickCard}>
                    <View style={[styles.quickIconBadge, styles.quickIconTxt]}>
                      <Text style={styles.quickIconText}>📄</Text>
                    </View>
                    <Text style={styles.quickTitle}>
                      {importing ? '导入中…' : '本地 TXT'}
                    </Text>
                    <Text style={styles.quickDesc}>
                      导入本地文本文件（≤20万字）
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="粘贴正文"
                    disabled={importing || extracting}
                    onPress={openPasteMode}
                    activeOpacity={0.7}
                    style={styles.quickCard}>
                    <View
                      style={[styles.quickIconBadge, styles.quickIconPaste]}>
                      <Text style={styles.quickIconText}>📋</Text>
                    </View>
                    <Text style={styles.quickTitle}>粘贴正文</Text>
                    <Text style={styles.quickDesc}>
                      直接录入或从剪贴板粘贴文本
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* 卡片 3: 使用指南与说明 */}
                <View style={styles.guideCard}>
                  <Text style={styles.guideTitle}>💡 提取流程与说明</Text>
                  <View style={styles.guideSteps}>
                    <View style={styles.guideStepItem}>
                      <View style={styles.stepNumWrap}>
                        <Text style={styles.stepNumText}>1</Text>
                      </View>
                      <Text style={styles.stepText}>
                        <Text style={styles.stepBold}>打开网页：</Text>
                        输入文章链接并进入内置浏览器载入页面。
                      </Text>
                    </View>
                    <View style={styles.guideStepItem}>
                      <View style={styles.stepNumWrap}>
                        <Text style={styles.stepNumText}>2</Text>
                      </View>
                      <Text style={styles.stepText}>
                        <Text style={styles.stepBold}>展开全文：</Text>
                        若页面有“展开阅读全文”或滚动加载，请先在页面中手动展开。
                      </Text>
                    </View>
                    <View style={styles.guideStepItem}>
                      <View style={styles.stepNumWrap}>
                        <Text style={styles.stepNumText}>3</Text>
                      </View>
                      <Text style={styles.stepText}>
                        <Text style={styles.stepBold}>智能提取去噪：</Text>
                        点击提取文字后，已配置的大模型将自动清洗正文，过滤广告与推荐。
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      cancelExtraction();
                      onOpenSettings();
                    }}
                    style={styles.guideTipBadge}>
                    <Text style={styles.guideTipText}>
                      💡
                      提示：提取与清洗将调用已配置的「正文解析」大模型。若需更改模型或
                      API Key，点击此处前往「解析设置」›
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          )}

          {/* 2. URL 网页浏览与提取界面 */}
          {!editing && Boolean(uri) && (
            <View style={styles.flexOne}>
              <View style={styles.browserHeader}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="换网址"
                  onPress={() => {
                    cancelExtraction();
                    finishPageLoad();
                    setUri('');
                  }}
                  style={styles.browserHeaderAction}>
                  <Text style={styles.headerLink}>‹ 换网址</Text>
                </TouchableOpacity>

                <View style={styles.browserUrlPill}>
                  <Text style={styles.browserUrlIcon}>🌐</Text>
                  <Text
                    style={styles.browserUrlText}
                    numberOfLines={1}
                    ellipsizeMode="middle">
                    {address || uri}
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="刷新网页"
                    onPress={reloadPage}
                    hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                    style={styles.browserReloadBtn}>
                    <Image
                      source={AppImages.refresh}
                      style={styles.browserReloadIcon}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                </View>

                {canGoBack ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="后退"
                    onPress={() => web.current?.goBack()}
                    style={styles.browserHeaderAction}>
                    <Text style={styles.headerLink}>‹ 后退</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* 加载中状态指示条 */}
              {loading ? (
                <View style={styles.pageLoadingBar}>
                  <ActivityIndicator size="small" color="#B45309" />
                  <Text style={styles.pageLoadingText}>网页加载中…</Text>
                </View>
              ) : null}

              {/* 页面加载错误提示 */}
              {pageError ? (
                <View style={styles.pageErrorBar}>
                  <Text style={styles.pageErrorText}>⚠️ {pageError}</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="重试加载网页"
                    onPress={retryPage}>
                    <Text style={styles.pageErrorAction}>重试</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* WebView */}
              <WebView
                key={browserSession}
                ref={web}
                source={{uri}}
                style={styles.webview}
                javaScriptEnabled
                domStorageEnabled
                setSupportMultipleWindows={false}
                allowFileAccess={false}
                mixedContentMode="never"
                originWhitelist={['*']}
                // 使用上方受控加载条，避免内部加载遮罩在重定向后一直覆盖正文。
                renderLoading={() => <View />}
                onShouldStartLoadWithRequest={event =>
                  /^https?:\/\//i.test(event.url)
                }
                onLoadStart={() => {
                  cancelExtraction();
                  beginPageLoad();
                }}
                onNavigationStateChange={state => {
                  if (/^https?:\/\//i.test(state.url)) {
                    currentUrl.current = state.url;
                    setAddress(state.url);
                  }
                  setCanGoBack(Boolean(state.canGoBack));
                  if (state.loading === false) {
                    finishPageLoad();
                  }
                }}
                onLoadProgress={event => {
                  if (event.nativeEvent.progress >= 1) {
                    finishPageLoad();
                  }
                }}
                onLoadEnd={finishPageLoad}
                onError={() => {
                  cancelExtraction();
                  finishPageLoad();
                  setPageError('网页打开失败，请检查网络或切换本地TXT/粘贴。');
                }}
                onHttpError={event => {
                  if (event.nativeEvent.url === currentUrl.current) {
                    finishPageLoad();
                    setPageError(
                      `网页返回错误（${event.nativeEvent.statusCode}），请确认内容是否完整。`,
                    );
                  }
                }}
                onMessage={event => {
                  // 就绪通知与正文提取使用独立标识，未点击提取也要处理就绪消息。
                  if (event.nativeEvent.data.length < 20000) {
                    try {
                      const ready = JSON.parse(event.nativeEvent.data);
                      if (ready.type === 'article_page_ready') {
                        if (
                          pageProbeId.current &&
                          ready.id === pageProbeId.current &&
                          typeof ready.url === 'string' &&
                          /^https?:\/\//i.test(ready.url)
                        ) {
                          currentUrl.current = ready.url;
                          setAddress(ready.url);
                          finishPageLoad();
                        }
                        return;
                      }
                    } catch (_) {
                      // 非就绪通知继续交给原有正文消息校验。
                    }
                  }
                  if (
                    !request.current ||
                    event.nativeEvent.data.length >
                      MAX_ARTICLE_LENGTH * 6 + 10000
                  ) {
                    return;
                  }
                  try {
                    const data = JSON.parse(event.nativeEvent.data);
                    if (
                      data.id !== request.current ||
                      (data.url !== currentUrl.current && !data.error)
                    ) {
                      return;
                    }
                    cancelExtraction();
                    if (data.error) {
                      throw new Error(String(data.error));
                    }
                    const result = parseBrowserArticle(data);
                    cleanPage(result);
                  } catch (error) {
                    cancelExtraction();
                    Alert.alert('提取失败', (error as Error).message);
                  }
                }}
              />

              {/* 底部悬浮提取条 */}
              <View style={styles.browserBottomBar}>
                <Text style={styles.browserTipText}>
                  💡 提示：提取前请先滑动网页、点击“展开全文”，确保正文完整显示
                </Text>

                {extracting ? (
                  <View style={styles.extractingBar}>
                    <ActivityIndicator
                      size="small"
                      color="#FFFFFF"
                      style={styles.extractingIndicator}
                    />
                    <Text style={styles.extractingText}>
                      正在抓取页面文字并准备解析…
                    </Text>
                    <TouchableOpacity
                      onPress={cancelExtraction}
                      style={styles.cancelExtractBtn}>
                      <Text style={styles.cancelExtractText}>取消</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="提取页面全部文字"
                    disabled={loading || extracting || importing}
                    onPress={extract}
                    style={[
                      styles.extractPrimaryBtn,
                      (loading || extracting || importing) &&
                        styles.disabledButton,
                    ]}>
                    <Text style={styles.extractPrimaryBtnText}>
                      ✨ 提取页面全部文字
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* 3. 文章预览与编辑界面 */}
          {editing && (
            <View style={styles.flexOne}>
              {/* 顶栏：参考设置页风格，无额外解析设置，清爽大气 */}
              <View style={styles.header}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={uri ? '返回网页' : '返回'}
                  disabled={saving}
                  onPress={() => {
                    cancelExtraction();
                    setEditing(false);
                  }}
                  style={styles.headerSide}>
                  <Text style={styles.headerLink}>
                    {uri ? '‹ 返回网页' : '‹ 返回'}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.headerTitle}>文章预览与编辑</Text>

                <View style={styles.headerSide} />
              </View>

              {/* 操作工具栏：三等分均匀排布，间隔完全一致 */}
              <View style={styles.toolBar}>
                {rawText ? (
                  <>
                    <TouchableOpacity
                      accessibilityRole="button"
                      disabled={saving || extracting}
                      onPress={() => {
                        setText(rawText);
                        setTextSource('');
                        setWarning('已恢复网页原文，请手动删除无关内容。');
                        setSelected([]);
                      }}
                      style={[styles.toolPillBtn, styles.toolPillBtnWithIcon]}>
                      <Image
                        source={AppImages.refresh}
                        style={styles.toolPillIcon}
                        resizeMode="contain"
                      />
                      <Text style={styles.toolPillBtnText} numberOfLines={1}>
                        恢复原文
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      accessibilityRole="button"
                      disabled={saving || extracting}
                      onPress={() => {
                        cleanPage({title, text: rawText, url: sourceUrl!});
                      }}
                      style={styles.toolPillBtn}>
                      <Text style={styles.toolPillBtnText} numberOfLines={1}>
                        ✨ 重新清洗
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={saving || extracting}
                  onPress={() => {
                    setParagraphMode(!paragraphMode);
                    setSelected([]);
                  }}
                  style={[
                    rawText ? styles.toolPillBtn : styles.toolPillBtnSingle,
                    paragraphMode && styles.toolPillBtnActive,
                  ]}>
                  <Text
                    style={[
                      styles.toolPillBtnText,
                      paragraphMode && styles.toolPillBtnTextActive,
                    ]}
                    numberOfLines={1}>
                    {paragraphMode ? '✍️ 自由编辑' : '✂ 段落编辑'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* 清洗中状态通知 */}
              {extracting ? (
                <View style={styles.cleaningCard}>
                  <ActivityIndicator
                    size="small"
                    color="#B45309"
                    style={styles.cleaningIndicator}
                  />
                  <Text style={styles.cleaningText}>
                    {progress || '正在智能清洗正文…'}
                  </Text>
                  <TouchableOpacity
                    onPress={cancelExtraction}
                    style={styles.cancelCleanBtn}>
                    <Text style={styles.cancelCleanBtnText}>取消</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* 提示与状态横幅：AI已清洗挪至此处，优雅宽敞，消除拥挤感 */}
              {warning ? (
                <View
                  style={[
                    styles.noticeBanner,
                    warning.includes('失败')
                      ? styles.noticeError
                      : styles.noticeInfo,
                  ]}>
                  <View style={styles.noticeBodyRow}>
                    <Text style={styles.noticeIcon}>
                      {warning.includes('失败') ? '⚠️' : '💡'}
                    </Text>
                    <Text
                      style={[
                        styles.noticeText,
                        warning.includes('失败')
                          ? styles.noticeTextError
                          : styles.noticeTextInfo,
                      ]}>
                      {warning}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* 内容编辑区域 */}
              <FlatList
                style={styles.editorList}
                contentContainerStyle={styles.editorContent}
                keyboardShouldPersistTaps="handled"
                data={paragraphMode ? paragraphs : []}
                extraData={selected}
                keyExtractor={(_, index) => String(index)}
                renderItem={({item, index}) => {
                  const isChecked = selected.includes(index);
                  return (
                    <TouchableOpacity
                      accessibilityRole="checkbox"
                      accessibilityState={{checked: isChecked}}
                      disabled={saving || extracting}
                      onPress={() =>
                        setSelected(current =>
                          current.includes(index)
                            ? current.filter(id => id !== index)
                            : [...current, index],
                        )
                      }
                      activeOpacity={0.8}
                      style={[
                        styles.paragraphCard,
                        isChecked && styles.paragraphCardSelected,
                      ]}>
                      <View style={styles.paragraphHeader}>
                        <View
                          style={[
                            styles.checkboxCircle,
                            isChecked && styles.checkboxCircleChecked,
                          ]}>
                          {isChecked ? (
                            <Text style={styles.checkboxCheck}>✓</Text>
                          ) : null}
                        </View>
                        <Text style={styles.paragraphIndex}>
                          段落 {index + 1}
                        </Text>
                      </View>
                      <Text style={styles.paragraphText}>{item}</Text>
                    </TouchableOpacity>
                  );
                }}
                ListHeaderComponent={
                  <View style={styles.formSection}>
                    <View style={styles.inputGroup}>
                      <Text style={styles.fieldLabel}>朗读参考音频</Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="选择文章参考音频"
                        disabled={saving || extracting}
                        onPress={() => setVoicePickerVisible(true)}
                        style={styles.articleVoiceRow}>
                        <Text style={styles.articleVoiceName} numberOfLines={1}>
                          {referenceAudio?.name || '默认旁白'}
                        </Text>
                        <Text style={styles.headerLink}>选择 ›</Text>
                      </TouchableOpacity>
                    </View>
                    {/* 标题输入 */}
                    <View style={styles.inputGroup}>
                      <Text style={styles.fieldLabel}>文章标题</Text>
                      <TextInput
                        style={styles.titleInput}
                        accessibilityLabel="文章标题输入框"
                        placeholder="请输入文章标题"
                        placeholderTextColor="#A8A29E"
                        value={title}
                        onChangeText={setTitle}
                        maxLength={200}
                        editable={!saving && !extracting}
                      />
                    </View>

                    {/* 来源 URL 显示 */}
                    {sourceUrl ? (
                      <View style={styles.sourceUrlCard}>
                        <Text style={styles.sourceUrlIcon}>🔗</Text>
                        <Text
                          style={styles.sourceUrlText}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          selectable>
                          来源：{sourceUrl}
                        </Text>
                      </View>
                    ) : null}

                    {/* 模式提示或自由编辑输入框 */}
                    {paragraphMode ? (
                      <View style={styles.paragraphModeHeader}>
                        <View style={styles.paragraphTipWrap}>
                          <Text style={styles.paragraphModeTip}>
                            勾选下方需要删除的段落（如广告、推荐语、冗余版权）：
                          </Text>
                        </View>
                        <View style={styles.batchActionsRow}>
                          <Text style={styles.selectedCountText}>
                            已选 {selected.length} / {paragraphs.length} 段
                          </Text>
                          <View style={styles.batchBtnRow}>
                            <TouchableOpacity
                              onPress={() => {
                                if (selected.length === paragraphs.length) {
                                  setSelected([]);
                                } else {
                                  setSelected(paragraphs.map((_, i) => i));
                                }
                              }}
                              style={styles.batchSmallBtn}>
                              <Text style={styles.batchSmallBtnText}>
                                {selected.length === paragraphs.length
                                  ? '取消全选'
                                  : '全选'}
                              </Text>
                            </TouchableOpacity>
                            {selected.length > 0 ? (
                              <TouchableOpacity
                                onPress={() => {
                                  setText(
                                    paragraphs
                                      .filter(
                                        (_, idx) => !selected.includes(idx),
                                      )
                                      .join('\n\n'),
                                  );
                                  setSelected([]);
                                }}
                                style={styles.deleteBatchBtn}>
                                <Text style={styles.deleteBatchBtnText}>
                                  删除选中 ({selected.length})
                                </Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.inputGroup}>
                        <View style={styles.fieldLabelRow}>
                          <View style={styles.fieldLabelLeft}>
                            <Text style={styles.fieldLabel}>文章正文</Text>
                            {textSource === '大模型清洗后的正文' ? (
                              <View style={styles.sourceBadgeAiSmall}>
                                <Text style={styles.sourceBadgeTextAi}>
                                  ✨ AI已清洗
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.charCountText}>
                            {text.length} / {MAX_ARTICLE_LENGTH} 字符
                          </Text>
                        </View>
                        <TextInput
                          style={styles.bodyInput}
                          accessibilityLabel="文章正文输入框"
                          placeholder="在此粘贴或编辑正文内容..."
                          placeholderTextColor="#A8A29E"
                          multiline
                          textAlignVertical="top"
                          value={text}
                          onChangeText={value => {
                            setText(value);
                            setSelected([]);
                          }}
                          maxLength={MAX_ARTICLE_LENGTH}
                          editable={!saving && !extracting}
                        />
                        <Text style={styles.bodyTipText}>
                          💡
                          提示：保存后将生成专属文章书籍，普通朗读使用所选参考音频，默认旁白。云端
                          TTS 会接收朗读文本。
                        </Text>
                      </View>
                    )}
                  </View>
                }
              />

              {/* 底部固定保存操作栏 */}
              <View style={styles.editorBottomDock}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="仅保存"
                  disabled={saving || extracting || !text.trim()}
                  onPress={() => save(false)}
                  style={[
                    styles.saveDraftBtn,
                    (saving || extracting || !text.trim()) &&
                      styles.disabledButton,
                  ]}>
                  <Text style={styles.saveDraftBtnText}>仅保存</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="保存并播放"
                  disabled={saving || extracting || !text.trim()}
                  onPress={() => save(true)}
                  style={[
                    styles.savePlayBtn,
                    (saving || extracting || !text.trim()) &&
                      styles.disabledButton,
                  ]}>
                  {saving ? (
                    <View style={styles.savingRow}>
                      <ActivityIndicator
                        size="small"
                        color="#FFFFFF"
                        style={styles.savingIndicator}
                      />
                      <Text style={styles.savePlayBtnText}>正在保存…</Text>
                    </View>
                  ) : (
                    <Text style={styles.savePlayBtnText}>保存并开始听书</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </SafeAreaView>
      </Modal>
      <ArticleVoicePicker
        visible={visible && voicePickerVisible}
        selectedId={referenceAudio?.id}
        onSelect={record => {
          setReferenceAudio(record);
          setVoicePickerVisible(false);
        }}
        onClose={() => setVoicePickerVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8F6F0',
  },
  flexOne: {
    flex: 1,
  },

  // 1. 顶栏样式（严格对齐 SettingsScreen 风格）
  header: {
    height: 56,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8F6F0',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1917',
  },
  headerLink: {
    fontSize: 16,
    color: '#B45309',
    fontWeight: '600',
  },
  headerSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSideRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },

  // 2. 初始导入界面样式
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFECE6',
    marginBottom: 16,
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardHeaderInfo: {
    flex: 1,
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
  urlInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: '#E5E0D8',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  urlInput: {
    flex: 1,
    fontSize: 14,
    color: '#1C1917',
    paddingVertical: 0,
  },
  clearBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E7E5E4',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  clearBtnIcon: {
    width: 12,
    height: 12,
  },
  primaryButton: {
    backgroundColor: '#B45309',
    borderRadius: 12,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    shadowColor: '#B45309',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  disabledButton: {
    opacity: 0.45,
  },

  sectionHeader: {
    marginBottom: 10,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#78716C',
    marginLeft: 4,
  },
  quickGrid: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  quickCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EFECE6',
    marginHorizontal: 4,
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  quickIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  quickIconTxt: {
    backgroundColor: '#EFF6FF',
  },
  quickIconPaste: {
    backgroundColor: '#F0FDF4',
  },
  quickIconText: {
    fontSize: 18,
  },
  quickTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1C1917',
  },
  quickDesc: {
    fontSize: 11,
    color: '#78716C',
    marginTop: 4,
    lineHeight: 16,
  },

  guideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFECE6',
    marginBottom: 20,
  },
  guideTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#44403C',
    marginBottom: 12,
  },
  guideSteps: {
    marginBottom: 12,
  },
  guideStepItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  stepNumWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 2,
  },
  stepNumText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E',
  },
  stepText: {
    flex: 1,
    fontSize: 13,
    color: '#57534E',
    lineHeight: 20,
  },
  stepBold: {
    fontWeight: '700',
    color: '#1C1917',
  },
  guideTipBadge: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FEF08A',
  },
  guideTipText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 18,
  },

  // 3. URL 网页浏览界面样式
  browserHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    backgroundColor: '#F8F6F0',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E0D8',
  },
  browserUrlPill: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E0D8',
    borderRadius: 18,
    height: 38,
    paddingHorizontal: 10,
    marginHorizontal: 10,
  },
  browserUrlIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  browserUrlText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    color: '#44403C',
  },
  browserReloadBtn: {
    padding: 2,
    marginLeft: 4,
  },
  browserReloadIcon: {
    width: 15,
    height: 15,
  },
  browserHeaderAction: {
    flexShrink: 0,
    minHeight: 38,
    justifyContent: 'center',
  },
  pageLoadingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF3C7',
    paddingVertical: 6,
  },
  pageLoadingText: {
    fontSize: 12,
    color: '#92400E',
    marginLeft: 6,
    fontWeight: '600',
  },
  pageErrorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#FECACA',
  },
  pageErrorText: {
    fontSize: 12,
    color: '#991B1B',
    flex: 1,
  },
  pageErrorAction: {
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '700',
    marginLeft: 8,
  },
  webview: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  browserBottomBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E0D8',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -2},
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 4,
  },
  browserTipText: {
    fontSize: 11,
    color: '#78716C',
    textAlign: 'center',
    marginBottom: 8,
  },
  extractPrimaryBtn: {
    backgroundColor: '#B45309',
    borderRadius: 14,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B45309',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  extractPrimaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  extractingBar: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#78716C',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  extractingIndicator: {
    marginRight: 8,
  },
  extractingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
  },
  cancelExtractBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  cancelExtractText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },

  // 4. 文章预览与编辑界面样式
  toolBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F8F6F0',
  },
  toolPillBtn: {
    flex: 1,
    height: 38,
    marginHorizontal: 4,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D9CDB9',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toolPillBtnSingle: {
    paddingHorizontal: 16,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D9CDB9',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: 4,
  },
  toolPillBtnWithIcon: {
    flexDirection: 'row',
  },
  toolPillIcon: {
    width: 15,
    height: 15,
    marginRight: 4,
  },
  toolPillBtnText: {
    fontSize: 13,
    color: '#57534E',
    fontWeight: '600',
  },
  toolPillBtnActive: {
    backgroundColor: '#B45309',
    borderColor: '#B45309',
  },
  toolPillBtnTextActive: {
    color: '#FFFFFF',
  },

  cleaningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  cleaningIndicator: {
    marginRight: 8,
  },
  cleaningText: {
    fontSize: 13,
    color: '#92400E',
    fontWeight: '600',
    flex: 1,
  },
  cancelCleanBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#B45309',
  },
  cancelCleanBtnText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },

  noticeBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  noticeInfo: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FEF08A',
  },
  noticeError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  noticeBodyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  noticeIcon: {
    fontSize: 15,
    marginRight: 8,
    marginTop: 1,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  noticeTextInfo: {
    color: '#78350F',
  },
  noticeTextError: {
    color: '#991B1B',
  },
  sourceBadgeAiSmall: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
  },
  sourceBadgeTextAi: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },

  editorList: {
    flex: 1,
  },
  editorContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  formSection: {
    paddingTop: 4,
  },
  articleVoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E0D8',
    marginTop: 8,
  },
  articleVoiceName: {flex: 1, fontSize: 15, color: '#1C1917', marginRight: 8},
  inputGroup: {
    marginBottom: 16,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fieldLabelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1C1917',
  },
  charCountText: {
    fontSize: 12,
    color: '#8C827A',
  },
  titleInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E0D8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1917',
  },
  sourceUrlCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFECE6',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 16,
  },
  sourceUrlIcon: {
    fontSize: 12,
    marginRight: 6,
  },
  sourceUrlText: {
    flex: 1,
    fontSize: 12,
    color: '#78716C',
  },
  bodyInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E0D8',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    lineHeight: 25,
    color: '#1C1917',
    minHeight: 280,
  },
  bodyTipText: {
    fontSize: 12,
    color: '#8C827A',
    marginTop: 8,
    lineHeight: 18,
  },

  // 段落模式样式
  paragraphModeHeader: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EFECE6',
    marginBottom: 10,
  },
  paragraphTipWrap: {
    marginBottom: 8,
  },
  paragraphModeTip: {
    fontSize: 13,
    color: '#57534E',
    lineHeight: 18,
    fontWeight: '600',
  },
  batchActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectedCountText: {
    fontSize: 12,
    color: '#8C827A',
  },
  batchBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  batchSmallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: '#D9CDB9',
    marginRight: 6,
  },
  batchSmallBtnText: {
    fontSize: 12,
    color: '#57534E',
    fontWeight: '600',
  },
  deleteBatchBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#DC2626',
  },
  deleteBatchBtnText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  paragraphCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EDE8DF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  paragraphCardSelected: {
    backgroundColor: '#FEF3C7',
    borderColor: '#B45309',
    borderWidth: 1.5,
  },
  paragraphHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  checkboxCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#A8A29E',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  checkboxCircleChecked: {
    borderColor: '#B45309',
    backgroundColor: '#B45309',
  },
  checkboxCheck: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  paragraphIndex: {
    fontSize: 11,
    color: '#8C827A',
    fontWeight: '600',
  },
  paragraphText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#1C1917',
  },

  // 5. 底部固定保存操作栏
  editorBottomDock: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E0D8',
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -2},
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 4,
  },
  saveDraftBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D9CDB9',
    backgroundColor: '#FAF8F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  saveDraftBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#57534E',
  },
  savePlayBtn: {
    flex: 1.5,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#B45309',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B45309',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  savePlayBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savingIndicator: {
    marginRight: 6,
  },
});

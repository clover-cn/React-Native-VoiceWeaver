import React, {memo, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Image,
  Alert,
  ScrollView,
} from 'react-native';
import {ReadingRecord} from '../utils/readerStorage';
import {useDebug} from '../debug';
import {AppImages} from '../../../../assets';

/** 音色库：4 柱单色琥珀音频律动波形 */
const VoiceWaveIcon = memo(() => (
  <View style={styles.waveIconBox}>
    <View style={[styles.voiceWaveBar, {height: 8}]} />
    <View style={[styles.voiceWaveBar, {height: 16}]} />
    <View style={[styles.voiceWaveBar, {height: 12}]} />
    <View style={[styles.voiceWaveBar, {height: 6}]} />
  </View>
));

/** 导入文章：极简单色文稿线框图标 */
const ArticleDocIcon = memo(() => (
  <View style={styles.docIconBox}>
    <View style={styles.docLine1} />
    <View style={styles.docLine2} />
    <View style={styles.docLine3} />
  </View>
));

/** 书源规则管理：单色经纬线框地球仪 */
const SourceGlobeIcon = memo(() => (
  <View style={styles.globeBox}>
    <View style={styles.globeEquator} />
    <View style={styles.globeMeridian} />
  </View>
));

interface NovelHomeProps {
  onNavigateSearch: () => void;
  onImportBook: () => void;
  onImportArticle: () => void;
  onManageBookSources: () => void;
  onOpenSettings: () => void;
  onOpenAudioLibrary?: () => void;
  isImporting?: boolean;
  readingRecords: ReadingRecord[];
  onResumeReading: (record: ReadingRecord) => void;
  onRemoveRecord: (bookUrl: string) => void;
}

/**
 * 获取当前时段有声文学问候语
 */
const getTimeGreeting = (): {greeting: string; subGreeting: string} => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) {
    return {
      greeting: '晨光正好，伴声启程',
      subGreeting: '新的一天，选一段动人章节唤醒思绪',
    };
  } else if (hour >= 11 && hour < 14) {
    return {
      greeting: '中午好，享受闲暇',
      subGreeting: '午间小憩，让温暖的声音陪你放松片刻',
    };
  } else if (hour >= 14 && hour < 18) {
    return {
      greeting: '午后静好，声旅人',
      subGreeting: '沏一杯茶，听一段引人入胜的故事',
    };
  } else if (hour >= 18 && hour < 23) {
    return {
      greeting: '晚风轻拂，静心聆听',
      subGreeting: '卸下一天的疲惫，走进属于你的声境天地',
    };
  } else {
    return {
      greeting: '夜幕低垂，声枕入梦',
      subGreeting: '夜深了，让温柔的故事伴你入眠',
    };
  }
};

const NovelHome: React.FC<NovelHomeProps> = ({
  onNavigateSearch,
  onImportBook,
  onImportArticle,
  onManageBookSources,
  onOpenSettings,
  onOpenAudioLibrary,
  isImporting = false,
  readingRecords,
  onResumeReading,
  onRemoveRecord,
}) => {
  const debugCtx = useDebug();
  const [isFloatingMenuOpen, setIsFloatingMenuOpen] = useState(false);
  // 悬浮菜单展开与微回弹缩放动画
  const menuAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isFloatingMenuOpen) {
      Animated.spring(menuAnim, {
        toValue: 1,
        friction: 8,
        tension: 65,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(menuAnim, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
    }
  }, [isFloatingMenuOpen, menuAnim]);

  // 时段问候语
  const {greeting, subGreeting} = useMemo(() => getTimeGreeting(), []);

  useEffect(() => {
    if (isImporting) {
      setIsFloatingMenuOpen(false);
    }
  }, [isImporting]);

  const handleLongPress = (record: ReadingRecord) => {
    Alert.alert(
      '删除书籍及本地数据',
      `确定删除《${record.book.name}》吗？将清理该书的正文、阅读与听书进度、角色绑定及生成音频，本地导入的 TXT 也会删除。共享音色和 API 配置保留。`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => onRemoveRecord(record.book.bookUrl),
        },
      ],
    );
  };

  // 最近收听/阅读的焦点书籍（排在第一本）
  const heroRecord = readingRecords.length > 0 ? readingRecords[0] : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* 1. 顶部情境化声学问候区 */}
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <View style={styles.tagRow}>
              <Text style={styles.brandTag}>VOICEWEAVER · 织音</Text>
            </View>
            <TouchableOpacity
              onPress={() => debugCtx.registerTap()}
              activeOpacity={0.9}>
              <Text style={styles.greeting}>{greeting}</Text>
            </TouchableOpacity>
            <Text style={styles.subGreeting}>{subGreeting}</Text>
          </View>
          <View style={styles.headphoneIconWrap}>
            <Text style={styles.headphoneIcon}>🎧</Text>
          </View>
        </View>

        {/* 2. 声学搜索栏 */}
        <TouchableOpacity
          style={styles.searchBar}
          onPress={onNavigateSearch}
          activeOpacity={0.85}>
          <Image source={AppImages.searchIcon} style={styles.searchIcon} />
          <Text style={styles.searchPlaceholder}>
            搜索你想听的小说、角色或作者…
          </Text>
        </TouchableOpacity>

        {/* 3. 【听书特色】正在收听焦点黑胶/立体卡片 (Hero Playing Card) */}
        {heroRecord && (
          <View style={styles.heroSection}>
            <TouchableOpacity
              style={styles.heroCard}
              disabled={isImporting}
              onPress={() => onResumeReading(heroRecord)}
              activeOpacity={0.9}>
              {/* 焦点卡片顶部标签栏 */}
              <View style={styles.heroTopRow}>
                <View style={styles.heroTag}>
                  <View style={styles.waveBarGroup}>
                    <View style={[styles.waveBar, styles.waveBar1]} />
                    <View style={[styles.waveBar, styles.waveBar2]} />
                    <View style={[styles.waveBar, styles.waveBar3]} />
                  </View>
                  <Text style={styles.heroTagText}>上次收听</Text>
                </View>
                <Text style={styles.heroSubHint}>点击一键继续演播 ›</Text>
              </View>

              {/* 焦点卡片主体：立体书封 + 详情 */}
              <View style={styles.heroBody}>
                {heroRecord.book.coverUrl ? (
                  <View style={styles.heroCoverWrapper}>
                    <Image
                      source={{uri: heroRecord.book.coverUrl}}
                      style={styles.heroCoverImage}
                      resizeMode="cover"
                    />
                    <View style={styles.heroCoverSpine} />
                  </View>
                ) : (
                  <View
                    style={[
                      styles.heroCoverWrapper,
                      styles.heroCoverPlaceholder,
                    ]}>
                    <Image source={AppImages.defaultCover} style={styles.heroCoverImage} resizeMode="cover" />
                    <View style={styles.heroCoverSpine} />
                  </View>
                )}

                <View style={styles.heroInfo}>
                  <Text style={styles.heroTitle} numberOfLines={1}>
                    {heroRecord.book.name}
                  </Text>
                  <Text style={styles.heroAuthor} numberOfLines={1}>
                    {heroRecord.book.author || '未知作者'}
                  </Text>
                  <View style={styles.heroChapterBadge}>
                    <Text style={styles.heroChapterText} numberOfLines={1}>
                      {heroRecord.currentChapter?.title ||
                        heroRecord.book.intro ||
                        '继续上一次的阅读篇章'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* 底部收听进度与快捷播放按钮 */}
              <View style={styles.heroFooter}>
                <View style={styles.heroProgressWrap}>
                  <View style={styles.heroProgressLabelRow}>
                    <Text style={styles.heroProgressTitle}>
                      {heroRecord.book.sourceType === 'local_txt'
                        ? '本地 TXT 离线有声书'
                        : heroRecord.book.sourceType === 'local_web_novel'
                        ? '网页导入 · 可离线阅读'
                        : '网络精选书源 · 智能角色分镜'}
                    </Text>
                    <Text style={styles.heroProgressStatus}>随时畅听</Text>
                  </View>
                  <View style={styles.heroProgressBarTrack}>
                    <View style={styles.heroProgressBarFill} />
                  </View>
                </View>
                <View style={styles.heroPlayButton}>
                  <Image
                    source={AppImages.play}
                    style={styles.heroPlayIcon}
                    resizeMode="contain"
                  />
                </View>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* 4. 我的有声书架 */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>我的有声书架</Text>
            {readingRecords.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>
                  {readingRecords.length} 本在读
                </Text>
              </View>
            )}
          </View>
        </View>

        {readingRecords.length > 0 ? (
          readingRecords.map(record => {
            const book = record.book;
            const chapter = record.currentChapter;
            const isLocal = book.sourceType === 'local_txt';
            return (
              <TouchableOpacity
                key={book.bookUrl}
                disabled={isImporting}
                style={styles.bookCard}
                onPress={() => onResumeReading(record)}
                onLongPress={() => handleLongPress(record)}
                delayLongPress={400}
                activeOpacity={0.82}>
                {/* 立体质感书封 */}
                {book.coverUrl ? (
                  <View style={styles.coverWrapper}>
                    <Image
                      source={{uri: book.coverUrl}}
                      style={styles.coverImage}
                      resizeMode="cover"
                    />
                    <View style={styles.coverSpine} />
                  </View>
                ) : (
                  <View style={[styles.coverWrapper, styles.coverPlaceholder]}>
                    <Image source={AppImages.defaultCover} style={styles.coverImage} resizeMode="cover" />
                    <View style={styles.coverSpine} />
                  </View>
                )}

                {/* 书籍信息与听书元数据 */}
                <View style={styles.bookInfo}>
                  <View style={styles.bookHeaderRow}>
                    <Text style={styles.bookTitle} numberOfLines={1}>
                      {book.name}
                    </Text>
                    <View
                      style={[
                        styles.sourceTag,
                        isLocal
                          ? styles.sourceTagLocal
                          : styles.sourceTagOnline,
                      ]}>
                      <Text
                        style={[
                          styles.sourceTagText,
                          isLocal
                            ? styles.sourceTagTextLocal
                            : styles.sourceTagTextOnline,
                        ]}>
                        {book.contentType === 'article'
                          ? '文章快照'
                          : isLocal
                          ? '本地 TXT'
                          : book.sourceType === 'local_web_novel'
                          ? '网页导入'
                          : '网络源'}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.bookAuthor}>
                    {book.author || '未知作者'}
                  </Text>

                  <Text style={styles.bookIntro} numberOfLines={1}>
                    {chapter?.title
                      ? `上次听至: ${chapter.title}`
                      : book.intro || '准备开启聆听'}
                  </Text>

                  {/* 替换原先难看生硬的技术URL，注入听书专属属性 */}
                  <View style={styles.recordMetaRow}>
                    <View style={styles.audioFeatBadge}>
                      <Text style={styles.audioFeatText}>
                        {book.contentType === 'article' ? '原文单音色朗读' : isLocal ? '支持离线演播' : '多角色配音演播'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* 卡片右侧快捷播放圆形按钮 */}
                <View style={styles.quickPlayBtn}>
                  <Image
                    source={AppImages.play}
                    style={styles.quickPlayIcon}
                    resizeMode="contain"
                  />
                </View>
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📚</Text>
            <Text style={styles.emptyTitle}>书架还没有书籍</Text>
            <Text style={styles.emptyDesc}>
              点击右下角「＋」导入网页章节或本地 TXT 小说。
            </Text>
          </View>
        )}
      </ScrollView>

      {/* 5. 悬浮菜单背景遮罩 */}
      {isFloatingMenuOpen && (
        <Animated.View style={[styles.menuBackdrop, {opacity: menuAnim}]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setIsFloatingMenuOpen(false)}
            accessibilityLabel="关闭悬浮菜单"
          />
        </Animated.View>
      )}

      {/* 6. 【重构核心】右下角一体化多功能浮动卡片 (Unified Popover Card) */}
      <View style={styles.floatingMenu}>
        {isFloatingMenuOpen ? (
          <Animated.View
            style={[
              styles.menuCard,
              {
                opacity: menuAnim,
                transform: [
                  {
                    scale: menuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.92, 1],
                    }),
                  },
                  {
                    translateY: menuAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                  },
                ],
              },
            ]}>
            {/* 分组 1：听书与音效系统 */}
            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.72}
              onPress={() => {
                setIsFloatingMenuOpen(false);
                onOpenSettings();
              }}
              accessibilityRole="button"
              accessibilityLabel="听书与 API 设置">
              <View style={styles.menuItemIconBg}>
                <Image
                  source={AppImages.setting}
                  style={styles.menuIconImage}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.menuItemTextCol}>
                <Text style={styles.menuItemTitle}>听书与 API 设置</Text>
                <Text style={styles.menuItemSub}>
                  正文解析 / TTS 模型 / 预取参数
                </Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.72}
              onPress={() => {
                setIsFloatingMenuOpen(false);
                if (onOpenAudioLibrary) {
                  onOpenAudioLibrary();
                } else {
                  onOpenSettings();
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="音色库与参考录音">
              <View style={styles.menuItemIconBg}>
                <VoiceWaveIcon />
              </View>
              <View style={styles.menuItemTextCol}>
                <Text style={styles.menuItemTitle}>音色库与参考录音</Text>
                <Text style={styles.menuItemSub}>管理演播声音与克隆音色</Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>

            {/* 优雅分组细分割线 */}
            <View style={styles.menuDivider} />

            {/* 分组 2：内容导入与网络书源 */}
            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.72}
              disabled={isImporting}
              accessibilityRole="button"
              accessibilityLabel="导入文章"
              onPress={() => {
                setIsFloatingMenuOpen(false);
                onImportArticle();
              }}>
              <View style={styles.menuItemIconBg}>
                <ArticleDocIcon />
              </View>
              <View style={styles.menuItemTextCol}>
                <Text style={styles.menuItemTitle}>导入文章</Text>
                <Text style={styles.menuItemSub}>网页 / 本地 TXT / 粘贴文字</Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.72}
              onPress={() => {
                setIsFloatingMenuOpen(false);
                onImportBook();
              }}
              disabled={isImporting}
              accessibilityRole="button"
              accessibilityLabel="导入书籍">
              <View style={styles.menuItemIconBg}>
                <Image
                  source={AppImages.imp}
                  style={styles.menuIconImage}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.menuItemTextCol}>
                <Text style={styles.menuItemTitle}>
                  {isImporting ? '导入解析中…' : '导入小说'}
                </Text>
                <Text style={styles.menuItemSub}>网页抓取 / 本地 TXT</Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.72}
              onPress={() => {
                setIsFloatingMenuOpen(false);
                onManageBookSources();
              }}
              accessibilityRole="button"
              accessibilityLabel="书源管理">
              <View style={styles.menuItemIconBg}>
                <SourceGlobeIcon />
              </View>
              <View style={styles.menuItemTextCol}>
                <Text style={styles.menuItemTitle}>书源规则管理</Text>
                <Text style={styles.menuItemSub}>管理与测试网络小说书源</Text>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : null}

        {/* 主悬浮球 */}
        <TouchableOpacity
          style={[
            styles.floatingButton,
            isFloatingMenuOpen && styles.floatingButtonActive,
          ]}
          activeOpacity={0.88}
          disabled={isImporting}
          onPress={() => setIsFloatingMenuOpen(open => !open)}
          accessibilityRole="button"
          accessibilityLabel={isFloatingMenuOpen ? '关闭菜单' : '打开操作菜单'}>
          <Text
            style={[
              styles.floatingButtonText,
              isFloatingMenuOpen && styles.floatingButtonTextOpen,
            ]}>
            {isFloatingMenuOpen ? '×' : '＋'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 导入中蒙层 */}
      {isImporting ? (
        <View
          style={styles.importingOverlay}
          accessibilityRole="progressbar"
          accessibilityLabel="导入中">
          <View style={styles.importingPanel}>
            <ActivityIndicator size="large" color="#D97706" />
            <Text style={styles.importingTitle}>正在导入有声书</Text>
            <Text style={styles.importingDesc}>
              正在解析章节结构并进行本地安全校验…
            </Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F6F0', // 温润宣纸暖白底色，营造书香氛围
  },
  scrollContent: {
    paddingBottom: 120,
  },
  // 1. 顶部情境化声学问候区
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: Platform.OS === 'ios' ? 14 : 26,
    paddingBottom: 16,
  },
  headerTitleWrap: {
    flex: 1,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  brandTag: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 1.2,
    marginRight: 8,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1C1917',
    letterSpacing: -0.5,
  },
  subGreeting: {
    fontSize: 13,
    color: '#78716C',
    marginTop: 4,
    lineHeight: 18,
  },
  headphoneIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E7E5E4',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    marginLeft: 12,
  },
  headphoneIcon: {
    fontSize: 20,
  },

  // 2. 声学搜索栏
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 22,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 10,
    width: 15,
    height: 15,
  },
  searchPlaceholder: {
    color: '#A8A29E',
    fontSize: 14,
    flex: 1,
  },

  // 3. 焦点收听 Hero 卡片
  heroSection: {
    marginHorizontal: 22,
    marginBottom: 24,
  },
  heroCard: {
    backgroundColor: '#26201B', // 质感深胡桃焦糖木色
    borderRadius: 22,
    padding: 18,
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 6,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  heroTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  waveBarGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
    height: 12,
  },
  waveBar: {
    width: 2.5,
    backgroundColor: '#F59E0B',
    borderRadius: 1.5,
    marginHorizontal: 1,
  },
  waveBar1: {
    height: 7,
  },
  waveBar2: {
    height: 12,
  },
  waveBar3: {
    height: 9,
  },
  heroTagText: {
    fontSize: 11,
    color: '#FDE68A',
    fontWeight: '700',
  },
  heroSubHint: {
    fontSize: 11,
    color: '#A8A29E',
  },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroCoverWrapper: {
    width: 60,
    height: 80,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#3E342D',
    marginRight: 16,
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  heroCoverImage: {
    width: '100%',
    height: '100%',
  },
  heroCoverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4B3F35',
  },
  heroCoverText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F59E0B',
  },
  heroCoverSpine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  heroInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  heroAuthor: {
    fontSize: 12,
    color: '#D4A373',
    marginTop: 3,
  },
  heroChapterBadge: {
    marginTop: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  heroChapterText: {
    fontSize: 11,
    color: '#E7E5E4',
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  heroProgressWrap: {
    flex: 1,
    marginRight: 14,
  },
  heroProgressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  heroProgressTitle: {
    fontSize: 10,
    color: '#A8A29E',
  },
  heroProgressStatus: {
    fontSize: 10,
    color: '#F59E0B',
    fontWeight: '600',
  },
  heroProgressBarTrack: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  heroProgressBarFill: {
    width: '45%',
    height: '100%',
    backgroundColor: '#F59E0B',
    borderRadius: 2,
  },
  heroPlayButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlayIcon: {
    width: 40,
    height: 40,
  },

  // 4. 我的有声书架
  sectionHeader: {
    paddingHorizontal: 22,
    marginBottom: 14,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#1C1917',
    letterSpacing: -0.3,
  },
  countBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(217, 119, 6, 0.1)',
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  bookCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    marginHorizontal: 22,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  coverWrapper: {
    width: 60,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#E7E5E4',
    marginRight: 14,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E7E5E4',
  },
  coverSpine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  coverText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#A8A29E',
  },
  bookInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  bookHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  bookTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1C1917',
    flex: 1,
    marginRight: 8,
  },
  sourceTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  sourceTagLocal: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  sourceTagOnline: {
    backgroundColor: 'rgba(217, 119, 6, 0.1)',
  },
  sourceTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  sourceTagTextLocal: {
    color: '#065F46',
  },
  sourceTagTextOnline: {
    color: '#B45309',
  },
  bookAuthor: {
    fontSize: 12,
    color: '#78716C',
    marginBottom: 4,
  },
  bookIntro: {
    fontSize: 12,
    color: '#44403C',
    lineHeight: 16,
    marginBottom: 6,
  },
  recordMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  audioFeatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF5ED',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: '#EFE8DE',
  },
  audioFeatText: {
    fontSize: 10,
    color: '#8A5D3B',
    fontWeight: '600',
  },
  quickPlayBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  quickPlayIcon: {
    width: 28,
    height: 28,
  },
  emptyCard: {
    marginHorizontal: 22,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#EFECE6',
    borderStyle: 'dashed',
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1917',
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 13,
    color: '#78716C',
    lineHeight: 19,
    textAlign: 'center',
  },

  // 5. 悬浮菜单背景遮罩
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(28, 25, 23, 0.45)',
    zIndex: 20,
  },

  // 6. 右下角超级多功能一体化浮动卡片 (Unified Popover Card)
  floatingMenu: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    alignItems: 'flex-end',
    zIndex: 25,
  },
  menuCard: {
    width: 270,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#EFECE6',
    paddingVertical: 6,
    marginBottom: 14,
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 12,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#F5F2EB',
    marginVertical: 4,
    marginHorizontal: 14,
  },
  menuItemIconBg: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: '#FAF5ED',
    borderWidth: 1,
    borderColor: '#EFE8DE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuIconImage: {
    width: 18,
    height: 18,
    tintColor: '#B45309',
  },
  waveIconBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2.5,
    width: 18,
    height: 18,
  },
  voiceWaveBar: {
    width: 2.5,
    backgroundColor: '#B45309',
    borderRadius: 1.5,
  },
  docIconBox: {
    width: 15,
    height: 18,
    borderWidth: 1.5,
    borderColor: '#B45309',
    borderRadius: 3,
    paddingHorizontal: 2,
    justifyContent: 'center',
    gap: 2.5,
  },
  docLine1: {
    width: 7,
    height: 1.5,
    backgroundColor: '#B45309',
    borderRadius: 1,
  },
  docLine2: {
    width: 9,
    height: 1.5,
    backgroundColor: '#B45309',
    borderRadius: 1,
  },
  docLine3: {
    width: 6,
    height: 1.5,
    backgroundColor: '#B45309',
    borderRadius: 1,
  },
  globeBox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#B45309',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  globeEquator: {
    position: 'absolute',
    width: '100%',
    height: 1.5,
    backgroundColor: '#B45309',
  },
  globeMeridian: {
    width: 8,
    height: '100%',
    borderRadius: 4,
    borderWidth: 1.2,
    borderColor: '#B45309',
  },
  menuItemTextCol: {
    flex: 1,
  },
  menuItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1C1917',
  },
  menuItemSub: {
    fontSize: 10.5,
    color: '#78716C',
    marginTop: 1.5,
  },
  menuChevron: {
    fontSize: 15,
    color: '#D6D3D1',
    fontWeight: '600',
    marginLeft: 6,
  },
  floatingButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D97706', // 琥珀暖金主色
    shadowColor: '#D97706',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  floatingButtonActive: {
    backgroundColor: '#1C1917',
    shadowColor: '#1C1917',
  },
  floatingButtonText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 34,
    marginTop: -2,
  },
  floatingButtonTextOpen: {
    fontSize: 32,
    marginTop: -2,
  },

  // 7. 导入中加载中蒙层
  importingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(248, 246, 240, 0.85)',
  },
  importingPanel: {
    minWidth: 200,
    maxWidth: 300,
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingVertical: 22,
    borderWidth: 1,
    borderColor: '#EFECE6',
    shadowColor: '#1C1917',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
  },
  importingTitle: {
    marginTop: 14,
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1917',
  },
  importingDesc: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: '#78716C',
    textAlign: 'center',
  },
});

export default NovelHome;

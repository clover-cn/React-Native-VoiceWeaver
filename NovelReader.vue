<template>
  <div class="h-full w-full flex flex-col bg-[#0f0f1a] text-[#e2e2f0] font-sans overflow-hidden">
    <!-- ===================== 搜索视图 ===================== -->
    <div v-if="viewState === 'search'" class="flex-1 overflow-y-auto pb-10 custom-scrollbar">
      <!-- 顶部品牌区 -->
      <div class="flex flex-col items-center px-6 pt-14 pb-9 bg-[radial-gradient(ellipse_at_top,_#1a1a3e_0%,_#0f0f1a_60%)]">
        <div class="text-[52px] mb-3">📖</div>
        <h2 class="text-[32px] font-bold bg-gradient-to-br from-[#a09ef5] to-[#e087ff] bg-clip-text text-transparent m-0 mb-2">织音小说</h2>
        <p class="text-[#7777aa] text-[15px] m-0 mb-8">搜索你想阅读的小说，开启沉浸阅读旅程</p>

        <!-- 搜索框 -->
      <div class="flex w-full max-w-[560px] gap-2.5">
        <input
          v-model="searchKeyword"
            class="flex-1 px-5 py-3.5 bg-[#1a1a2e] border border-[#3a3a6a] rounded-xl text-[#e2e2f0] text-base outline-none transition-all duration-200 focus:border-[#7c6ff7] focus:ring-[3px] focus:ring-[rgba(124,111,247,0.2)] placeholder:text-[#555577]"
            placeholder="输入书名或作者..."
            @keyup.enter="doSearch"
          />
          <button
            class="px-6 py-3.5 bg-gradient-to-br from-[#7c6ff7] to-[#c44dff] rounded-xl text-white text-[15px] font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all duration-200 hover:-translate-y-[1px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            :disabled="isSearching"
            @click="doSearch"
          >
            <span v-if="isSearching" class="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
            <div class="flex items-center gap-1.5" v-else>
              <el-icon><Search /></el-icon>搜索
            </div>
          </button>
        </div>

        <div v-if="searchHistory.length" class="w-full max-w-[560px] mt-5">
          <div class="flex items-center justify-between gap-3 mb-3">
            <span class="text-[13px] font-medium text-[#9a9ac8]">搜索历史</span>
            <button
              type="button"
              class="text-[12px] text-[#6f6fa8] transition-colors duration-200 hover:text-[#b5b5e8]"
              @click="clearSearchHistory"
            >
              清空
            </button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="item in searchHistory"
              :key="item.keyword"
              type="button"
              class="rounded-full border border-[rgba(124,111,247,0.25)] bg-[rgba(124,111,247,0.1)] px-3 py-1.5 text-[12px] text-[#d7d7fb] transition-colors duration-200 hover:bg-[rgba(124,111,247,0.2)]"
              @click="reuseSearchKeyword(item.keyword)"
            >
              {{ item.keyword }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="readingHistory.length" class="px-6 mt-6">
        <div class="flex items-center justify-between gap-3 mb-3">
          <div class="flex items-center gap-2">
            <span class="text-[15px] font-semibold text-[#d9d9f8]">阅读历史</span>
            <span class="text-[12px] text-[#7171a6]">下次可直接续读</span>
          </div>
          <button
            type="button"
            class="text-[12px] text-[#6f6fa8] transition-colors duration-200 hover:text-[#b5b5e8]"
            @click="clearReadingHistory"
          >
            清空
          </button>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          <div
            v-for="item in readingHistory"
            :key="item.id"
            class="flex gap-3.5 rounded-2xl border border-[rgba(124,111,247,0.18)] bg-[linear-gradient(135deg,rgba(26,26,46,0.92),rgba(18,18,34,0.95))] p-4"
          >
            <div class="shrink-0 flex h-[90px] w-[68px] items-center justify-center overflow-hidden rounded-lg bg-[#1e1e3a]">
              <img v-if="item.coverUrl" class="h-full w-full object-cover" :src="item.coverUrl" :alt="item.bookName" @error="handleImgError($event)" />
              <div v-else class="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2e2e5a] to-[#3a2a5a] text-[28px] font-bold text-[#a09ef5]">
                {{ item.bookName?.slice(0, 1) }}
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-[15px] font-semibold text-[#ececff]" :title="item.bookName">{{ item.bookName }}</div>
              <div class="mt-1 text-[13px] text-[#9292c8]">{{ item.author || "未知作者" }}</div>
              <div class="mt-3 line-clamp-2 text-[12px] leading-5 text-[#c8c8ec]" :title="item.chapterTitle">上次看到：{{ item.chapterTitle }}</div>
              <div class="mt-2 text-[11px] text-[#666699]">{{ formatHistoryTime(item.updatedAt) }}</div>
              <div class="mt-3 flex gap-2">
                <button
                  type="button"
                  class="rounded-lg bg-gradient-to-br from-[#7c6ff7] to-[#c44dff] px-3 py-1.5 text-[12px] font-semibold text-white transition-all duration-200 hover:-translate-y-[1px] hover:opacity-90"
                  @click="resumeReading(item)"
                >
                  继续阅读
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-[rgba(124,111,247,0.25)] bg-[rgba(124,111,247,0.08)] px-3 py-1.5 text-[12px] text-[#bcbcf1] transition-colors duration-200 hover:bg-[rgba(124,111,247,0.16)]"
                  @click="reuseSearchKeyword(item.searchKeyword || item.bookName)"
                >
                  再次搜索
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 搜索结果 -->
      <div v-if="searchResults.length" class="px-6">
        <div class="py-4 pb-3">
          <span class="text-[#8888bb] text-sm">找到 {{ searchResults.length }} 部作品</span>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          <div
            v-for="(book, i) in searchResults"
            :key="i"
            class="flex gap-3.5 bg-[#15152a] border border-[#2a2a4a] rounded-2xl p-3.5 cursor-pointer transition-all duration-250 hover:border-[#7c6ff7] hover:-translate-y-0.5 hover:shadow-[0_6px_24px_rgba(124,111,247,0.18)]"
            @click="selectBook(book)"
          >
            <div class="shrink-0 w-[68px] h-[90px] rounded-lg overflow-hidden bg-[#1e1e3a]">
              <img v-if="book.coverUrl" class="w-full h-full object-cover" :src="book.coverUrl" :alt="book.name" @error="handleImgError($event)" />
              <div v-else class="w-full h-full flex items-center justify-center text-[28px] font-bold bg-gradient-to-br from-[#2e2e5a] to-[#3a2a5a] text-[#a09ef5]">{{ book.name?.slice(0, 1) }}</div>
            </div>
            <div class="flex-1 min-w-0 flex flex-col gap-1">
              <div class="text-[15px] font-semibold text-[#ddddf5] whitespace-nowrap overflow-hidden text-ellipsis" :title="book.name">{{ book.name }}</div>
              <div class="text-[13px] text-[#8888bb]">{{ book.author }}</div>
              <div class="text-xs text-[#666699] line-clamp-2 overflow-hidden flex-1 leading-relaxed" :title="book.intro">{{ book.intro }}</div>
              <div class="flex flex-wrap gap-1.5 mt-1">
                <span class="text-[11px] px-2 py-0.5 bg-[rgba(124,111,247,0.15)] border border-[rgba(124,111,247,0.3)] rounded-full text-[#a09ef5]">{{ book.originName }}</span>
                <span v-if="book.latestChapterTitle" class="text-[11px] text-[#555577] whitespace-nowrap overflow-hidden text-ellipsis max-w-[160px]">最新：{{ book.latestChapterTitle }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 搜索为空提示 -->
      <div v-else-if="hasSearched && !isSearching" class="flex flex-col items-center justify-center py-20 px-5 text-[#666699] gap-3">
        <div class="text-5xl">
          <el-icon><Search /></el-icon>
        </div>
        <p>未找到相关作品，换个关键词试试？</p>
      </div>
    </div>

    <!-- ===================== 章节列表视图 ===================== -->
    <div v-else-if="viewState === 'chapters'" class="flex-1 flex flex-col overflow-hidden">
      <!-- 顶部导航 -->
      <div class="flex items-center gap-4 px-5 py-3.5 bg-[#12122a] border-b border-[#2a2a4a] shrink-0">
        <button
          class="bg-[rgba(124,111,247,0.15)] border border-[rgba(124,111,247,0.3)] text-[#a09ef5] px-4 py-2 rounded-lg cursor-pointer text-sm transition-colors duration-200 hover:bg-[rgba(124,111,247,0.28)] whitespace-nowrap"
          @click="backToSearch"
        >
          ← 返回搜索
        </button>
        <div class="flex items-center gap-2.5 flex-1 min-w-0">
          <span class="font-semibold text-base text-[#ddddf5] whitespace-nowrap overflow-hidden text-ellipsis">{{ selectedBook?.name }}</span>
          <span class="text-[13px] text-[#8888bb] whitespace-nowrap">{{ selectedBook?.author }}</span>
          <span class="text-[11px] px-2 py-0.5 bg-[rgba(196,77,255,0.15)] border border-[rgba(196,77,255,0.3)] rounded-full text-[#d088ff] whitespace-nowrap">{{ selectedBook?.originName }}</span>
        </div>
      </div>

      <!-- 章节加载中 -->
      <div v-if="isLoadingChapters" class="flex flex-col items-center justify-center py-[60px] px-5 gap-4 text-[#8888bb]">
        <div class="w-9 h-9 border-4 border-[#2a2a4a] border-t-[#7c6ff7] rounded-full animate-spin"></div>
        <p>正在获取章节列表...</p>
      </div>

      <!-- 章节列表 -->
      <div v-else-if="chapterList.length" class="flex-1 overflow-y-auto p-4 px-5 custom-scrollbar">
        <div class="text-[#6666aa] text-[13px] mb-3">共 {{ chapterList.length }} 章</div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          <div
            v-for="(chap, idx) in chapterList"
            :key="idx"
            class="px-3.5 py-2.5 bg-[#15152a] border border-[#2a2a4a] rounded-lg text-[13px] text-[#c0c0e0] cursor-pointer transition-colors duration-200 whitespace-nowrap overflow-hidden text-ellipsis"
            :class="
              chap.isVolume
                ? 'bg-[rgba(196,77,255,0.08)] border-[rgba(196,77,255,0.25)] text-[#c44dff] pointer-events-none font-semibold'
                : 'hover:bg-[rgba(124,111,247,0.15)] hover:border-[#7c6ff7] hover:text-[#e0e0ff]'
            "
            @click="selectChapter(chap, idx)"
          >
            {{ chap.title }}
          </div>
        </div>
      </div>

      <div v-else class="flex flex-col items-center justify-center py-20 px-5 text-[#666699] gap-3">
        <div class="text-5xl">📋</div>
        <p>暂无章节数据</p>
      </div>
    </div>

    <!-- ===================== 阅读视图 ===================== -->
    <div v-else-if="viewState === 'reading'" class="flex-1 flex flex-col overflow-hidden">
      <!-- 顶部导航 -->
      <div class="flex items-center gap-3.5 px-5 py-3 bg-[rgba(18,18,42,0.95)] border-b border-[#2a2a4a] shrink-0 backdrop-blur-md">
        <button
          class="bg-[rgba(124,111,247,0.15)] border border-[rgba(124,111,247,0.3)] text-[#a09ef5] px-4 py-2 rounded-lg cursor-pointer text-sm transition-colors duration-200 hover:bg-[rgba(124,111,247,0.28)] whitespace-nowrap"
          @click="backToChapters"
        >
          ← 章节列表
        </button>
        <div class="flex-1 text-center text-[15px] font-semibold text-[#c0c0e0] whitespace-nowrap overflow-hidden text-ellipsis">{{ selectedChapter?.title }}</div>
        <div class="flex gap-2 items-center">
          <div class="flex items-center gap-3 rounded-lg border border-[rgba(124,111,247,0.2)] bg-[rgba(124,111,247,0.08)] px-3 py-2">
            <div class="flex flex-col leading-tight">
              <span class="text-[12px] text-[#f1ecff] whitespace-nowrap">缺失情绪音频时</span>
            </div>
            <select
              v-model="missingEmotionPolicy"
              class="min-w-[220px] rounded-md border border-[rgba(124,111,247,0.28)] bg-[rgba(15,15,26,0.75)] px-2.5 py-1.5 text-[12px] text-[#f1ecff] outline-none"
              @change="saveGenerationSettings"
            >
              <option value="strict" class="text-black">严格模式：没有对应情绪音频时，直接显示未配置</option>
              <option value="fallback_neutral" class="text-black">回退模式：没有对应情绪音频时，自动使用平静音频</option>
            </select>
          </div>
          <!-- <button
            v-if="segments.length"
            class="px-3.5 py-1.5 bg-[rgba(255,191,94,0.12)] border border-[rgba(255,191,94,0.28)] rounded-lg text-[#ffd480] text-[13px] cursor-pointer transition-colors duration-200 whitespace-nowrap hover:bg-[rgba(255,191,94,0.22)]"
            @click="openRoleSetup"
          >
            当前书角色配置
          </button> -->
          <!-- 听书控制区 -->
          <div class="flex items-center gap-2">
            <!-- idle: 显示听书按钮 -->
            <button
              v-if="listenState === 'idle'"
              class="px-3.5 py-1.5 bg-gradient-to-br from-[#7c6ff7] to-[#c44dff] rounded-lg text-white text-[13px] font-semibold cursor-pointer transition-all duration-200 hover:opacity-90 hover:-translate-y-[1px] whitespace-nowrap"
              @click="startListening"
            >
              🎧 听书
            </button>

            <!-- loading: 转圈 + 阶段文字 -->
            <div v-else-if="listenState === 'loading'" class="flex items-center gap-2 px-3 py-1.5 bg-[rgba(124,111,247,0.12)] border border-[rgba(124,111,247,0.3)] rounded-lg">
              <span class="inline-block w-3.5 h-3.5 border-2 border-[#7c6ff7]/40 border-t-[#7c6ff7] rounded-full animate-spin"></span>
              <span class="text-[12px] text-[#a09ef5] whitespace-nowrap">{{ listenPhaseText }}</span>
            </div>

            <!-- ready: 播放/暂停控制 -->
            <div v-else-if="listenState === 'ready'" class="flex items-center gap-2">
              <button
                class="px-3.5 py-1.5 bg-[rgba(124,111,247,0.15)] border border-[rgba(124,111,247,0.3)] rounded-lg text-[#a09ef5] text-[13px] cursor-pointer transition-all duration-200 hover:bg-[rgba(124,111,247,0.28)] whitespace-nowrap"
                @click="togglePlayPause"
              >
                {{ isPlaying ? "⏸ 暂停" : "▶ 播放" }}
              </button>
              <span class="text-[11px] text-[#6666aa] whitespace-nowrap">{{ currentSegIdx + 1 }} / {{ segments.length }}</span>
            </div>

            <!-- error: 重试 -->
            <button
              v-else-if="listenState === 'error'"
              class="px-3.5 py-1.5 bg-[rgba(255,80,80,0.12)] border border-[rgba(255,80,80,0.3)] rounded-lg text-[#ff8080] text-[13px] cursor-pointer whitespace-nowrap hover:bg-[rgba(255,80,80,0.22)]"
              @click="startListening"
            >
              <el-icon size="12" color="#ffffff"><WarnTriangleFilled /></el-icon>重试
            </button>
          </div>

          <button
            class="flex items-center gap-1 px-3.5 py-1.5 bg-[rgba(124,111,247,0.1)] border border-[rgba(124,111,247,0.25)] rounded-lg text-[#a09ef5] text-[13px] cursor-pointer transition-colors duration-200 whitespace-nowrap hover:bg-[rgba(124,111,247,0.25)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[rgba(124,111,247,0.1)]"
            :disabled="currentChapterIndex <= 0"
            @click="goPrevChapter"
          >
            <el-icon><ArrowLeft /></el-icon> 上一章
          </button>
          <button
            class="flex items-center gap-1 px-3.5 py-1.5 bg-[rgba(124,111,247,0.1)] border border-[rgba(124,111,247,0.25)] rounded-lg text-[#a09ef5] text-[13px] cursor-pointer transition-colors duration-200 whitespace-nowrap hover:bg-[rgba(124,111,247,0.25)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[rgba(124,111,247,0.1)]"
            :disabled="currentChapterIndex >= chapterList.length - 1"
            @click="goNextChapter"
          >
            下一章 <el-icon><ArrowRight /></el-icon>
          </button>
        </div>
      </div>

      <!-- 正文内容 -->
      <div class="flex-1 overflow-y-auto bg-[#0f0f1a] custom-scrollbar" ref="readingBody">
        <div v-if="isLoadingContent" class="flex flex-col items-center justify-center py-[60px] px-5 gap-4 text-[#8888bb]">
          <div class="w-9 h-9 border-4 border-[#2a2a4a] border-t-[#7c6ff7] rounded-full animate-spin"></div>
          <p>正在加载内容...</p>
        </div>

        <div v-else class="max-w-[760px] mx-auto pt-9 pb-20 px-7">
          <h2 class="text-[22px] font-bold text-[#e0e0ff] m-0 mb-9 text-center pb-5 border-b border-[#2a2a4a]">{{ selectedChapter?.title }}</h2>

          <!-- 听书模式：渲染 segments（支持高亮） -->
          <template v-if="segments.length > 0 || listenState === 'loading'">
            <div
              v-for="(seg, i) in segments"
              :key="i"
              :ref="
                (el) => {
                  if (el) segRefs[i] = el;
                }
              "
              class="mb-4 rounded-lg px-3 py-2 transition-all duration-300"
              :class="[
                seg.type === 'narration' ? 'text-[17px] leading-loose text-[#c8c8e8] indent-8 tracking-wide break-all italic' : 'text-[17px] leading-loose text-[#dde0ff] tracking-wide break-all',
                i === currentSegIdx ? 'bg-[rgba(124,111,247,0.18)] border-l-[3px] border-[#7c6ff7] pl-4 indent-0' : '',
              ]"
            >
              <div v-if="seg.type === 'dialogue' || getReferenceAudioLabel(seg)" class="mb-1 not-italic">
                <div class="flex flex-wrap items-center gap-2">
                  <span v-if="seg.type === 'dialogue'" class="text-[12px] text-[#8866cc] font-semibold">{{ seg.role }}</span>
                  <button
                    v-if="getReferenceAudioLabel(seg)"
                    type="button"
                    class="inline-flex items-center gap-1 rounded-full border border-[rgba(124,111,247,0.35)] bg-[rgba(124,111,247,0.14)] px-2 py-0.5 text-[11px] text-[#cfc4ff] cursor-pointer transition-colors duration-200 hover:bg-[rgba(124,111,247,0.24)]"
                    @click="openSegmentEditor(seg, i)"
                  >
                    <span class="text-[#9f8df2]">参考音频</span>
                    <span class="text-[#f1ecff]">{{ getReferenceAudioLabel(seg) }}</span>
                  </button>
                  <button
                    v-else
                    type="button"
                    class="inline-flex items-center gap-1 rounded-full border border-[rgba(124,111,247,0.25)] bg-[rgba(124,111,247,0.08)] px-2 py-0.5 text-[11px] text-[#aeb0de] cursor-pointer transition-colors duration-200 hover:bg-[rgba(124,111,247,0.16)]"
                    @click="openSegmentEditor(seg, i)"
                  >
                    <span>设置参考音频</span>
                  </button>
                  <span
                    v-if="seg.manualAssigned"
                    class="inline-flex items-center gap-1 rounded-full border border-[rgba(68,211,166,0.3)] bg-[rgba(68,211,166,0.12)] px-2 py-0.5 text-[11px] text-[#b6f7e1]"
                  >
                    <span class="text-[#5eead4]">手动覆盖</span>
                    <span>后续优先</span>
                  </span>
                  <span
                    v-if="seg.autoAssignedVoiceActor"
                    class="inline-flex items-center gap-1 rounded-full border border-[rgba(208,136,255,0.28)] bg-[rgba(208,136,255,0.1)] px-2 py-0.5 text-[11px] text-[#efccff]"
                  >
                    <span class="text-[#d088ff]">声线</span>
                    <span>{{ seg.autoAssignedVoiceActor }}</span>
                  </span>
                  <span
                    v-if="seg.referenceAudioFallback === 'neutral'"
                    class="inline-flex items-center gap-1 rounded-full border border-[rgba(255,181,71,0.28)] bg-[rgba(255,181,71,0.1)] px-2 py-0.5 text-[11px] text-[#ffd79a]"
                  >
                    <span class="text-[#ffbe55]">已回退</span>
                    <span>平静</span>
                  </span>
                  <span
                    v-else-if="seg.emotion && !getReferenceAudioLabel(seg) && seg.type === 'dialogue'"
                    class="inline-flex items-center gap-1 rounded-full border border-[rgba(255,120,120,0.28)] bg-[rgba(255,120,120,0.1)] px-2 py-0.5 text-[11px] text-[#ffb8b8]"
                  >
                    <span class="text-[#ff8b8b]">未配置</span>
                    <span>{{ emotionLabelMap[seg.emotion] || seg.emotion }}</span>
                  </span>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[11px] text-[#d8d9f7] cursor-pointer transition-colors duration-200 hover:bg-[rgba(255,255,255,0.12)]"
                    @click="openSegmentEditor(seg, i)"
                  >
                    <span>编辑片段</span>
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors duration-200"
                    :class="
                      seg.audioUrl
                        ? 'cursor-pointer border border-[rgba(94,234,212,0.3)] bg-[rgba(94,234,212,0.1)] text-[#c8fff2] hover:bg-[rgba(94,234,212,0.2)]'
                        : isSegmentRegenerating(i)
                          ? 'cursor-wait border border-[rgba(255,191,94,0.28)] bg-[rgba(255,191,94,0.12)] text-[#ffd480]'
                          : 'cursor-pointer border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.06)] text-[#cfd1f3] hover:bg-[rgba(255,255,255,0.12)]'
                    "
                    :disabled="isSegmentRegenerating(i)"
                    @click="handleSegmentAction(i)"
                  >
                    <span>{{ seg.audioUrl ? "从这里播放" : isSegmentRegenerating(i) ? "生成中..." : "音频待生成" }}</span>
                  </button>
                </div>
              </div>
              <div>
                <span v-if="seg.type === 'dialogue'" class="sr-only">{{ seg.role }}：</span>
                {{ seg.text }}
              </div>
            </div>
            <!-- 生成中占位提示 -->
            <div v-if="listenState === 'loading'" class="flex items-center gap-2 text-[#555577] text-sm py-4">
              <span class="inline-block w-3.5 h-3.5 border-2 border-[#555577]/40 border-t-[#555577] rounded-full animate-spin"></span>
              <span>正在生成后续音频，可以开始阅读…</span>
            </div>
          </template>

          <!-- 普通阅读模式：渲染原始段落 -->
          <template v-else>
            <div v-for="(para, i) in contentParagraphs" :key="i" class="text-[17px] leading-loose text-[#c8c8e8] mb-4 indent-8 tracking-wide break-all">{{ para }}</div>
          </template>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="flex items-center justify-between px-6 py-3.5 bg-[rgba(12,12,28,0.98)] border-t border-[#2a2a4a] shrink-0">
        <button
          class="flex items-center gap-1 px-7 py-2.5 bg-[rgba(124,111,247,0.12)] border border-[rgba(124,111,247,0.3)] rounded-xl text-[#a09ef5] text-[15px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:bg-[rgba(124,111,247,0.28)] disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none"
          :disabled="currentChapterIndex <= 0"
          @click="goPrevChapter"
        >
          <el-icon><ArrowLeft /></el-icon> 上一章
        </button>
        <span class="text-[#6666aa] text-[14px]">{{ currentChapterIndex + 1 }} / {{ chapterList.length }}</span>
        <button
          class="flex items-center gap-1 px-7 py-2.5 bg-[rgba(124,111,247,0.12)] border border-[rgba(124,111,247,0.3)] rounded-xl text-[#a09ef5] text-[15px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:bg-[rgba(124,111,247,0.28)] disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none"
          :disabled="currentChapterIndex >= chapterList.length - 1"
          @click="goNextChapter"
        >
          下一章 <el-icon><ArrowRight /></el-icon>
        </button>
      </div>
    </div>
  </div>

  <el-dialog v-model="segmentEditorVisible" :title="segmentEditForm.role ? `编辑片段 · ${segmentEditForm.role}` : '编辑片段'" width="560px" destroy-on-close>
    <div class="flex flex-col gap-4">
      <div class="rounded-xl border border-[rgba(124,111,247,0.2)] bg-[rgba(124,111,247,0.08)] px-4 py-3 text-[13px] leading-6 text-[#686868]">
        这里可以像调度台一样修改当前片段的角色、情绪和参考音频。保存后只会让当前片段音频失效；如果你为对话角色改了参考音频，后续章节会优先沿用这次手动指定的角色声线。
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-2">
          <div class="text-sm text-[#bfbfe6]">角色</div>
          <el-select v-model="segmentEditForm.role" filterable allow-create default-first-option @change="handleSegmentRoleChange">
            <el-option label="旁白" value="旁白" />
            <el-option v-for="roleName in availableSegmentRoles" :key="roleName" :label="roleName" :value="roleName" />
          </el-select>
        </div>

        <div class="flex flex-col gap-2">
          <div class="text-sm text-[#bfbfe6]">情绪</div>
          <el-select v-model="segmentEditForm.emotion" @change="handleSegmentEmotionChange">
            <el-option label="高兴" value="happy" />
            <el-option label="愤怒" value="angry" />
            <el-option label="悲伤" value="sad" />
            <el-option label="害怕" value="fearful" />
            <el-option label="厌恶" value="disgusted" />
            <el-option label="忧郁" value="melancholy" />
            <el-option label="惊讶" value="surprised" />
            <el-option label="平静" value="neutral" />
          </el-select>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <div class="text-sm text-[#bfbfe6]">参考音频</div>
        <el-select v-model="selectedSegmentAudioId" placeholder="选择新的参考音频" filterable clearable class="w-full">
          <el-option v-for="audio in audioOptions" :key="audio.id" :label="audio.name" :value="audio.id" />
        </el-select>
        <div class="text-[12px] text-[#7f7fa8]">改情绪时会先按调度台规则自动重算参考音频；你也可以在这里手动改成别的参考音频。</div>
      </div>

      <audio v-if="selectedSegmentAudioPreviewUrl" :src="selectedSegmentAudioPreviewUrl" controls class="w-full h-10"></audio>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <el-button @click="segmentEditorVisible = false">取消</el-button>
        <!-- <el-button @click="openRoleSetup">编辑当前书角色音频</el-button> -->
        <el-button type="primary" :loading="isSavingSegmentEdit" @click="saveSegmentEdit">保存片段修改</el-button>
      </div>
    </template>
  </el-dialog>

  <RoleAudioSetupDialog ref="roleAudioSetupDialogRef" @saved="handleAudioSetupSaved" />
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import axios from "axios";
import { ElLoading, ElMessage } from "element-plus";
import RoleAudioSetupDialog from "./RoleAudioSetupDialog.vue";
import { Search, ArrowLeft, ArrowRight, WarnTriangleFilled } from "@element-plus/icons-vue";
const API = "http://localhost:3000";

// ── 状态机 ──
const viewState = ref("search"); // 'search' | 'chapters' | 'reading'
const SEARCH_HISTORY_KEY = "voiceweaver_reader_search_history";
const READING_HISTORY_KEY = "voiceweaver_reader_reading_history";
const SEARCH_HISTORY_LIMIT = 12;
const READING_HISTORY_LIMIT = 8;

// ── 搜索 ──
const searchKeyword = ref("");
const isSearching = ref(false);
const hasSearched = ref(false);
const searchResults = ref([]);
const searchHistory = ref([]);
const readingHistory = ref([]);

function loadLocalList(key) {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn(`读取本地数据失败: ${key}`, e.message);
    return [];
  }
}

function persistLocalList(key, list) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(list));
}

function saveSearchHistory(keyword) {
  const value = String(keyword || "").trim();
  if (!value) return;
  const nextHistory = [
    { keyword: value, updatedAt: Date.now() },
    ...searchHistory.value.filter((item) => item.keyword !== value),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  searchHistory.value = nextHistory;
  persistLocalList(SEARCH_HISTORY_KEY, nextHistory);
}

function saveReadingHistory() {
  if (!selectedBook.value || !selectedChapter.value) return;
  const now = Date.now();
  const historyItem = {
    id: `${selectedBook.value.bookUrl}::${currentChapterIndex.value}`,
    bookUrl: selectedBook.value.bookUrl,
    bookName: selectedBook.value.name,
    author: selectedBook.value.author,
    coverUrl: selectedBook.value.coverUrl || "",
    origin: selectedBook.value.origin,
    originName: selectedBook.value.originName,
    intro: selectedBook.value.intro || "",
    latestChapterTitle: selectedBook.value.latestChapterTitle || "",
    chapterIndex: currentChapterIndex.value,
    chapterTitle: selectedChapter.value.title,
    chapterUrl: selectedChapter.value.bookUrl,
    searchKeyword: searchKeyword.value.trim(),
    updatedAt: now,
  };
  const nextHistory = [
    historyItem,
    ...readingHistory.value.filter((item) => item.bookUrl !== historyItem.bookUrl),
  ].slice(0, READING_HISTORY_LIMIT);
  readingHistory.value = nextHistory;
  persistLocalList(READING_HISTORY_KEY, nextHistory);
}

function clearSearchHistory() {
  searchHistory.value = [];
  persistLocalList(SEARCH_HISTORY_KEY, []);
}

function clearReadingHistory() {
  readingHistory.value = [];
  persistLocalList(READING_HISTORY_KEY, []);
}

function formatHistoryTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reuseSearchKeyword(keyword) {
  searchKeyword.value = keyword || "";
  doSearch();
}

const doSearch = async () => {
  const key = searchKeyword.value.trim();
  if (!key) return;
  isSearching.value = true;
  hasSearched.value = false;
  searchResults.value = [];
  try {
    const res = await axios.get(`${API}/api/reader/searchBookMultiSSE`, {
      params: { key, concurrentCount: 4 },
    });
    searchResults.value = res.data.data || [];
    saveSearchHistory(key);
  } catch (e) {
    console.error("搜索失败", e);
    searchResults.value = [];
  } finally {
    isSearching.value = false;
    hasSearched.value = true;
  }
};

// ── 选书 → 章节 ──
const selectedBook = ref(null);
const chapterList = ref([]);
const isLoadingChapters = ref(false);

const selectBook = async (book) => {
  selectedBook.value = book;
  viewState.value = "chapters";
  chapterList.value = [];
  isLoadingChapters.value = true;
  try {
    const res = await axios.get(`${API}/api/reader/getChapterList`, {
      params: { url: book.bookUrl, bookSourceUrl: book.origin },
    });
    if (res.data.isSuccess) {
      chapterList.value = res.data.data || [];
    }
  } catch (e) {
    console.error("获取章节列表失败", e);
  } finally {
    isLoadingChapters.value = false;
  }
};

const resumeReading = async (historyItem) => {
  const book = {
    name: historyItem.bookName,
    author: historyItem.author,
    coverUrl: historyItem.coverUrl,
    bookUrl: historyItem.bookUrl,
    origin: historyItem.origin,
    originName: historyItem.originName,
    intro: historyItem.intro,
    latestChapterTitle: historyItem.latestChapterTitle,
  };
  searchKeyword.value = historyItem.searchKeyword || historyItem.bookName || "";
  await selectBook(book);
  if (!chapterList.value.length) {
    ElMessage.warning("未能恢复章节列表，请重新搜索后再试");
    return;
  }

  const historyIndex = Number.isFinite(Number(historyItem.chapterIndex)) ? Number(historyItem.chapterIndex) : 0;
  const matchedIndex = chapterList.value.findIndex((chap) => chap.bookUrl === historyItem.chapterUrl || chap.title === historyItem.chapterTitle);
  let targetIndex = matchedIndex >= 0 ? matchedIndex : Math.min(historyIndex, chapterList.value.length - 1);

  while (targetIndex < chapterList.value.length && chapterList.value[targetIndex]?.isVolume) {
    targetIndex += 1;
  }

  const targetChapter = chapterList.value[targetIndex] || chapterList.value.find((chap) => !chap.isVolume);
  if (!targetChapter) {
    ElMessage.warning("未找到上次阅读的章节");
    return;
  }

  await selectChapter(targetChapter, chapterList.value.indexOf(targetChapter));
};

// ── 选章 → 阅读 ──
const selectedChapter = ref(null);
const currentChapterIndex = ref(0);
const contentParagraphs = ref([]);
const isLoadingContent = ref(false);
const readingBody = ref(null);

const selectChapter = async (chap, idx) => {
  resetListen();
  selectedChapter.value = chap;
  currentChapterIndex.value = idx;
  viewState.value = "reading";
  await fetchGenerationSettings();
  await fetchContent(chap, idx);
  // 进入阅读视图后自动检查是否已有听书缓存
  await checkListenCache();
};

const fetchContent = async (chap, idx) => {
  contentParagraphs.value = [];
  isLoadingContent.value = true;
  await nextTick();
  if (readingBody.value) readingBody.value.scrollTop = 0;
  try {
    const res = await axios.get(`${API}/api/reader/getBookContent`, {
      params: { url: chap.bookUrl, index: idx },
    });
    if (res.data.isSuccess) {
      contentParagraphs.value = (res.data.data || "")
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      saveReadingHistory();
    }
  } catch (e) {
    console.error("获取正文失败", e);
  } finally {
    isLoadingContent.value = false;
  }
};

// 上 / 下章
const goPrevChapter = () => {
  const idx = currentChapterIndex.value - 1;
  if (idx < 0) return;
  selectChapter(chapterList.value[idx], idx);
};
const goNextChapter = () => {
  const idx = currentChapterIndex.value + 1;
  if (idx >= chapterList.value.length) return;
  selectChapter(chapterList.value[idx], idx);
};

// 图片加载失败回退
const handleImgError = (e) => {
  e.target.style.display = "none";
  e.target.nextElementSibling && (e.target.nextElementSibling.style.display = "flex");
};

const backToSearch = async () => {
  await resetListen();
  viewState.value = "search";
};

const backToChapters = async () => {
  await resetListen();
  viewState.value = "chapters";
};

// ════════════════════════════════════════════════════════════
// 听书功能
// ════════════════════════════════════════════════════════════

// 项目名以书名命名（避免与手动项目冲突）
const listenProjectName = computed(() => `reader_${selectedBook.value?.name || "unknown"}`);

// 状态
const listenState = ref("idle"); // idle | loading | ready | error
const listenPhase = ref(""); // prescan | parse | assign | tts | done
const segments = ref([]); // { index, type, role, emotion, text, audioUrl }
const currentSegIdx = ref(-1); // 当前播放的 segment 索引
const nextSegIdx = ref(0); // 下一条待播放的 segment 索引
const isPlaying = ref(false);
const segRefs = ref([]); // DOM 引用，用于自动滚动
const listenTaskId = ref(null);
const prefetchTaskIds = ref([]);
const audioRecordMap = ref({});
const audioOptions = ref([]);
const globalAudioBindings = ref({});
const roleAudioSetupDialogRef = ref(null);
const segmentEditorVisible = ref(false);
const isSavingSegmentEdit = ref(false);
const segmentRegeneratingMap = ref({});
const editingSegmentIndex = ref(-1);
const selectedSegmentAudioId = ref(null);
const segmentEditForm = ref({
  type: "dialogue",
  role: "",
  emotion: "neutral",
  text: "",
  referenceAudio: null,
  autoEmotionAudioMap: null,
  autoAssignedVoiceActor: null,
  manualAssigned: false,
});
const missingEmotionPolicy = ref("fallback_neutral"); // strict | fallback_neutral
const emotionLabelMap = {
  happy: "高兴",
  angry: "愤怒",
  sad: "悲伤",
  fearful: "害怕",
  disgusted: "厌恶",
  melancholy: "忧郁",
  surprised: "惊讶",
  neutral: "平静",
};
// 轮询定时器
let pollTimer = null;
// 当前播放的 Audio 对象
let currentAudio = null;
// 每次启动新播放时递增，旧循环据此自行失效
let playbackSessionId = 0;
// 是否强制停止（切章、重置时）
let forceStop = false;
// 当前章节的 TTS 生成是否已全部完成
const isGenerationComplete = ref(false);
// 段间播放间隔，单位毫秒。可直接在这里调整。
const SEGMENT_PLAY_GAP_MS = 1500;

// 阶段文案
const phaseTextMap = {
  waiting: "准备中…",
  prescan: "正在预扫描章节角色…",
  parse: "正在分析剧情对话…",
  assign: "正在分配参考音频…",
  tts: "正在生成语音…",
  done: "",
};
const listenPhaseText = computed(() => phaseTextMap[listenPhase.value] || "处理中…");

async function fetchAudioRecords() {
  try {
    const res = await axios.get(`${API}/api/audio/list`);
    if (!res.data?.success || !Array.isArray(res.data.list)) return;
    audioOptions.value = res.data.list;
    audioRecordMap.value = res.data.list.reduce((acc, item) => {
      if (item?.id) acc[item.id] = item;
      return acc;
    }, {});
  } catch (e) {
    console.warn("获取参考音频列表失败", e.message);
  }
}

async function fetchGlobalBindings() {
  const projectName = listenProjectName.value;
  if (!projectName || projectName === "reader_unknown") {
    globalAudioBindings.value = {};
    return {};
  }
  try {
    const globalRes = await axios.get(`${API}/api/audio/global-roles`, {
      params: { projectName },
    });
    if (globalRes.data?.success) {
      globalAudioBindings.value = globalRes.data.roles || {};
      return globalAudioBindings.value;
    }
  } catch (e) {
    console.warn("获取全局角色绑定失败", e.message);
  }
  return {};
}

async function fetchGenerationSettings() {
  const projectName = listenProjectName.value;
  if (!projectName || projectName === "reader_unknown") return;
  try {
    const res = await axios.get(`${API}/api/reader/generation-settings`, {
      params: { projectName },
    });
    if (res.data?.success && res.data?.settings?.missingEmotionPolicy) {
      missingEmotionPolicy.value = res.data.settings.missingEmotionPolicy;
    }
  } catch (e) {
    console.warn("获取阅读生成策略失败", e.message);
  }
}

async function saveGenerationSettings() {
  const projectName = listenProjectName.value;
  if (!projectName || projectName === "reader_unknown") return;
  try {
    await axios.post(`${API}/api/reader/generation-settings`, {
      projectName,
      missingEmotionPolicy: missingEmotionPolicy.value,
    });
    ElMessage.success(missingEmotionPolicy.value === "strict" ? "后续生成已改为严格匹配情绪" : "后续生成已改为缺失时回退平静");
  } catch (e) {
    console.error("保存阅读生成策略失败", e);
    ElMessage.error("保存生成策略失败");
  }
}

function getReferenceAudioConfig(seg) {
  if (!seg?.referenceAudio) return null;
  if (typeof seg.referenceAudio === "string") {
    return { id: seg.referenceAudio };
  }
  return seg.referenceAudio;
}

function getReferenceAudioLabel(seg) {
  const config = getReferenceAudioConfig(seg);
  if (!config) return "";
  const record = config.id ? audioRecordMap.value[config.id] : null;
  if (record?.name) return record.name;
  if (config.id) return `ID: ${config.id.slice(0, 8)}`;
  if (config.mode === 3) return "向量控制";
  return "";
}

const selectedSegmentAudioPreviewUrl = computed(() => {
  if (!selectedSegmentAudioId.value) return "";
  const audio = audioRecordMap.value[selectedSegmentAudioId.value];
  return audio?.url ? `${API}${audio.url}` : "";
});

const availableSegmentRoles = computed(() => {
  const roleSet = new Set();
  segments.value.forEach((seg) => {
    if (seg?.role && seg.role !== "旁白") {
      roleSet.add(seg.role);
    }
  });
  return Array.from(roleSet);
});

function cloneConfig(data) {
  return data ? JSON.parse(JSON.stringify(data)) : data;
}

function getVoiceActorFromAudioId(audioId) {
  const record = audioId ? audioRecordMap.value[audioId] : null;
  const name = String(record?.name || "").trim();
  if (!name) return null;
  const [voiceActor] = name.split("-").map((item) => item.trim());
  return voiceActor || null;
}

function parseAudioRecordMeta(audioId) {
  const record = audioId ? audioRecordMap.value[audioId] : null;
  const name = String(record?.name || "").trim();
  if (!name) return null;
  const parts = name
    .split("-")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  return {
    voiceActor: parts[0] || null,
    emotion: parts[1] || "neutral",
    gender: parts[2] || null,
  };
}

function normalizeAudioEmotion(emotion) {
  const val = String(emotion || "").trim().toLowerCase();
  const map = {
    happy: "happy",
    开心: "happy",
    高兴: "happy",
    angry: "angry",
    生气: "angry",
    愤怒: "angry",
    sad: "sad",
    悲伤: "sad",
    fearful: "fearful",
    害怕: "fearful",
    恐惧: "fearful",
    disgusted: "disgusted",
    厌恶: "disgusted",
    melancholy: "melancholy",
    忧郁: "melancholy",
    忧伤: "melancholy",
    surprised: "surprised",
    惊讶: "surprised",
    neutral: "neutral",
    平静: "neutral",
  };
  return map[val] || "neutral";
}

function buildEmotionAudioMapForVoiceActor(audioId) {
  const meta = parseAudioRecordMeta(audioId);
  if (!meta?.voiceActor) return null;

  const emotionMap = {};
  audioOptions.value.forEach((audio) => {
    const itemMeta = parseAudioRecordMeta(audio.id);
    if (!itemMeta || itemMeta.voiceActor !== meta.voiceActor) return;
    const emotion = normalizeAudioEmotion(itemMeta.emotion);
    if (!emotionMap[emotion]) {
      emotionMap[emotion] = { id: audio.id, mode: 1, emoWeight: 0.65 };
    }
  });

  return Object.keys(emotionMap).length ? emotionMap : null;
}

function buildGlobalBindingPayloadFromEmotionMap(emotionMap) {
  if (!emotionMap || typeof emotionMap !== "object") return null;
  const payload = {};

  Object.keys(emotionLabelMap).forEach((emotion) => {
    const conf = emotionMap[emotion];
    if (!conf?.id) {
      payload[emotion] = null;
      return;
    }
    payload[emotion] = {
      id: conf.id,
      mode: conf.mode || 1,
      emoWeight: conf.emoWeight ?? 0.65,
    };
  });

  return payload;
}

function pickReferenceAudioByEmotion(emotionMap, emotion) {
  if (!emotionMap || typeof emotionMap !== "object") return null;
  const normalizedEmotion = normalizeAudioEmotion(emotion);
  if (emotionMap[normalizedEmotion]) {
    return cloneConfig(emotionMap[normalizedEmotion]);
  }
  if (missingEmotionPolicy.value === "fallback_neutral" && emotionMap.neutral) {
    return cloneConfig(emotionMap.neutral);
  }
  return null;
}

function applyEmotionToSegment(segment) {
  const currentEmotion = segment.emotion || "neutral";

  if (segment.autoEmotionAudioMap) {
    segment.referenceAudio = pickReferenceAudioByEmotion(segment.autoEmotionAudioMap, currentEmotion);
    return;
  }

  if (segment.role && globalAudioBindings.value[segment.role]) {
    const roleData = globalAudioBindings.value[segment.role];
    if (roleData[currentEmotion]) {
      segment.referenceAudio = cloneConfig(roleData[currentEmotion]);
      return;
    }
  }

  if (segment.role === "旁白" && segment.referenceAudio) {
    return;
  }

  segment.referenceAudio = null;
}

function applyRoleToSegment(segment) {
  if (segment.role === "旁白") {
    segment.type = "narration";
  } else {
    segment.type = "dialogue";
  }

  delete segment.referenceAudio;
  delete segment.autoEmotionAudioMap;
  delete segment.autoAssignedVoiceActor;

  if (segment.role === "旁白") {
    const sameRoleSeg = segments.value.find((item) => item !== segments.value[editingSegmentIndex.value] && item.role === "旁白" && item.referenceAudio);
    if (sameRoleSeg) {
      segment.referenceAudio = cloneConfig(sameRoleSeg.referenceAudio);
    }
  } else if (segment.role) {
    const sameRoleSeg = segments.value.find((item) => item !== segments.value[editingSegmentIndex.value] && item.role === segment.role && item.autoEmotionAudioMap);
    if (sameRoleSeg) {
      segment.autoEmotionAudioMap = cloneConfig(sameRoleSeg.autoEmotionAudioMap);
      segment.autoAssignedVoiceActor = sameRoleSeg.autoAssignedVoiceActor || null;
    }
  }

  applyEmotionToSegment(segment);
}

function handleSegmentRoleChange() {
  applyRoleToSegment(segmentEditForm.value);
  selectedSegmentAudioId.value = getReferenceAudioConfig(segmentEditForm.value)?.id || null;
}

function handleSegmentEmotionChange() {
  applyEmotionToSegment(segmentEditForm.value);
  selectedSegmentAudioId.value = getReferenceAudioConfig(segmentEditForm.value)?.id || null;
}

async function openSegmentEditor(seg, index) {
  if (!audioOptions.value.length) {
    await fetchAudioRecords();
  }
  if (!Object.keys(globalAudioBindings.value).length) {
    await fetchGlobalBindings();
  }

  editingSegmentIndex.value = index;
  segmentEditForm.value = {
    type: seg.type || (seg.role === "旁白" ? "narration" : "dialogue"),
    role: seg.role || "旁白",
    emotion: seg.emotion || "neutral",
    text: seg.text || "",
    referenceAudio: cloneConfig(seg.referenceAudio),
    autoEmotionAudioMap: cloneConfig(seg.autoEmotionAudioMap),
    autoAssignedVoiceActor: seg.autoAssignedVoiceActor || null,
    manualAssigned: Boolean(seg.manualAssigned),
  };
  selectedSegmentAudioId.value = getReferenceAudioConfig(seg)?.id || null;
  segmentEditorVisible.value = true;
}

async function persistChapterEdits(invalidatedSegmentIndexes = [editingSegmentIndex.value]) {
  await axios.post(`${API}/api/listen-book/chapter-edits`, {
    projectName: listenProjectName.value,
    chapterIndex: currentChapterIndex.value,
    invalidatedSegmentIndexes,
    segments: segments.value.map((seg) => ({
      type: seg.type,
      role: seg.role,
      emotion: seg.emotion || "neutral",
      text: seg.text || "",
      referenceAudio: seg.referenceAudio || null,
      autoEmotionAudioMap: seg.autoEmotionAudioMap || null,
      autoAssignedVoiceActor: seg.autoAssignedVoiceActor || null,
      manualAssigned: Boolean(seg.manualAssigned),
    })),
  });
}

function stopListenForManualEdit() {
  forceStop = true;
  playbackSessionId += 1;
  stopPolling();
  stopCurrentAudio();
  forceStop = false;
  listenTaskId.value = null;
  if (segments.value.length) {
    listenState.value = "ready";
  } else {
    listenState.value = "idle";
  }
  listenPhase.value = "";
  currentSegIdx.value = -1;
  nextSegIdx.value = 0;
  isPlaying.value = false;
  isGenerationComplete.value = true;
}

async function markListenDirty() {
  stopListenForManualEdit();
  await cancelListenTasks().catch(() => {});
  prefetchTaskIds.value = [];
  listenState.value = "idle";
  isGenerationComplete.value = false;
}

function isSegmentRegenerating(index) {
  return Boolean(segmentRegeneratingMap.value[index]);
}

async function syncRoleOverrideForSegment(segment, audioId) {
  if (!audioId || segment.type !== "dialogue" || !segment.role || segment.role === "旁白") {
    return;
  }

  await axios.post(`${API}/api/reader/role-audio-override`, {
    projectName: listenProjectName.value,
    role: segment.role,
    audioId,
    chapterIndex: currentChapterIndex.value + 1,
    skipCacheInvalidation: true,
  });
}

async function syncGlobalBindingsForRole(role, emotionMap) {
  if (!role || role === "旁白") return;
  const bindingPayload = buildGlobalBindingPayloadFromEmotionMap(emotionMap);
  if (!bindingPayload) return;

  await axios.post(`${API}/api/audio/global-roles`, {
    projectName: listenProjectName.value,
    bindings: {
      [role]: bindingPayload,
    },
  });
  await fetchGlobalBindings();
}

function buildFutureRoleUpdatePayload(role, audioId, emotionMap, voiceActor) {
  if (!audioId || !role || role === "旁白") return null;
  return {
    role,
    audioId,
    emotionMap: emotionMap ? cloneConfig(emotionMap) : null,
    voiceActor: voiceActor || null,
  };
}

async function autoRegenerateAfterSegmentEdit(invalidatedIndexes, futureRoleUpdate = null) {
  const loading = ElLoading.service({
    lock: true,
    text: "正在重新生成当前章节音频，请稍候…",
    background: "rgba(10, 10, 20, 0.72)",
  });

  try {
    stopCurrentAudio();
    isPlaying.value = false;

    const res = await axios.post(`${API}/api/listen-book/auto-regenerate-after-edit`, {
      projectName: listenProjectName.value,
      currentChapterIndex: currentChapterIndex.value,
      invalidatedSegmentIndexes: invalidatedIndexes,
      futureRoleUpdate,
    });

    if (Array.isArray(res.data?.segments)) {
      segments.value = res.data.segments;
    }
    listenState.value = "ready";
    isGenerationComplete.value = true;

    const failedIndexes = Array.isArray(res.data?.failedIndexes) ? res.data.failedIndexes : [];
    const queuedFutureChapters = Array.isArray(res.data?.queuedFutureChapters) ? res.data.queuedFutureChapters : [];

    if (failedIndexes.length) {
      ElMessage.warning(`当前章节有 ${failedIndexes.length} 个片段自动生成失败，请手动重试。`);
      return;
    }

    if (queuedFutureChapters.length) {
      ElMessage.success(`当前章节已自动重生成，后续 ${queuedFutureChapters.length} 个已缓存章节正在后台静默更新。`);
      return;
    }

    ElMessage.success("当前章节受影响片段已自动重生成完成。");
  } finally {
    loading.close();
  }
}

async function saveSegmentEdit() {
  if (editingSegmentIndex.value < 0) return;
  isSavingSegmentEdit.value = true;
  try {
    const nextSegment = cloneConfig(segmentEditForm.value);
    const manualEmotionMap = selectedSegmentAudioId.value ? buildEmotionAudioMapForVoiceActor(selectedSegmentAudioId.value) : null;
    nextSegment.autoEmotionAudioMap = manualEmotionMap ? cloneConfig(manualEmotionMap) : nextSegment.autoEmotionAudioMap || null;
    nextSegment.referenceAudio = manualEmotionMap
      ? pickReferenceAudioByEmotion(manualEmotionMap, nextSegment.emotion)
      : selectedSegmentAudioId.value
        ? { id: selectedSegmentAudioId.value, mode: 1, emoWeight: 0.65 }
        : null;
    nextSegment.manualAssigned = true;
    nextSegment.audioUrl = null;
    const nextRole = nextSegment.role || "旁白";
    const nextVoiceActor = getVoiceActorFromAudioId(selectedSegmentAudioId.value);
    const invalidatedIndexes = [];

    segments.value = segments.value.map((seg, index) => {
      if (index === editingSegmentIndex.value) {
        invalidatedIndexes.push(index);
        return {
          ...nextSegment,
          autoAssignedVoiceActor: nextVoiceActor || nextSegment.autoAssignedVoiceActor || null,
          autoEmotionAudioMap: manualEmotionMap ? cloneConfig(manualEmotionMap) : nextSegment.autoEmotionAudioMap || null,
        };
      }

      if (selectedSegmentAudioId.value && nextSegment.type === "dialogue" && seg.role === nextRole) {
        const syncedReferenceAudio = manualEmotionMap
          ? pickReferenceAudioByEmotion(manualEmotionMap, seg.emotion) || cloneConfig(manualEmotionMap.neutral)
          : { id: selectedSegmentAudioId.value, mode: 1, emoWeight: 0.65 };
        invalidatedIndexes.push(index);
        return {
          ...seg,
          referenceAudio: syncedReferenceAudio,
          autoAssignedVoiceActor: nextVoiceActor,
          autoEmotionAudioMap: manualEmotionMap ? cloneConfig(manualEmotionMap) : null,
          manualAssigned: true,
          audioUrl: null,
        };
      }

      return seg;
    });

    stopListenForManualEdit();
    await syncRoleOverrideForSegment(nextSegment, selectedSegmentAudioId.value);
    await syncGlobalBindingsForRole(nextRole, manualEmotionMap);
    const normalizedInvalidatedIndexes = [...new Set(invalidatedIndexes)];
    await persistChapterEdits(normalizedInvalidatedIndexes);
    segmentEditorVisible.value = false;
    await autoRegenerateAfterSegmentEdit(
      normalizedInvalidatedIndexes,
      buildFutureRoleUpdatePayload(nextRole, selectedSegmentAudioId.value, manualEmotionMap, nextVoiceActor),
    );
  } catch (e) {
    console.error("保存片段修改失败", e);
    ElMessage.error(e.response?.data?.error || "保存失败，请稍后重试");
  } finally {
    isSavingSegmentEdit.value = false;
  }
}

function openRoleSetup() {
  if (!segments.value.length || !roleAudioSetupDialogRef.value) return;
  const roles = [...new Set(segments.value.filter((seg) => seg.role).map((seg) => seg.role))];
  const autoPrefill = {};

  segments.value.forEach((seg) => {
    if (!seg) return;
    const roleKey = seg.role || (seg.type === "narration" ? "旁白" : "");
    if (!roleKey) return;
    if (!autoPrefill[roleKey]) autoPrefill[roleKey] = {};

    if (seg.autoEmotionAudioMap && typeof seg.autoEmotionAudioMap === "object") {
      Object.keys(seg.autoEmotionAudioMap).forEach((emotion) => {
        const conf = seg.autoEmotionAudioMap[emotion];
        if (conf && conf.id && !autoPrefill[roleKey][emotion]) {
          autoPrefill[roleKey][emotion] = { id: conf.id, mode: conf.mode || 1, emoWeight: conf.emoWeight ?? 0.65 };
        }
      });
    }

    if ((seg.type === "narration" || roleKey === "旁白") && seg.referenceAudio && seg.referenceAudio.id && !autoPrefill[roleKey].neutral) {
      autoPrefill[roleKey].neutral = {
        id: seg.referenceAudio.id,
        mode: seg.referenceAudio.mode || 1,
        emoWeight: seg.referenceAudio.emoWeight ?? 0.65,
      };
    }
  });

  roleAudioSetupDialogRef.value.openDialog(roles, autoPrefill, listenProjectName.value);
}

async function handleAudioSetupSaved(bindings) {
  stopListenForManualEdit();
  segments.value = segments.value.map((seg) => {
    const nextSeg = { ...seg };
    if (nextSeg.role && Object.prototype.hasOwnProperty.call(bindings, nextSeg.role)) {
      const emotionMap = bindings[nextSeg.role];
      const currentEmotion = nextSeg.emotion || "neutral";
      nextSeg.referenceAudio = emotionMap && emotionMap[currentEmotion] ? cloneConfig(emotionMap[currentEmotion]) : null;
      nextSeg.manualAssigned = true;
    }
    nextSeg.audioUrl = null;
    return nextSeg;
  });

  await fetchGlobalBindings();
  await axios
    .post(`${API}/api/listen-book/invalidate-cache`, {
      projectName: listenProjectName.value,
      fromChapterIndex: currentChapterIndex.value + 1,
    })
    .catch(() => {});
  await persistChapterEdits([]);
  stopListenForManualEdit();
  ElMessage.success("当前书角色音频已更新，当前章节已同步，后续章节会按新配置生成");
}

// ── 重置听书状态（并发通知后端取消任务）──
async function resetListen(skipCancel = false, useBeacon = false) {
  forceStop = true;
  playbackSessionId += 1;
  stopPolling();
  stopCurrentAudio();
  forceStop = false;
  if (!skipCancel) {
    await cancelListenTasks({ useBeacon });
  }
  listenTaskId.value = null;
  prefetchTaskIds.value = [];
  listenState.value = "idle";
  listenPhase.value = "";
  segments.value = [];
  currentSegIdx.value = -1;
  nextSegIdx.value = 0;
  isPlaying.value = false;
  segRefs.value = [];
  isGenerationComplete.value = false;
}

async function cancelListenTasks({ useBeacon = false } = {}) {
  const projectName = listenProjectName.value;
  if (!projectName || projectName === "reader_unknown") return;

  const url = `${API}/api/listen-book/cancel`;
  const payload = { projectName };

  if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const sent = navigator.sendBeacon(url, new Blob([JSON.stringify(payload)], { type: "application/json" }));
      if (sent) return;
    } catch {}
  }

  if (typeof fetch === "function") {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: useBeacon,
      });
      return;
    } catch {}
  }

  await axios.post(url, payload).catch(() => {});
}

// ── 检查缓存（进入阅读视图时自动调用）──
async function checkListenCache() {
  try {
    const res = await axios.post(`${API}/api/listen-book/check`, {
      projectName: listenProjectName.value,
      chapterIndex: currentChapterIndex.value,
    });
    if (res.data.exists) {
      segments.value = res.data.segments || [];
      isGenerationComplete.value = true;
      listenState.value = "ready";
      await nextTick();
      triggerPrefetch();
    } else if (res.data.inProgress && res.data.taskId) {
      listenTaskId.value = res.data.taskId;
      listenState.value = "loading";
      startPolling(res.data.taskId);
    }
  } catch (e) {
    console.warn("检查听书缓存失败", e.message);
  }
}

// ── 点击「听书」启动 ──
async function startListening() {
  listenState.value = "loading";
  listenPhase.value = "waiting";

  try {
    const res = await axios.post(`${API}/api/listen-book/generate`, {
      projectName: listenProjectName.value,
      chapterIndex: currentChapterIndex.value,
      chapterUrl: selectedChapter.value.bookUrl,
      chapterList: chapterList.value,
    });

    if (res.data.alreadyDone) {
      listenTaskId.value = res.data.taskId || null;
      segments.value = res.data.segments || [];
      isGenerationComplete.value = true;
      listenState.value = "ready";
      autoPlay();
      triggerPrefetch();
      return;
    }

    listenTaskId.value = res.data.taskId;
    startPolling(res.data.taskId);
  } catch (e) {
    console.error("启动听书失败", e);
    listenState.value = "error";
  }
}

// ── 轮询任务状态 ──
// PLAY_THRESHOLD：至少生成多少段才开始播放
const PLAY_THRESHOLD = 5;

function startPolling(taskId) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const res = await axios.get(`${API}/api/listen-book/status/${taskId}`);
      const { phase, segments: segs, error } = res.data;

      listenPhase.value = phase;

      // 实时同步 segments（追加方式，避免覆盖正在播放的引用）
      if (Array.isArray(segs) && segs.length > segments.value.length) {
        segments.value = segs;
      }

      // 达到阈值且当前还在 loading 状态 → 立即开始播放
      if (listenState.value === "loading" && segments.value.length >= PLAY_THRESHOLD) {
        listenState.value = "ready";
        autoPlay(); // 从头开始顺序播放；playFrom 的 for 循环随 segments.value 增长自动延伸
      }

      if (phase === "done") {
        stopPolling();
        // 确保最终 segments 完整
        if (Array.isArray(segs)) segments.value = segs;
        // 标记生成完毕，playFrom 的等待循环会感知并退出
        isGenerationComplete.value = true;
        // 如果还没开始播（段数不足5就生成完了），现在进 ready
        if (listenState.value === "loading") {
          listenState.value = "ready";
          autoPlay();
        }
        // done 后才触发后续章节预缓存
        triggerPrefetch();
      } else if (phase === "error") {
        stopPolling();
        listenState.value = "error";
        console.error("听书生成失败：", error);
      }
    } catch (e) {
      console.warn("轮询失败", e.message);
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function stopCurrentAudio() {
  if (!currentAudio) return;
  currentAudio.onended = null;
  currentAudio.onerror = null;
  currentAudio.pause();
  currentAudio = null;
}

function startPlaybackFrom(startIndex, { autoScroll = true } = {}) {
  if (!segments.value.length) return;
  const safeIndex = Math.max(0, Math.min(startIndex, segments.value.length - 1));
  playbackSessionId += 1;
  stopCurrentAudio();
  currentSegIdx.value = safeIndex;
  nextSegIdx.value = safeIndex;
  isPlaying.value = true;
  if (autoScroll) {
    scrollToSeg(safeIndex);
  }
  playFrom(safeIndex, playbackSessionId);
}

// ── 自动播放（进入 ready 状态后从头开始）──
function autoPlay() {
  startPlaybackFrom(0, { autoScroll: false });
}

// ── 暂停 / 继续 ──
function togglePlayPause() {
  if (isPlaying.value) {
    // 暂停
    isPlaying.value = false;
    if (currentAudio) {
      currentAudio.pause();
    }
  } else {
    // 继续
    isPlaying.value = true;
    if (currentAudio) {
      currentAudio.play();
    } else {
      // 从当前位置重新开始
      const startIdx = nextSegIdx.value >= 0 ? nextSegIdx.value : 0;
      startPlaybackFrom(startIdx, { autoScroll: false });
    }
  }
}

function playSegmentFrom(index) {
  if (index < 0 || index >= segments.value.length) return;
  const target = segments.value[index];
  if (!target?.audioUrl) return;
  if (listenState.value === "idle") {
    listenState.value = "ready";
  }
  startPlaybackFrom(index);
}

async function regenerateSegment(index) {
  if (index < 0 || index >= segments.value.length || isSegmentRegenerating(index)) return;

  segmentRegeneratingMap.value = {
    ...segmentRegeneratingMap.value,
    [index]: true,
  };

  try {
    stopListenForManualEdit();
    const res = await axios.post(`${API}/api/listen-book/regenerate-segment`, {
      projectName: listenProjectName.value,
      chapterIndex: currentChapterIndex.value,
      segmentIndex: index,
    });

    if (Array.isArray(res.data.segments) && res.data.segments.length) {
      segments.value = res.data.segments;
    } else if (res.data.segment) {
      segments.value.splice(index, 1, res.data.segment);
    }

    listenState.value = "ready";
    isGenerationComplete.value = true;
    ElMessage.success("当前片段音频已重新生成");
  } catch (e) {
    console.error("重新生成片段音频失败", e);
    ElMessage.error(e.response?.data?.error || "重新生成失败，请稍后重试");
  } finally {
    const nextMap = { ...segmentRegeneratingMap.value };
    delete nextMap[index];
    segmentRegeneratingMap.value = nextMap;
  }
}

function handleSegmentAction(index) {
  const target = segments.value[index];
  if (!target) return;
  if (target.audioUrl) {
    playSegmentFrom(index);
    return;
  }
  regenerateSegment(index);
}

// ── 顺序播放 segments（从指定索引开始，支持等待后续生成的内容）──
async function playFrom(startIndex, sessionId) {
  let i = startIndex;
  while (true) {
    if (forceStop || !isPlaying.value || sessionId !== playbackSessionId) break;

    if (i >= segments.value.length) {
      // 当前已有 segments 播完，判断是否还有后续生成中
      if (isGenerationComplete.value) break; // 生成已全部完成，真正结束
      // 还在生成中，等待 500ms 后再检查是否有新 segment 到来
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    const seg = segments.value[i];
    currentSegIdx.value = i;
    nextSegIdx.value = i;
    scrollToSeg(i);

    if (seg.audioUrl) {
      await playAudioUrl(seg.audioUrl, sessionId);
    }

    if (!isPlaying.value || sessionId !== playbackSessionId) break;
    nextSegIdx.value = i + 1;

    if (SEGMENT_PLAY_GAP_MS > 0) {
      await waitSegmentGap(SEGMENT_PLAY_GAP_MS);
      if (forceStop || !isPlaying.value || sessionId !== playbackSessionId) break;
    }

    i++;
  }

  // 播放自然结束
  if (sessionId === playbackSessionId && isPlaying.value) {
    isPlaying.value = false;
    currentAudio = null;
    nextSegIdx.value = segments.value.length;
  }
}

function waitSegmentGap(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

// ── 播放单条音频，返回 Promise（播放完毕 resolve）──
function playAudioUrl(url, sessionId) {
  return new Promise((resolve) => {
    if (forceStop || sessionId !== playbackSessionId) {
      resolve();
      return;
    }
    stopCurrentAudio();
    const audio = new Audio(`${API}${url}`);
    currentAudio = audio;
    audio.onended = () => {
      if (currentAudio === audio) {
        currentAudio = null;
      }
      resolve();
    };
    audio.onerror = () => {
      if (currentAudio === audio) {
        currentAudio = null;
      }
      resolve();
    }; // 出错也继续
    audio.play().catch(() => resolve());
  });
}

// ── 自动滚动到当前高亮段落 ──
function scrollToSeg(idx) {
  nextTick(() => {
    const el = segRefs.value[idx];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
}

// ── 后台预生成后续章节（fire-and-forget）──
async function triggerPrefetch() {
  try {
    const configRes = await axios.get(`${API}/api/listen-book/config`);
    const prefetchCount = Number.isFinite(configRes.data.prefetchCount)
      ? Math.max(0, configRes.data.prefetchCount)
      : 2;

    for (let i = 1; i <= prefetchCount; i++) {
      const nextIdx = currentChapterIndex.value + i;
      if (nextIdx >= chapterList.value.length) break;
      const nextChap = chapterList.value[nextIdx];
      // 静默触发，不 await，不报错阻塞
      axios
        .post(`${API}/api/listen-book/generate`, {
          projectName: listenProjectName.value,
          chapterIndex: nextIdx,
          chapterUrl: nextChap.bookUrl,
          chapterList: chapterList.value,
        })
        .then((res) => {
          const taskId = res.data?.taskId;
          if (taskId && !prefetchTaskIds.value.includes(taskId)) {
            prefetchTaskIds.value.push(taskId);
          }
        })
        .catch(() => {});
    }
  } catch {
    // 预生成失败不影响主流程
  }
}

const handlePageLeave = () => {
  if (viewState.value === "reading" || listenTaskId.value) {
    resetListen(false, true);
  }
};

onMounted(() => {
  searchHistory.value = loadLocalList(SEARCH_HISTORY_KEY);
  readingHistory.value = loadLocalList(READING_HISTORY_KEY);
  fetchAudioRecords();
  fetchGlobalBindings();
  window.addEventListener("pagehide", handlePageLeave);
  window.addEventListener("beforeunload", handlePageLeave);
});

onBeforeUnmount(() => {
  window.removeEventListener("pagehide", handlePageLeave);
  window.removeEventListener("beforeunload", handlePageLeave);
  resetListen(false, true);
});
</script>

<style scoped>
/* 滚动条美化 */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #2a2a4a;
  border-radius: 4px;
}
</style>

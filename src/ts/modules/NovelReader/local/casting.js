/** 从后端迁移的角色生命周期分配规则；每次使用隔离的本地快照。 */
export function createCastingEngine(state, audioRecords, environment = {}) {
  const audioRecordsPath = 'records';
  state.records = audioRecords;
  const CASTING_VERSION = 3;
  const ALLOCATION_POLICY_VERSION = 'lifecycle-v1';
  const VOICE_POOL_VALUES = new Set(['general', 'bystander', 'protected']);
  const ROLE_CLASS_VALUES = new Set(['core', 'supporting', 'temporary']);
  const DEFAULT_READER_SETTINGS = {
    /**
     * strict: 严格模式：没有对应情绪音频时，直接显示未配置
     * fallback_neutral: 回退模式：没有对应情绪音频时，自动使用平静音频
     */
    missingEmotionPolicy: 'fallback_neutral',
  };

  const SUPPORTED_PROVIDERS = new Set(['indextts2', 'siliconflow', 'mimoTTS']);

  const EMOTION_ALIASES = {
    happy: 'happy',
    开心: 'happy',
    高兴: 'happy',
    angry: 'angry',
    生气: 'angry',
    愤怒: 'angry',
    sad: 'sad',
    悲伤: 'sad',
    fearful: 'fearful',
    害怕: 'fearful',
    恐惧: 'fearful',
    disgusted: 'disgusted',
    厌恶: 'disgusted',
    melancholy: 'melancholy',
    忧郁: 'melancholy',
    忧伤: 'melancholy',
    surprised: 'surprised',
    惊讶: 'surprised',
    neutral: 'neutral',
    平静: 'neutral',
    common: 'common',
    未知: 'common',
  };

  function readJson(key, fallback) {
    return state[key] || fallback;
  }
  function writeJson(key, data) {
    state[key] = data;
  }

  function parseFiniteInt(value, fallback = null) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeEmotion(emotion) {
    if (!emotion) {
      return 'neutral';
    }
    return EMOTION_ALIASES[String(emotion).trim().toLowerCase()] || 'neutral';
  }

  function normalizeGender(gender) {
    const val = String(gender || '')
      .trim()
      .toLowerCase();
    if (val === '男' || val === 'male' || val === 'm') {
      return 'male';
    }
    if (val === '女' || val === 'female' || val === 'f') {
      return 'female';
    }
    return 'unknown';
  }

  function normalizeVoicePool(pool) {
    const value = String(pool || 'general')
      .trim()
      .toLowerCase();
    return VOICE_POOL_VALUES.has(value) ? value : 'general';
  }

  function normalizeRoleClass(roleClass) {
    const value = String(roleClass || '')
      .trim()
      .toLowerCase();
    if (value === 'main') {
      return 'core';
    }
    if (value === 'temp') {
      return 'temporary';
    }
    return ROLE_CLASS_VALUES.has(value) ? value : null;
  }

  function parseAudioRecordName(recordName) {
    const name = String(recordName || '').trim();
    if (!name) {
      return null;
    }

    const segs = name
      .split('-')
      .map(s => s.trim())
      .filter(Boolean);
    if (segs.length < 2) {
      return null;
    }

    const voiceActor = segs[0];
    const second = segs[1];

    if (second === '旁白' || second.toLowerCase() === 'narration') {
      return {
        voiceActor,
        emotion: 'narration',
        gender: normalizeGender(segs[2]),
      };
    }

    return {
      voiceActor,
      emotion: normalizeEmotion(second),
      gender: normalizeGender(segs[2]),
    };
  }

  function getRoleGenderStats(cards) {
    const stats = {};
    for (const item of cards || []) {
      if (
        !item ||
        item.type !== 'dialogue' ||
        !item.role ||
        item.role === '旁白'
      ) {
        continue;
      }
      if (!stats[item.role]) {
        stats[item.role] = {
          male: 0,
          female: 0,
          unknown: 0,
          dialogueCount: 0,
          emotions: {},
        };
      }
      const g = normalizeGender(item.gender);
      stats[item.role][g] += 1;
      stats[item.role].dialogueCount += 1;
      const emotion = normalizeEmotion(item.emotion);
      stats[item.role].emotions[emotion] =
        (stats[item.role].emotions[emotion] || 0) + 1;
    }
    return stats;
  }

  function decideRoleGender(genderStats) {
    const result = {};
    Object.keys(genderStats || {}).forEach(role => {
      const s = genderStats[role];
      if (s.female > s.male && s.female > 0) {
        result[role] = 'female';
        return;
      }
      if (s.male > s.female && s.male > 0) {
        result[role] = 'male';
        return;
      }
      result[role] = 'unknown';
    });
    return result;
  }

  function getProjectCastingPath() {
    return 'casting';
  }
  function getProjectReaderSettingsPath() {
    return 'settings';
  }
  function getAllocationPolicy() {
    const lookahead = Math.max(
      1,
      parseFiniteInt(
        environment.VOICE_ALLOCATION_LOOKAHEAD_CHAPTERS,
        parseFiniteInt(environment.PRESCAN_CHAPTER_COUNT, 10),
      ) || 10,
    );
    return {
      version: ALLOCATION_POLICY_VERSION,
      lookaheadChapters: lookahead,
      coreMinChapterCount: Math.max(
        1,
        parseFiniteInt(environment.VOICE_ALLOCATION_CORE_MIN_CHAPTERS, 3) || 3,
      ),
      coreMinDialogueCount: Math.max(
        1,
        parseFiniteInt(
          environment.VOICE_ALLOCATION_CORE_MIN_DIALOGUE_COUNT,
          8,
        ) || 8,
      ),
      temporaryMaxChapterCount: Math.max(
        1,
        parseFiniteInt(
          environment.VOICE_ALLOCATION_TEMPORARY_MAX_CHAPTERS,
          1,
        ) || 1,
      ),
      temporaryMaxDialogueCount: Math.max(
        1,
        parseFiniteInt(
          environment.VOICE_ALLOCATION_TEMPORARY_MAX_DIALOGUE_COUNT,
          3,
        ) || 3,
      ),
    };
  }

  function loadProjectReaderSettings(projectName) {
    const fp = getProjectReaderSettingsPath(projectName);
    const data = readJson(fp, {});
    return {
      ...DEFAULT_READER_SETTINGS,
      ...(data && typeof data === 'object' ? data : {}),
    };
  }

  function saveProjectReaderSettings(projectName, settings) {
    const fp = getProjectReaderSettingsPath(projectName, {ensureExists: true});
    writeJson(fp, {
      ...DEFAULT_READER_SETTINGS,
      ...(settings && typeof settings === 'object' ? settings : {}),
      updatedAt: new Date().toISOString(),
    });
  }

  function normalizeAssignment(config) {
    if (!config || typeof config !== 'object') {
      return null;
    }
    if (!config.voiceActor) {
      return null;
    }
    return {
      ...config,
      voiceActor: String(config.voiceActor),
      gender: normalizeGender(config.gender),
      manualOverride: Boolean(config.manualOverride),
      allocationType: normalizeRoleClass(config.allocationType),
      lastAssignedChapter: Number.isInteger(Number(config.lastAssignedChapter))
        ? Number(config.lastAssignedChapter)
        : null,
    };
  }

  function normalizeRoleStat(stat) {
    const source = stat && typeof stat === 'object' ? stat : {};
    const {
      semanticTags: _legacySemanticTags,
      tags: _legacyTags,
      voiceTags: _legacyVoiceTags,
      ...cleanSource
    } = source;
    const chapterActivity = {};
    if (source.chapterActivity && typeof source.chapterActivity === 'object') {
      Object.entries(source.chapterActivity).forEach(([chapter, value]) => {
        const chapterIndex = Number(chapter);
        if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
          return;
        }
        const item = value && typeof value === 'object' ? value : {};
        chapterActivity[String(chapterIndex)] = {
          dialogueCount: Math.max(
            0,
            parseFiniteInt(item.dialogueCount, 0) || 0,
          ),
          mentionCount: Math.max(0, parseFiniteInt(item.mentionCount, 0) || 0),
        };
      });
    }

    if (
      !Object.keys(chapterActivity).length &&
      Array.isArray(source.chapterIndexes)
    ) {
      source.chapterIndexes.forEach(chapter => {
        const chapterIndex = Number(chapter);
        if (Number.isInteger(chapterIndex) && chapterIndex >= 0) {
          chapterActivity[String(chapterIndex)] = {
            dialogueCount: 0,
            mentionCount: 1,
          };
        }
      });
    }

    const chapterIndexes = Object.keys(chapterActivity)
      .map(Number)
      .sort((a, b) => a - b);
    const dialogueCount = chapterIndexes.reduce(
      (sum, chapter) => sum + chapterActivity[String(chapter)].dialogueCount,
      0,
    );
    const mentionCount = chapterIndexes.reduce(
      (sum, chapter) => sum + chapterActivity[String(chapter)].mentionCount,
      0,
    );

    return {
      ...cleanSource,
      firstSeenChapter: chapterIndexes.length ? chapterIndexes[0] : null,
      lastSeenChapter: chapterIndexes.length
        ? chapterIndexes[chapterIndexes.length - 1]
        : null,
      chapterIndexes,
      chapterCount: chapterIndexes.length,
      dialogueCount,
      mentionCount,
      gender: normalizeGender(source.gender),
      importance: normalizeRoleClass(source.importance),
      chapterActivity,
    };
  }

  function loadProjectCasting(projectName) {
    const fp = getProjectCastingPath(projectName);
    const data = readJson(fp, {});
    const rawAssignments =
      data.roleAssignments && typeof data.roleAssignments === 'object'
        ? data.roleAssignments
        : {};
    const rawStats =
      data.roleStats && typeof data.roleStats === 'object'
        ? data.roleStats
        : {};
    const roleAssignments = {};
    const roleStats = {};

    Object.entries(rawAssignments).forEach(([role, config]) => {
      const normalized = normalizeAssignment(config);
      if (normalized) {
        roleAssignments[role] = normalized;
      }
    });
    Object.entries(rawStats).forEach(([role, stat]) => {
      roleStats[role] = normalizeRoleStat(stat);
    });

    const observation =
      data.observation && typeof data.observation === 'object'
        ? data.observation
        : {};
    const observedChapterIndexes = Array.isArray(
      observation.observedChapterIndexes,
    )
      ? [
          ...new Set(
            observation.observedChapterIndexes
              .map(Number)
              .filter(x => Number.isInteger(x) && x >= 0),
          ),
        ].sort((a, b) => a - b)
      : [];

    return {
      version: Number(data.version) || 2,
      narratorAudioId: data.narratorAudioId || null,
      roleAssignments,
      roleStats,
      observation: {
        observedChapterIndexes,
        observedThroughChapter: Number.isInteger(
          Number(observation.observedThroughChapter),
        )
          ? Number(observation.observedThroughChapter)
          : null,
        complete: Boolean(observation.complete),
        updatedAt: observation.updatedAt || null,
      },
    };
  }

  function saveProjectCasting(projectName, casting) {
    const fp = getProjectCastingPath(projectName, {ensureExists: true});
    writeJson(fp, {
      version: CASTING_VERSION,
      policyVersion: ALLOCATION_POLICY_VERSION,
      updatedAt: new Date().toISOString(),
      narratorAudioId: casting.narratorAudioId || null,
      roleAssignments: casting.roleAssignments || {},
      roleStats: casting.roleStats || {},
      observation: casting.observation || {
        observedChapterIndexes: [],
        observedThroughChapter: null,
        complete: false,
      },
    });
  }

  function normalizeActivityItem(item) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const standardName = String(item.standardName || item.role || '').trim();
    if (!standardName || standardName === '旁白') {
      return null;
    }

    const chapterStats = [];
    if (Array.isArray(item.chapterStats)) {
      item.chapterStats.forEach(chapter => {
        const chapterIndex = Number(chapter?.chapterIndex);
        if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
          return;
        }
        chapterStats.push({
          chapterIndex,
          dialogueCount: Math.max(
            0,
            parseFiniteInt(chapter.dialogueCount, 0) || 0,
          ),
          mentionCount: Math.max(
            0,
            parseFiniteInt(chapter.mentionCount, 0) || 0,
          ),
        });
      });
    }

    if (!chapterStats.length && Array.isArray(item.chapterIndexes)) {
      item.chapterIndexes.forEach(chapter => {
        const chapterIndex = Number(chapter);
        if (Number.isInteger(chapterIndex) && chapterIndex >= 0) {
          chapterStats.push({chapterIndex, dialogueCount: 0, mentionCount: 1});
        }
      });
    }

    return {
      standardName,
      gender: normalizeGender(item.gender),
      importance: normalizeRoleClass(item.importance),
      chapterStats,
    };
  }

  function applyRoleActivityToCasting(
    casting,
    activities,
    observedChapterIndexes = [],
    {complete = false} = {},
  ) {
    if (!casting.roleStats || typeof casting.roleStats !== 'object') {
      casting.roleStats = {};
    }

    for (const rawItem of activities || []) {
      const item = normalizeActivityItem(rawItem);
      if (!item) {
        continue;
      }

      const current = normalizeRoleStat(
        casting.roleStats[item.standardName] || {},
      );
      const chapterActivity = {...current.chapterActivity};
      item.chapterStats.forEach(chapter => {
        const key = String(chapter.chapterIndex);
        const previous = chapterActivity[key] || {
          dialogueCount: 0,
          mentionCount: 0,
        };
        chapterActivity[key] = {
          dialogueCount: Math.max(
            previous.dialogueCount,
            chapter.dialogueCount,
          ),
          mentionCount: Math.max(previous.mentionCount, chapter.mentionCount),
        };
      });

      casting.roleStats[item.standardName] = normalizeRoleStat({
        ...current,
        gender: item.gender !== 'unknown' ? item.gender : current.gender,
        importance: item.importance || current.importance,
        chapterActivity,
      });
    }

    const observed = new Set(casting.observation?.observedChapterIndexes || []);
    (observedChapterIndexes || []).forEach(chapter => {
      const chapterIndex = Number(chapter);
      if (Number.isInteger(chapterIndex) && chapterIndex >= 0) {
        observed.add(chapterIndex);
      }
    });
    const sortedObserved = [...observed].sort((a, b) => a - b);
    casting.observation = {
      observedChapterIndexes: sortedObserved,
      observedThroughChapter: sortedObserved.length
        ? sortedObserved[sortedObserved.length - 1]
        : null,
      complete: Boolean(complete) || Boolean(casting.observation?.complete),
      updatedAt: new Date().toISOString(),
    };
    return casting;
  }

  function mergeProjectRoleActivity(
    projectName,
    activities,
    observedChapterIndexes = [],
    options = {},
  ) {
    const casting = loadProjectCasting(projectName);
    applyRoleActivityToCasting(
      casting,
      activities,
      observedChapterIndexes,
      options,
    );
    saveProjectCasting(projectName, casting);
    return casting;
  }

  function buildCurrentRoleActivities(cards, chapterIndex) {
    const normalizedChapterIndex = Number(chapterIndex);
    if (
      !Number.isInteger(normalizedChapterIndex) ||
      normalizedChapterIndex < 0
    ) {
      return [];
    }

    const grouped = {};
    for (const item of cards || []) {
      if (
        !item ||
        item.type !== 'dialogue' ||
        !item.role ||
        item.role === '旁白'
      ) {
        continue;
      }
      if (!grouped[item.role]) {
        grouped[item.role] = {
          standardName: item.role,
          gender: 'unknown',
          chapterStats: [
            {
              chapterIndex: normalizedChapterIndex,
              dialogueCount: 0,
              mentionCount: 0,
            },
          ],
        };
      }
      const group = grouped[item.role];
      const chapter = group.chapterStats[0];
      chapter.dialogueCount += 1;
      chapter.mentionCount += 1;
      const gender = normalizeGender(item.gender);
      if (gender !== 'unknown') {
        group.gender = gender;
      }
    }
    return Object.values(grouped);
  }

  function getPolicyRoleClass(role, casting, currentStats, assignment, policy) {
    if (assignment?.manualOverride) {
      return 'core';
    }
    const stored = casting.roleStats?.[role]
      ? normalizeRoleStat(casting.roleStats[role])
      : null;
    const stats = stored || {};
    const importance = normalizeRoleClass(stats.importance);
    if (importance === 'core') {
      return 'core';
    }
    if (importance === 'temporary') {
      return 'temporary';
    }
    if (
      (stats.chapterCount || 0) >= policy.coreMinChapterCount ||
      (stats.dialogueCount || 0) >= policy.coreMinDialogueCount
    ) {
      return 'core';
    }
    if (
      (stats.chapterCount || 0) > 0 &&
      (stats.chapterCount || 0) <= policy.temporaryMaxChapterCount &&
      (stats.dialogueCount || 0) <= policy.temporaryMaxDialogueCount
    ) {
      return 'temporary';
    }
    if (
      currentStats &&
      currentStats.dialogueCount <= policy.temporaryMaxDialogueCount &&
      !stats.chapterCount
    ) {
      return 'temporary';
    }
    return 'supporting';
  }

  function getRoleStats(casting, role) {
    return casting.roleStats?.[role]
      ? normalizeRoleStat(casting.roleStats[role])
      : null;
  }

  function roleAppearsInRange(stats, startChapter, endChapter) {
    if (!stats || !Array.isArray(stats.chapterIndexes)) {
      return false;
    }
    return stats.chapterIndexes.some(
      chapter => chapter >= startChapter && chapter <= endChapter,
    );
  }

  function hasCompleteLookahead(casting, chapterIndex, lookaheadChapters) {
    if (!Number.isInteger(Number(chapterIndex))) {
      return false;
    }
    const endChapter = Number(chapterIndex) + lookaheadChapters - 1;
    const observation = casting.observation || {};
    if (
      !observation.complete ||
      !Number.isInteger(Number(observation.observedThroughChapter))
    ) {
      return false;
    }
    return Number(observation.observedThroughChapter) >= endChapter;
  }

  function buildVoicePool(records) {
    const actorPool = {};
    const narratorCandidates = [];
    const sorted = [...(records || [])].sort(
      (a, b) => new Date(b.createTime || 0) - new Date(a.createTime || 0),
    );

    for (const rawRecord of sorted) {
      if (rawRecord.disabled) {
        continue;
      }
      const rec = {
        ...rawRecord,
        voicePool: normalizeVoicePool(rawRecord.voicePool),
      };
      const parsed = parseAudioRecordName(rec.name);
      if (!parsed) {
        continue;
      }

      if (parsed.emotion === 'narration') {
        narratorCandidates.push(rec);
        continue;
      }

      if (parsed.gender === 'unknown') {
        continue;
      }

      if (!actorPool[parsed.voiceActor]) {
        actorPool[parsed.voiceActor] = {
          gender: parsed.gender,
          voicePool: rec.voicePool,
          emotions: {},
        };
      }

      const actor = actorPool[parsed.voiceActor];
      if (actor.voicePool !== 'protected' && rec.voicePool === 'protected') {
        actor.voicePool = 'protected';
      } else if (
        actor.voicePool === 'general' &&
        rec.voicePool === 'bystander'
      ) {
        actor.voicePool = 'bystander';
      }
      if (!actor.emotions[parsed.emotion]) {
        actor.emotions[parsed.emotion] = rec.id;
      }
    }

    return {actorPool, narratorCandidates};
  }

  function selectNarratorAudioId(casting, narratorCandidates) {
    if (
      casting?.narratorAudioId &&
      narratorCandidates.some(item => item.id === casting.narratorAudioId)
    ) {
      return casting.narratorAudioId;
    }

    const candidate = (
      Array.isArray(narratorCandidates) ? narratorCandidates : []
    ).find(item => item?.id);
    return candidate?.id || null;
  }

  /** 重新验证持久化的旁白标识，已删除或重新导入的录音不继续占位。 */
  function resolveNarratorAudioId(projectName) {
    const casting = loadProjectCasting(projectName);
    const {narratorCandidates} = buildVoicePool(readJson(audioRecordsPath, []));
    casting.narratorAudioId = selectNarratorAudioId(
      casting,
      narratorCandidates,
    );
    saveProjectCasting(projectName, casting);
    return casting.narratorAudioId;
  }

  function getPoolRank(roleClass, pool) {
    if (roleClass === 'temporary') {
      return {bystander: 0, general: 1, protected: 3}[pool] ?? 4;
    }
    return {protected: 0, general: 1, bystander: 2}[pool] ?? 4;
  }

  function getEmotionCoverage(requiredEmotions, actor) {
    if (!requiredEmotions || !requiredEmotions.size) {
      return 0;
    }
    return [...requiredEmotions].filter(emotion =>
      Boolean(actor.emotions[emotion]),
    ).length;
  }

  function getUsageCount(activeUsage, actorName) {
    return activeUsage.get(actorName)?.length || 0;
  }

  function chooseActor({
    roleClass,
    roleGender,
    requiredEmotions,
    actorPool,
    activeUsage,
  }) {
    if (roleGender !== 'male' && roleGender !== 'female') {
      return null;
    }

    const allCandidates = Object.entries(actorPool)
      .filter(([, actor]) => actor.gender === roleGender)
      .map(([actorName, actor]) => ({actorName, actor}));
    if (!allCandidates.length) {
      return null;
    }

    const preferredCandidates = allCandidates.filter(({actor}) => {
      if (roleClass === 'temporary') {
        return actor.voicePool !== 'protected';
      }
      return (
        actor.voicePool !== 'bystander' ||
        !allCandidates.some(item => item.actor.voicePool !== 'bystander')
      );
    });
    const poolCandidates = preferredCandidates.length
      ? preferredCandidates
      : allCandidates;
    const idleCandidates = poolCandidates.filter(
      ({actorName}) => !activeUsage.has(actorName),
    );
    const candidates = idleCandidates.length ? idleCandidates : poolCandidates;

    candidates.sort((left, right) => {
      const poolDiff =
        getPoolRank(roleClass, left.actor.voicePool) -
        getPoolRank(roleClass, right.actor.voicePool);
      if (poolDiff !== 0) {
        return poolDiff;
      }
      const coverageDiff =
        getEmotionCoverage(requiredEmotions, right.actor) -
        getEmotionCoverage(requiredEmotions, left.actor);
      if (coverageDiff !== 0) {
        return coverageDiff;
      }
      const usageDiff =
        getUsageCount(activeUsage, left.actorName) -
        getUsageCount(activeUsage, right.actorName);
      if (usageDiff !== 0) {
        return usageDiff;
      }
      return left.actorName.localeCompare(right.actorName, 'zh-CN');
    });

    const selected = candidates[0];
    return {
      actorName: selected.actorName,
      shared: activeUsage.has(selected.actorName),
      actor: selected.actor,
    };
  }

  function addUsage(activeUsage, actorName, role) {
    if (!actorName) {
      return;
    }
    if (!activeUsage.has(actorName)) {
      activeUsage.set(actorName, []);
    }
    const roles = activeUsage.get(actorName);
    if (!roles.includes(role)) {
      roles.push(role);
    }
  }

  function removeUsage(activeUsage, actorName, role) {
    if (!actorName || !activeUsage.has(actorName)) {
      return;
    }
    const roles = activeUsage.get(actorName).filter(item => item !== role);
    if (roles.length) {
      activeUsage.set(actorName, roles);
    } else {
      activeUsage.delete(actorName);
    }
  }

  function attachAutoCastingToCards(
    cards,
    casting,
    actorPool,
    readerSettings = DEFAULT_READER_SETTINGS,
  ) {
    const output = [];

    for (const item of cards || []) {
      const card = {...item};

      if (card.type === 'narration' || card.role === '旁白') {
        if (casting.narratorAudioId) {
          card.referenceAudio = {
            id: casting.narratorAudioId,
            mode: 1,
            emoWeight: 0.65,
          };
        } else {
          delete card.referenceAudio;
        }
        output.push(card);
        continue;
      }

      const roleCasting = casting.roleAssignments[card.role];
      if (!roleCasting || !roleCasting.voiceActor) {
        delete card.referenceAudio;
        output.push(card);
        continue;
      }

      const actor = actorPool[roleCasting.voiceActor];
      if (!actor) {
        delete card.referenceAudio;
        output.push(card);
        continue;
      }

      const emo = normalizeEmotion(card.emotion);
      const allowNeutralFallback =
        readerSettings.missingEmotionPolicy === 'fallback_neutral';
      const audioId =
        actor.emotions[emo] ||
        (allowNeutralFallback ? actor.emotions.neutral || null : null);
      card.autoAssignedVoiceActor = roleCasting.voiceActor;
      card.autoEmotionAudioMap = {};
      card.manualAssigned = Boolean(roleCasting.manualOverride);
      card.voiceAllocationType = roleCasting.allocationType || 'supporting';
      card.voicePool = actor.voicePool;
      card.sharedVoice = Boolean(roleCasting.sharedVoice);
      card.missingEmotionPolicy = readerSettings.missingEmotionPolicy;
      card.referenceAudioFallback =
        !actor.emotions[emo] && Boolean(audioId) && allowNeutralFallback
          ? 'neutral'
          : null;

      Object.keys(actor.emotions).forEach(k => {
        card.autoEmotionAudioMap[k] = {
          id: actor.emotions[k],
          mode: 1,
          emoWeight: 0.65,
        };
      });

      if (audioId) {
        card.referenceAudio = {
          id: audioId,
          mode: 1,
          emoWeight: 0.65,
        };
      } else {
        delete card.referenceAudio;
      }

      output.push(card);
    }

    return output;
  }

  function autoAssignReferenceAudios({
    parsedCards,
    projectName,
    provider,
    chapterIndex = -1,
  }) {
    if (!SUPPORTED_PROVIDERS.has(provider)) {
      return {
        cards: parsedCards || [],
        autoCasting: {
          enabled: false,
          reason: `provider_not_supported:${provider}`,
        },
      };
    }

    const records = readJson(audioRecordsPath, []);
    const {actorPool, narratorCandidates} = buildVoicePool(records);
    const roleGenderStats = getRoleGenderStats(parsedCards);
    const roleGenders = decideRoleGender(roleGenderStats);
    const readerSettings = loadProjectReaderSettings(projectName);
    const policy = getAllocationPolicy();
    const casting = loadProjectCasting(projectName);
    const selectedNarratorAudioId = selectNarratorAudioId(
      casting,
      narratorCandidates,
    );
    const narratorAutoAssigned =
      !casting.narratorAudioId && Boolean(selectedNarratorAudioId);
    casting.narratorAudioId = selectedNarratorAudioId;
    const normalizedChapterIndex = Number.isInteger(Number(chapterIndex))
      ? Number(chapterIndex)
      : null;

    if (normalizedChapterIndex !== null) {
      applyRoleActivityToCasting(
        casting,
        buildCurrentRoleActivities(parsedCards, normalizedChapterIndex),
        [normalizedChapterIndex],
      );
    }

    const rolesInCards = [
      ...new Set(
        (parsedCards || [])
          .filter(
            x => x && x.type === 'dialogue' && x.role && x.role !== '旁白',
          )
          .map(x => x.role),
      ),
    ];
    const roleClassifications = {};
    rolesInCards.forEach(role => {
      roleClassifications[role] = getPolicyRoleClass(
        role,
        casting,
        roleGenderStats[role],
        casting.roleAssignments[role],
        policy,
      );
    });

    const activeRoles = new Set(rolesInCards);
    const lookaheadComplete = hasCompleteLookahead(
      casting,
      normalizedChapterIndex,
      policy.lookaheadChapters,
    );
    const lookaheadEnd =
      normalizedChapterIndex === null
        ? null
        : normalizedChapterIndex + policy.lookaheadChapters - 1;

    Object.entries(casting.roleAssignments || {}).forEach(([role, config]) => {
      const normalized = normalizeAssignment(config);
      if (!normalized) {
        return;
      }
      // 没有完整的未来章节窗口时保守处理，不回收任何历史自动分配。
      if (!lookaheadComplete || normalizedChapterIndex === null) {
        activeRoles.add(role);
        return;
      }
      const roleClass =
        roleClassifications[role] ||
        getPolicyRoleClass(role, casting, null, normalized, policy);
      if (normalized.manualOverride || roleClass === 'core') {
        activeRoles.add(role);
        return;
      }
      if (
        lookaheadComplete &&
        normalizedChapterIndex !== null &&
        roleAppearsInRange(
          getRoleStats(casting, role),
          normalizedChapterIndex,
          lookaheadEnd,
        )
      ) {
        activeRoles.add(role);
      }
    });

    const previousAssignments = {};
    Object.entries(casting.roleAssignments || {}).forEach(([role, config]) => {
      const normalized = normalizeAssignment(config);
      if (normalized) {
        previousAssignments[role] = {...normalized};
      }
    });

    const finalRoleAssignments = {};
    const activeUsage = new Map();
    Object.entries(previousAssignments).forEach(([role, config]) => {
      const actor = actorPool[config.voiceActor];
      if (!actor) {
        return;
      }
      const expectedGender =
        roleGenders[role] ||
        getRoleStats(casting, role)?.gender ||
        config.gender;
      const isActive = activeRoles.has(role);
      if (
        isActive &&
        !config.manualOverride &&
        expectedGender !== 'unknown' &&
        actor.gender !== expectedGender
      ) {
        return;
      }
      finalRoleAssignments[role] = {
        ...config,
        gender: actor.gender,
        allocationType:
          config.allocationType || (config.manualOverride ? 'core' : null),
        voicePool: actor.voicePool,
      };
      if (isActive) {
        addUsage(activeUsage, config.voiceActor, role);
      }
    });

    const orderedRoles = rolesInCards.slice().sort((left, right) => {
      const rank = {core: 0, supporting: 1, temporary: 2};
      return (
        (rank[roleClassifications[left]] ?? 1) -
          (rank[roleClassifications[right]] ?? 1) ||
        left.localeCompare(right, 'zh-CN')
      );
    });
    const sharedActors = [];
    const voiceChanges = [];

    for (const role of orderedRoles) {
      const roleClass = roleClassifications[role];
      const roleStats = getRoleStats(casting, role);
      const roleGender = roleGenders[role] || roleStats?.gender || 'unknown';
      const currentAssignment = finalRoleAssignments[role] || null;
      if (currentAssignment) {
        removeUsage(activeUsage, currentAssignment.voiceActor, role);
      }

      const existingActor = currentAssignment
        ? actorPool[currentAssignment.voiceActor]
        : null;
      const expectedGenderMatches =
        existingActor &&
        (roleGender === 'unknown' || existingActor.gender === roleGender);
      const actorAlreadyUsedByOtherRole =
        currentAssignment && activeUsage.has(currentAssignment.voiceActor);
      let selected = null;

      if (
        existingActor &&
        expectedGenderMatches &&
        (!actorAlreadyUsedByOtherRole || currentAssignment.manualOverride)
      ) {
        selected = {
          actorName: currentAssignment.voiceActor,
          actor: existingActor,
          shared: Boolean(actorAlreadyUsedByOtherRole),
        };
      } else {
        const requiredEmotions = new Set(
          Object.keys(roleGenderStats[role]?.emotions || {}),
        );
        selected = chooseActor({
          roleClass,
          roleGender,
          requiredEmotions,
          actorPool,
          activeUsage,
        });
      }

      if (!selected) {
        if (currentAssignment) {
          addUsage(activeUsage, currentAssignment.voiceActor, role);
        }
        continue;
      }

      const previousActorName = previousAssignments[role]?.voiceActor || null;
      const nextAssignment = {
        ...(currentAssignment || {}),
        voiceActor: selected.actorName,
        gender: selected.actor.gender,
        manualOverride: Boolean(currentAssignment?.manualOverride),
        allocationType: roleClass,
        voicePool: selected.actor.voicePool,
        lastAssignedChapter: normalizedChapterIndex,
        sharedVoice: Boolean(selected.shared),
      };
      finalRoleAssignments[role] = nextAssignment;
      addUsage(activeUsage, selected.actorName, role);

      if (previousActorName && previousActorName !== selected.actorName) {
        voiceChanges.push({
          role,
          from: previousActorName,
          to: selected.actorName,
        });
      }
    }

    const previousAutoActors = new Set(
      Object.entries(previousAssignments)
        .filter(
          ([role, config]) => !config.manualOverride && !activeRoles.has(role),
        )
        .map(([, config]) => config.voiceActor),
    );
    const activeActors = new Set(activeUsage.keys());
    const releasedActors = [...previousAutoActors].filter(
      actorName => !activeActors.has(actorName),
    );

    activeUsage.forEach((roles, actorName) => {
      if (roles.length > 1) {
        sharedActors.push({
          voiceActor: actorName,
          roles: [...roles],
          voicePool: actorPool[actorName]?.voicePool || 'general',
        });
        roles.forEach(role => {
          if (finalRoleAssignments[role]) {
            finalRoleAssignments[role].sharedVoice = true;
          }
        });
      }
    });

    casting.roleAssignments = finalRoleAssignments;
    saveProjectCasting(projectName, casting);

    return {
      cards: attachAutoCastingToCards(
        parsedCards,
        casting,
        actorPool,
        readerSettings,
      ),
      autoCasting: {
        enabled: true,
        policyVersion: policy.version,
        narratorAudioId: casting.narratorAudioId,
        roleAssignments: casting.roleAssignments,
        roleClassifications,
        roleGenders,
        availableVoiceActors: Object.keys(actorPool).length,
        missingEmotionPolicy: readerSettings.missingEmotionPolicy,
        releasedActors,
        sharedActors,
        voiceChanges,
        lookahead: {
          chapterIndex: normalizedChapterIndex,
          chapters: policy.lookaheadChapters,
          complete: lookaheadComplete,
          observedThroughChapter:
            casting.observation?.observedThroughChapter || null,
        },
        warnings: [
          ...(sharedActors.length
            ? ['音频池不足，部分角色共享了同一声线']
            : []),
          ...(voiceChanges.length
            ? ['部分临时角色因声线已回收而重新分配']
            : []),
          ...(!casting.narratorAudioId &&
          (parsedCards || []).some(
            card => card?.type === 'narration' || card?.role === '旁白',
          )
            ? ['缺少旁白参考音频，请录制或导入“旁白/narration”候选音频']
            : []),
        ],
        narratorAutoAssigned,
      },
    };
  }

  return {
    snapshot: () => state,
    ALLOCATION_POLICY_VERSION,
    VOICE_POOL_VALUES,
    autoAssignReferenceAudios,
    normalizeGender,
    normalizeVoicePool,
    loadProjectCasting,
    saveProjectCasting,
    mergeProjectRoleActivity,
    parseAudioRecordName,
    resolveNarratorAudioId,
    loadProjectReaderSettings,
    saveProjectReaderSettings,
    __test__: {
      buildVoicePool,
      selectNarratorAudioId,
      attachAutoCastingToCards,
    },
  };
}

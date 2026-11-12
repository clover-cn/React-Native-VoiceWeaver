export type ListenPreparationStage =
  | 'read'
  | 'analyze'
  | 'assign'
  | 'generate'
  | 'play';

export const PREPARATION_STEPS: {key: ListenPreparationStage; title: string}[] =
  [
    {key: 'read', title: '读取章节'},
    {key: 'analyze', title: '分析剧情'},
    {key: 'assign', title: '分配音色'},
    {key: 'generate', title: '生成语音'},
    {key: 'play', title: '准备播放'},
  ];

export const stageFromTask = (phase: string): ListenPreparationStage | null => {
  switch (phase) {
    case 'prescan':
    case 'parsing':
      return 'analyze';
    case 'assigning':
      return 'assign';
    case 'generating':
      return 'generate';
    case 'done':
      return 'play';
    default:
      return null;
  }
};

export interface ListenPreparation {
  plain?: boolean;
  id: number;
  assetId: string;
  startedAt: number;
  expanded: boolean;
  autoPlay: boolean;
  stage: ListenPreparationStage;
  visited: ListenPreparationStage[];
  error: string;
}

/** 收起后的播放意图只允许由用户主动播放恢复。 */
export const collapsePreparation = (
  state: ListenPreparation,
): ListenPreparation => ({
  ...state,
  expanded: false,
  autoPlay: false,
});

export const advancePreparation = (
  state: ListenPreparation,
  stage: ListenPreparationStage,
): ListenPreparation => ({
  ...state,
  stage,
  visited: state.visited.includes(stage)
    ? state.visited
    : [...state.visited, stage],
});

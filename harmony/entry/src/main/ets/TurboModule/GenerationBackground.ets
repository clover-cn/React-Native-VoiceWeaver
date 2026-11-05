import { common, wantAgent } from '@kit.AbilityKit';
import { backgroundTaskManager } from '@kit.BackgroundTasksKit';

/** 统一协调播放与生成的后台类型，防止停止生成时取消播放后台任务。 */
export class GenerationBackground {
  private static audio: boolean = false;
  private static generation: boolean = false;
  private static running: boolean = false;
  private static queue: Promise<void> = Promise.resolve();
  static update(context: common.UIAbilityContext, kind: string, enabled: boolean): Promise<void> {
    if (kind === 'audio') { GenerationBackground.audio = enabled; } else { GenerationBackground.generation = enabled; }
    const work = async (): Promise<void> => {
      const modes: string[] = [];
      if (GenerationBackground.audio) { modes.push('audioPlayback'); }
      if (GenerationBackground.generation) { modes.push('dataTransfer'); }
      if (GenerationBackground.running) { await backgroundTaskManager.stopBackgroundRunning(context); GenerationBackground.running = false; }
      if (modes.length === 0) { return; }
      const agent = await wantAgent.getWantAgent({wants: [{bundleName: context.applicationInfo.name, abilityName: 'EntryAbility'}], operationType: wantAgent.OperationType.START_ABILITY, requestCode: 8, wantAgentFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]});
      await backgroundTaskManager.startBackgroundRunning(context, modes, agent);
      GenerationBackground.running = true;
    };
    const result = GenerationBackground.queue.then(work, work); GenerationBackground.queue = result.catch(() => {}); return result;
  }
}

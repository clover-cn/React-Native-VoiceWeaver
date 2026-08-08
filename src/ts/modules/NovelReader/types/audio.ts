export type VoicePool = 'general' | 'bystander' | 'protected';

export interface AudioOption {
  id: string;
  name: string;
  url?: string;
  sampleText?: string;
  remark?: string;
  createTime?: string;
  voicePool?: VoicePool;
}

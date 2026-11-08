export type VoicePool = 'general' | 'bystander' | 'protected';

export interface AudioOption {
  disabled?: boolean;
  id: string;
  name: string;
  url?: string;
  sampleText?: string;
  remark?: string;
  createTime?: string;
  voicePool?: VoicePool;
}

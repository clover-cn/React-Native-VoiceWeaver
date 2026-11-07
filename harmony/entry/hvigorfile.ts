import { hapTasks } from '@ohos/hvigor-ohos-plugin';

// DevEco/Hvigor 直接构建同样同步提示音，不依赖先运行 Metro 打包。
const syncHarmonyAudio = require('../../scripts/sync-harmony-audio.cjs');
syncHarmonyAudio();

export default {
  system: hapTasks, /* Built-in plugin of Hvigor. It cannot be modified. */
  plugins: []         /* Custom plugin to extend the functionality of Hvigor. */
}

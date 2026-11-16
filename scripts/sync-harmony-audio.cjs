const fs = require('fs');
const path = require('path');

/** 将随应用发布的提示音同步到鸿蒙资源目录，清理构建产物后也可恢复。 */
function syncHarmonyAudio() {
  const root = path.resolve(__dirname, '..');
  const name = 'segment_generation_failed.wav';
  const source = path.join(root, 'src/assets/audio', name);
  const resourceDir = 'harmony/entry/src/main/resources/rawfile';
  const target = path.join(root, resourceDir, name);
  const content = fs.readFileSync(source);
  if (!fs.existsSync(target) || !fs.readFileSync(target).equals(content)) {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content);
    console.log('[提示音资源] 已同步 segment_generation_failed.wav');
  }
  // 原生媒体卡片不能依赖 Metro，默认封面随两端安装包发布。
  const cover = fs.readFileSync(path.join(root, 'src/assets/icons/defCvrImg.png'));
  for (const destination of [
    'harmony/entry/src/main/resources/base/media/default_cover.png',
    'android/app/src/main/res/drawable-nodpi/default_cover.png',
  ]) {
    const output = path.join(root, destination);
    if (!fs.existsSync(output) || !fs.readFileSync(output).equals(cover)) {
      fs.mkdirSync(path.dirname(output), {recursive: true});
      fs.writeFileSync(output, cover);
      console.log('[封面资源] 已同步 ' + destination);
    }
  }
}

module.exports = syncHarmonyAudio;
if (require.main === module) {
  syncHarmonyAudio();
}

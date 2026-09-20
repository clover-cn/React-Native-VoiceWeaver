const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

// Android 使用标准单包解析，鸿蒙继续使用现有分包与别名配置。
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  maxWorkers: 2,
  resolver: {
    platforms: ['android', 'native'],
    blockList: exclusionList([/[/\\]\.cache[/\\].*/]),
  },
});

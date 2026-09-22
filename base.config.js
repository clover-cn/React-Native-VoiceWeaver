const {mergeConfig, getDefaultConfig} = require('@react-native/metro-config');
const {
  createHarmonyMetroConfig,
} = require('@react-native-oh/react-native-harmony/metro.config');
const path = require('path');
const projectRootPath = path.join(__dirname);
const moduleId = require('./build/multibundle/moduleId');
const harmonyConfig = createHarmonyMetroConfig({
  reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
});

const config = {
  resolver: {
    // 保留鸿蒙默认排除规则，避免缓存中的项目副本参与模块扫描。
    blockList: new RegExp(
      [...harmonyConfig.resolver.blockList, /[/\\]\.cache[/\\].*/]
        .map(pattern => `(${pattern.source})`)
        .join('|'),
    ),
  },
  serializer: {
    createModuleIdFactory: moduleId.createModuleIdFactoryWrap(
      projectRootPath,
      'base',
    ),
    processModuleFilter: moduleId.postProcessModulesFilterWrap(projectRootPath),
  },
};

module.exports = mergeConfig(
  getDefaultConfig(__dirname),
  harmonyConfig,
  config,
);

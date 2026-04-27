const {mergeConfig, getDefaultConfig} = require('@react-native/metro-config');
const {createHarmonyMetroConfig} = require('@react-native-oh/react-native-harmony/metro.config');
const path = require('path');
const projectRootPath = path.join(__dirname);
const moduleId = require('./build/multibundle/moduleId');

const config = {
    serializer: {
        createModuleIdFactory: moduleId.createModuleIdFactoryWrap(
            projectRootPath,
            'base',
        ),
        processModuleFilter: moduleId.postProcessModulesFilterWrap(
          projectRootPath,
        ),
    },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), createHarmonyMetroConfig({
    reactNativeHarmonyPackageName: '@react-native-oh/react-native-harmony',
}), config);
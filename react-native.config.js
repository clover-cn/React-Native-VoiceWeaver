// 鸿蒙插件保留在依赖中，但不参加 Android 原生模块自动链接。
const harmonyPackages = [
  '@react-native-oh/react-native-harmony',
  '@react-native-oh-tpl/react-native-view-shot',
  '@react-native-oh-tpl/react-native-webview',
  '@react-native-ohos/checkbox',
  '@react-native-ohos/react-native-linear-gradient',
  '@react-native-ohos/react-native-video',
  'turboModules',
];
module.exports = {
  dependencies: Object.fromEntries(
    harmonyPackages.map(name => [
      name,
      {platforms: {android: null, ios: null}},
    ]),
  ),
};

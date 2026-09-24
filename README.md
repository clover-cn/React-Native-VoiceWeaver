# React Native VoiceWeaver

## Android

已新增 Android 原生工程，共享现有阅读与听书界面。构建与验证状态见 [Android 实施记录](docs/Android实施记录.md)，设计依据见 [适配方案](docs/Android适配方案.md)。

Windows 本机准备 JDK 17、Android SDK 34、Build Tools 34.0.0、NDK 26.3.11579264，配置 `ANDROID_HOME`，并将 JDK 17 的 `java` 加入 PATH。安装依赖后，通常只需运行一条构建命令：

```powershell
npm ci
npm run android:preview
```

Preview 使用测试签名并内置 JS bundle，输出 `android/app/build/outputs/apk/preview/app-preview.apk`，可脱离 Metro 安装测试。应用 ID 为 `webpv.voice.weaver.preview`。正式发布使用 `npm run android:release`，通过 `VOICEWEAVER_KEYSTORE`、`VOICEWEAVER_STORE_PASSWORD`、`VOICEWEAVER_KEY_ALIAS`、`VOICEWEAVER_KEY_PASSWORD` 环境变量提供自己的签名；未配置时只生成未签名 APK。

正式签名配置保存在 `android/signing.properties`，使用上述四个环境变量名作为属性名；环境变量优先。`VOICEWEAVER_KEYSTORE` 的相对路径以 `android` 目录为基准。直接运行 `npm run android:release` 即可。按项目所有者的决定，`android/voiceweaver-release.keystore` 与密码配置一起纳入 Git，拥有仓库读取权限的人可取得签名私钥和密码；后续更新必须使用同一签名。此变更无需迁移现有使用绝对路径的环境变量配置。

### Android 真机调试

连接 Android 手机，开启 USB 调试，并在手机上允许电脑调试。在项目根目录运行：

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
npm run start:android
```

确认 `adb devices` 中设备状态为 `device`。保持 Metro 终端运行，另开一个终端，在项目根目录执行：

```powershell
npm run android -- --no-packager
```

该命令会构建、安装并启动 Android 调试版，支持 Metro 热更新。Android 不需要运行鸿蒙的 `codegen`、`dev:all` 或 `hdc` 命令；Preview APK 用于独立安装测试，热更新调试请使用上述调试版。

官方 Maven 仓库访问受限时，可使用 `npm run android:preview -- -UseMirror`；该选项切换 Maven 镜像，不会替换 Gradle Wrapper 的官方下载地址与 SHA-256 校验。

## 鸿蒙

以下为原有鸿蒙环境与运行说明。鸿蒙视频 HAR 路径已跟随平台依赖拆分更新，安装 npm 依赖后需要重新同步 ohpm 依赖。


### 环境

- DevEco Studio版本：DevEco Studio 5.0.5 Release
- HarmonyOS SDK版本：HarmonyOS  5.0.5 Release SDK
- 设备类型：华为手机（包括双折叠和阔折叠）
- 系统版本：HarmonyOS 5.0.5(17)
- npm版本：18.14.1

### 权限

- 网络权限: ohos.permission.INTERNET,
- 持久化访问文件Uri权限：ohos.permission.FILE_ACCESS_PERSIST
- 分布式数据同步权限：ohos.permission.DISTRIBUTED_DATASYNC

### 调试

- 本项目不支持使用模拟器调试，请使用真机进行调试。

## 快速入门

### 检查环境
- 执行node -v，输出npm版本号'v18.14.1'则已正确配置npm环境。
- 检查环境变量，需在系统环境变量中添加key为RNOH_C_API_ARCH，值为1的环境变量（Windows）。

### 配置工程
在运行此模板前，需要完成以下配置：

1. 在AppGallery Connect创建应用，将包名配置到模板中。

   a. 参考[创建HarmonyOS应用](https://developer.huawei.com/consumer/cn/doc/app/agc-help-create-app-0000002247955506) ，为应用创建APP ID，并将APP ID与应用进行关联。

   b. 返回应用列表页面，查看应用的包名。

   c. 将模板工程根目录下harmony/AppScope/app.json5文件中的bundleName替换为创建应用的包名。

2. 配置华为账号服务（跨端需做插件配置）。

   a. 将应用的Client ID配置到harmony/entry/src/main路径下的module.json5文件中，详细参考：[配置Client ID](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/account-client-id)。

   b. 申请华为账号一键登录所需的权限，详细参考：[申请账号权限](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/account-config-permissions)。

### 鸿蒙真机调试

1. 使用终端打开并进入RN工程
2. 执行命令: npm i，安装RN依赖三方库
3. 执行命令：cd harmony，进入鸿蒙目录
4. 执行命令：ohpm install，安装鸿蒙依赖三方库
5. 执行命令：cd ..，返回RN项目目录
6. 执行命令：npm run codegen，生成胶水代码，主要是RnBridge相关接口
7. 执行命令：npm run dev:all，生成RN代码bundle包（若未修改RN代码可不用重复生成bundle包）
8. 连接鸿蒙真机，执行命令：`hdc rport tcp:8081 tcp:8081`，设置端口转发
9. 执行命令：`npm start`，启动 Metro 服务并保持终端运行
10. （首次安装运行App）使用DevEco Studio打开根目录下的harmony项目，运行安装并启动APP。安装完成，在浏览器打开http://localhost:8081/index.bundle?platform=harmony 即可。后续如果没有修改鸿蒙端侧代码，则不需要重新运行安装App。

**【说明】**
1. windows环境下，使用ohpm install或者在DevEco Studio同步代码或安装依赖时，一定要关掉npm start启动的npm服务（Ctrl+C），否则可能导致依赖安装失败。
2. 运行harmony app时，若未在终端启动npm服务或未连接设备，RN框架会加载本地通过命令npm run dev:all打好的bundle包来运行，若启动了npm服务以及连接了设备，则直接加载运行项目中的RN代码。

## 开源许可协议

该代码经过[Apache 2.0 授权许可](http://www.apache.org/licenses/LICENSE-2.0)。







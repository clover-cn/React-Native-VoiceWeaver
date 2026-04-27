# React Native VoiceWeaver


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

### 运行调试工程

1. 使用终端打开并进入RN工程
2. 执行命令: npm i，安装RN依赖三方库
3. 执行命令：cd harmony，进入鸿蒙目录
4. 执行命令：ohpm install，安装鸿蒙依赖三方库
5. 执行命令：cd ..，返回RN项目目录
6. 执行命令：npm run codegen，生成胶水代码，主要是RnBridge相关接口
7. 执行命令：npm run dev:all，生成RN代码bundle包（若未修改RN代码可不用重复生成bundle包）
8. 执行命令：npm start打开npm服务
9. 连接设备: hdc rporthdc rport tcp:8081 tcp:8081
10. （首次安装运行App）使用DevEco Studio打开根目录下的harmony项目，运行安装并启动APP。安装完成，在浏览器打开http://localhost:8081/index.bundle?platform=harmony 即可。后续如果没有修改鸿蒙端侧代码，则不需要重新运行安装App。

**【说明】**
1. windows环境下，使用ohpm install或者在DevEco Studio同步代码或安装依赖时，一定要关掉npm start启动的npm服务（Ctrl+C），否则可能导致依赖安装失败。
2. 运行harmony app时，若未在终端启动npm服务或未连接设备，RN框架会加载本地通过命令npm run dev:all打好的bundle包来运行，若启动了npm服务以及连接了设备，则直接加载运行项目中的RN代码。

## 开源许可协议

该代码经过[Apache 2.0 授权许可](http://www.apache.org/licenses/LICENSE-2.0)。







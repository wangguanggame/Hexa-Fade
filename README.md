# Hexa Fade

基于 Cocos Creator 3.8.7 的 Facebook Instant Games 游戏工程。

## 开发与构建

1. 克隆仓库，用 Cocos Creator 3.8.7 打开工程根目录。
2. 在构建发布面板选择 `web-mobile`，使用 `build-templates/buildConfig_web-mobile.json` 中的配置。
3. 启动场景必须为 `assets/Scene/HomeScene.scene`。它负责初始化 Facebook SDK、读取存档及预加载资源，完成后进入 `GameScene`。
4. 构建输出位于 `build/web-mobile`。发布 ZIP 的根目录应直接包含 `index.html`。

不要直接以 `GameScene` 作为正式包入口，否则会跳过 SDK 初始化。平台布局查询已经提供初始化前的兜底，但广告、存档、内购仍依赖完整初始化流程。

## SDK 与发布文件

- `assets/sdk/index.global.js` 为已混淆的 SDK，`index.d.ts` 提供接口类型。
- `assets/sdk/GameSDK.ts` 封装游戏侧调用。
- `build-templates/web-mobile/index.html` 加载 Facebook 平台脚本并设置初始化状态。
- SDK 的完整构建源码由独立 SDK 工程维护，本仓库保存游戏接入所需的产物。

`library`、`temp`、`build`、本地上传凭证及 `game.zip` 不提交到 Git。上传令牌通过终端隐藏输入或 `FB_UPLOAD_TOKEN` 环境变量提供，勿写入源码。

具体命令见 `FB发布说明.md`。发布前应在 Facebook 测试环境验证启动、存档、广告和内购。

# Hexa Fade 构建与发布

工程使用 Cocos Creator 3.8.7，Facebook App ID 为 `27708600165480897`。

## 构建入口

使用 `build-templates/buildConfig_web-mobile.json`，平台为 `web-mobile`，启动场景为 `HomeScene`。`HomeScene` 完成 SDK 初始化后再进入 `GameScene`。

Mac 可在工程根目录执行以下命令，或者通过 Creator 的构建发布面板构建：

```bash
"/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/MacOS/CocosCreator" \
  --project "$PWD" \
  --build "configPath=$PWD/build-templates/buildConfig_web-mobile.json;platform=web-mobile;debug=false;mainBundleCompressionType=merge_all_json;"
```

Creator 3.8.7 命令行构建成功的退出码为 `36`。输出位于 `build/web-mobile`，请检查 `src/settings.json` 的 `launch.launchScene` 为 `db://assets/Scene/HomeScene.scene`。

Windows 可使用 `run.bat` 或 `run.ps1`，并通过 `-CreatorPath` 指定本机引擎位置。`run.ps1` 支持 `-DryRun`、`-Upload` 和 `-UploadOnly`；这些是 PowerShell 参数。

## 压缩包与测试

将 `build/web-mobile` 内部文件打包，ZIP 根目录必须直接包含 `index.html`，不要额外嵌套 `web-mobile` 目录。排除 `.DS_Store` 和 `__MACOSX`，将包保存为工程根目录的 `game.zip`。

每次修改源码后都应重新构建并重新打包。上传前检查启动场景，并在 Facebook 测试环境验证启动、存档、广告和内购。

## 上传凭证

Mac 的上传函数接受 `FB_UPLOAD_TOKEN`，未提供时在终端隐藏输入，不将令牌保存在源码中。已有验证完成的 `game.zip` 时可执行：

```bash
bash "./run.sh" uploadfb --version 1.0.0
```

上传命令只应在确认包内容后主动执行。`run.sh` 中的 `fbgame` 为旧版构建辅助流程，包含开发机相关的音频压缩、二次混淆工具调用；本仓库不附带这些外部工具，通用构建采用上面的 Creator 命令。

Windows 的 `upload-token.local.txt` 使用本机加密保存令牌，已经加入忽略规则，不能跨系统复用，也不要提交到仓库。

上传后进入 [Facebook 应用托管后台](https://developers.facebook.com/apps/27708600165480897/instant-games/hosting/)，等待处理完成并测试。上传和正式发布为不同操作，仓库提交不执行上传或发布。

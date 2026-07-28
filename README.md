<p align="center">
  <img src="apps/desktop/build/icon-source.png" alt="POIO" width="112">
</p>

<h1 align="center">POIO</h1>

<p align="center">面向朋友与小型社区的 Windows / Android 语音、聊天和低延迟屏幕共享客户端。</p>

<p align="center">
  <a href="https://115.159.222.29/poio/download/">下载最新版</a> ·
  <a href="https://115.159.222.29/poio/download/">POIO 官网</a> ·
  <a href="https://www.modelscope.cn/models/sjw712/POIO/files">ModelScope 镜像</a>
</p>

> 当前版本：Windows **0.6.2 Preview**、Android **0.1.0-p23**。Windows 安装包尚未进行代码签名，首次运行时可能显示 SmartScreen 提示；Android 当前提供 arm64 APK。

## 已实现功能

- 原生 Mumble + Opus 语音链路，支持输入/输出设备切换、麦克风测试、实时音量反馈、静音、关闭声音、挂断与自动重连。
- Windows 原生全局静音快捷键与按住说话，支持键盘组合键和鼠标侧键，POIO 在托盘后台时仍然生效。
- Windows 的成员说话动画、麦克风状态和托盘提示直接读取 Mumble 原生发送状态，按键说话模式下不会把未发送的环境音误判为正在说话。
- 语音频道支持加入提示音：只由频道内其他成员听到，支持账号级自定义音效、试听、恢复默认和本地关闭；多开与短暂断线重连不会重复播放。
- 语音频道成员列表、说话状态提示，以及本地独立调节其他用户音量（0%–200%）。
- 社区创建、邀请码加入、已加入社区记忆，以及文字/语音频道管理。
- 社区支持分享 HTTPS 邀请链接；已安装 Windows 客户端时通过 `poio://` 直接唤起，未安装时显示 POIO 下载页，登录后会继续处理待加入邀请。
- 频道聊天支持图片、文件、中文文件名、拖放/粘贴附件、区域截图、Markdown、GFM 和代码块。
- 支持 PNG、JPG、WebP、GIF 自定义头像，GIF 可作为动态头像显示。
- 混合 WebRTC 屏幕共享：Windows 观看者优先 P2P 直连，失败时自动使用 mediasoup SFU；Android 与旧版客户端继续兼容服务器转发。提供 720p30、1080p30、1080p60 和原画档位，支持系统音频、观看全屏与共享结束清理。
- 客户端内检查更新、后台下载和重启安装。
- Android 版支持登录状态恢复、原生 Mumble 语音、语音房间内独立聊天入口、附件、动态头像、观看桌面共享（可独立控制共享声音）、断线状态卡、应用内下载进度与安装更新。

## 架构

| 模块 | 实现 |
| --- | --- |
| Windows 客户端 | Electron、React、TypeScript、隔离的 preload IPC |
| Android 客户端 | Kotlin、Jetpack Compose、NDK/JNI、AAudio、libmediasoupclient |
| 语音 | 修改后的原生 Mumble 客户端、Mumble Server、Opus |
| 业务与实时状态 | Node.js、Express、Socket.IO |
| 屏幕共享 | WebRTC P2P 优先、mediasoup SFU 兜底、VP8/H.264（取决于系统能力） |
| 数据 | SQLite、Argon2id 密码哈希、随机会话令牌的 SHA-256 摘要 |
| 部署 | Docker Compose，反向代理负责 HTTPS/WSS |

语音不是在 Electron 中重新实现的：安装包内包含 POIO 修改并编译的 Mumble 原生运行时，Electron 通过本地命名管道控制连接、设备、音量与状态。屏幕视频走独立的 WebRTC 链路：一至两名新版 Windows 观看者优先与分享者直连，直连失败、观看人数超过限制或使用 Android 时自动保留 mediasoup SFU 转发。界面会显示当前是 P2P、TURN 还是服务器转发。

## Mumble 原生来源

本项目的原生语音改动基于 [mumble-voip/mumble](https://github.com/mumble-voip/mumble) 提交 `a4c981af`。完整改动保存在 [`native/mumble/poio-mumble.patch`](native/mumble/poio-mumble.patch)，重建说明见 [`native/mumble/README.md`](native/mumble/README.md)。安装包内的 Mumble 许可文本保存在 [`apps/desktop/resources/mumble/MUMBLE-LICENSE.txt`](apps/desktop/resources/mumble/MUMBLE-LICENSE.txt)。

## 使用发行版

1. 从 [POIO 下载页](https://115.159.222.29/poio/download/) 下载 Windows 安装包或 Android arm64 APK。
2. 安装并注册/登录账号。
3. 创建社区后复制邀请码给朋友；朋友首次加入后，社区会保留在左侧列表，不必每次重新输入。
4. 进入语音频道即可连接 Mumble 原生语音；“共享屏幕”可选择来源和清晰度。

## 本地开发

要求：Windows 10/11 x64、Node.js 22 或更高版本、npm。服务端容器部署还需要 Docker Compose。

```powershell
git clone https://github.com/shi0712/POIO.git
Set-Location POIO
npm install
Copy-Item apps/server/.env.example apps/server/.env
npm run dev
```

桌面端默认连接 POIO 公网服务。开发自建服务时设置 `VITE_SERVER_URL`，例如：

```powershell
$env:VITE_SERVER_URL = 'https://voice.example.com'
npm run dev
```

常用命令：

```powershell
npm test          # TypeScript 与服务端测试
npm run build     # 构建服务端和桌面端
npm run dist:win  # 生成 Windows NSIS 安装包
```

`npm run dist:win` 会把 `apps/desktop/resources/mumble/` 中的原生 Mumble 运行时一同打包。当前仓库保留这组已验证的 Windows x64 二进制，方便复现发行包。

### Android

Android 工程位于 `apps/android/`，要求 JDK 17、Android SDK 36、NDK `28.2.13676358` 和 CMake 3.22.1。仓库包含 arm64 版原生 libmumble 运行库，不包含本地 SDK、Gradle 缓存或 APK 构建产物。

在 `apps/android/local.properties` 中配置 `sdk.dir` 后运行：

```powershell
Set-Location apps/android
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

调试 APK 输出到 `apps/android/app/build/outputs/apk/debug/app-debug.apk`。当前只支持 `arm64-v8a`；升级安装必须继续使用同一 Android 签名密钥。

## 服务端部署

复制根目录配置样例并修改公网地址与所有密码：

```bash
cp .env.example .env
docker compose up -d --build
```

反向代理应把 HTTPS/WSS 请求转发到本机 `127.0.0.1:17920`。生产防火墙至少放通：

| 端口 | 协议 | 用途 |
| --- | --- | --- |
| 443 | TCP | 官网、API、Socket.IO、更新与上传下载 |
| 64738 | TCP + UDP | Mumble 语音连接 |
| 3478 | UDP | P2P 的 STUN 地址发现（部署本机 STUN/TURN 时） |
| 42000–42100 | UDP | mediasoup/WebRTC 屏幕共享媒体 |

`17920/TCP`（应用服务）与 `6502/TCP`（Mumble Ice）只供服务器本机使用，不应直接暴露到公网。`P2P_STUN_URLS` 可配置多个逗号分隔的 STUN 地址；TURN 是可选项，因为直连失败时 POIO 会自动保留 SFU 画面。若配置 `P2P_TURN_URLS`，还需配置用户名和密码并限制中继端口范围。P2P 会让连接双方能够获知彼此的公网地址，媒体内容仍由 WebRTC 加密。

## 安全与许可

不要提交 `.env`、证书、数据库、上传内容或真实密码；这些路径已加入 `.gitignore`。POIO 自有代码目前未声明开源许可证；仓库公开不等同于授权复制或再发行。Mumble 与 npm 依赖分别遵循其自身许可证，详情见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

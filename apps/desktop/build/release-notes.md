POIO 0.8.4 完善未签名 macOS 客户端的在线更新流程。

- 软件内继续从 ModelScope 检查新版本并显示下载进度。
- macOS 下载 DMG 后会校验 SHA-512，再通过“打开 DMG”引导覆盖安装。
- 不再调用未签名应用无法使用的 Squirrel.Mac 静默安装流程。
- 包含 0.8.3 的启动动画关闭和 Mumble 原生语音连接修复。

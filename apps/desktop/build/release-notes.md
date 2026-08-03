POIO 0.8.5 修复 macOS 在线更新连接被关闭的问题。

- macOS 更新检查改用独立 HTTPS 通道，不再经过会触发 net::ERR_CONNECTION_CLOSED 的 Electron 网络层。
- 更新元数据和 DMG 下载支持 ModelScope 与 GitHub 双源自动回退。
- DMG 仍优先从 ModelScope 下载，并继续执行文件大小与 SHA-512 完整性校验。
- 保留 0.8.4 的启动动画、Mumble 原生语音、Mac 窗口按钮布局修复。

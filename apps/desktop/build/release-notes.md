版本：POIO 0.8.8
平台：macOS Apple Silicon
安装包：DMG / ZIP（未签名）

POIO 0.8.8 完善未签名 macOS 客户端的在线更新体验。

- 只对已完成大小与 SHA-512 校验的 POIO 更新 DMG 自动移除 quarantine 属性。
- 不使用管理员权限，不关闭 Gatekeeper，也不修改系统或其他应用的安全属性。
- DMG 打开后自动退出 POIO，方便覆盖“应用程序”中的旧版本。
- 首次从浏览器下载安装仍遵循 macOS 的安全确认流程。

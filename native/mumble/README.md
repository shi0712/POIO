# POIO 的 Mumble 原生集成

POIO 的 Windows 语音核心基于 `mumble-voip/mumble` 提交 `a4c981af`，并通过本地命名管道 `\\.\pipe\EchoDeckMumble` 与 Electron 主进程通信。

## 应用补丁

```powershell
git clone https://github.com/mumble-voip/mumble.git
Set-Location mumble
git checkout a4c981af
git apply ..\POIO\native\mumble\poio-mumble.patch
git apply ..\POIO\native\mumble\poio-global-hotkeys.patch
```

补丁包括：

- Mumble 主进程的 POIO 控制模式和命名管道命令。
- 连接、静音/关闭声音、输入输出设备、全局音量与单用户音量控制。
- 麦克风电平、频道成员、说话状态等事件上报。
- `echodeckBridge` 原生插件及插件加载调整。
- Mumble 原生全局静音快捷键和真正的按住说话（按下发送、松开停止）。
- 禁用原生 Mumble 界面中会打断 POIO 体验的静音提示弹窗。

## 构建与打包

按照 Mumble 上游文档为 Windows x64 构建客户端。将生成的 `mumble.exe`、运行库 DLL、`rnnoise.dll`、`speexdsp.dll` 和 `plugins/echodeckBridge.dll` 放入 `apps/desktop/resources/mumble/`，再从 POIO 根目录运行：

```powershell
npm run dist:win
```

仓库中的原生二进制与 `MUMBLE-LICENSE.txt` 是当前 `0.3.8` 安装包使用并通过测试的版本。

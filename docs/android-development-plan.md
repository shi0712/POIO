# POIO Android 客户端开发计划

更新日期：2026-07-23
状态：P0 真机验收中；完整 arm64 libmumble、TLS 登录、频道移动、UDP/OCB2、TLS 回退、Opus/AAudio、前台服务、音频路由、单用户音量、Mumble 自动重连和 Socket 媒体会话恢复已接入并通过构建；P1 已修复客户端部分 `UserState` 被错误序列化导致的频道进入超时；P2 已接入 Android 文件/图片上传、附件卡片及静态/GIF 头像显示和更新；P3 已实现 Markdown 块、代码块、行内样式与安全链接渲染；P4 已增加聊天尾部自动跟随、返回最新消息以及可见的语音错误/重试/取消状态；P5 已增加共享画面的适配/填满、双指缩放、受限拖动、全屏画质切换以及可滚动语音房间；P6 已实现音频焦点丢失时临时静音/关闭声音，并在焦点恢复后还原用户设置；P7 已增加麦克风测试、输入设备选择、原生 AAudio 指定输入设备以及 `/poio` 公共接口与下载入口；P8 已修复冷启动会话恢复顺序、token 同步落盘和瞬时网络失败误清登录；P9 已参考移动端语音社区交互重做社区双栏、语音加入确认卡、独立语音房间与底部固定语音控制区；P10 已增加真实远端说话状态、成员卡片高亮、输入端口去重和虚拟通话端口过滤；P11 已完成更新下载进度、进程恢复、SHA-256/包名/版本校验和系统安装引导；P12 已修复挂断先等待服务器请求导致 Mumble 音频仍连接的问题，改为本地状态与原生语音立即断开、远端状态和屏幕会话并行清理；P13 已将屏幕共享卡置顶、共享出现自动展开、显示真实共享者并补充消费失败后的可见重载入口，全部仍待新包真机验收

## 1. 产品目标

开发一套原生 Android 版 POIO，连接现有账号、社区、频道、聊天、Mumble 语音和 mediasoup 屏幕共享服务。

首个可发布版本必须支持：

- 注册、登录、自动恢复会话和退出登录。
- 创建/加入社区、查看成员、创建文字频道和语音频道。
- 实时聊天、历史消息、Markdown/代码块、图片和文件收发、自定义静态或 GIF 动态头像。
- 加入 Mumble 语音频道、说话/收听、成员与说话状态、静音、关闭声音、挂断、麦克风电平、扬声器/听筒/蓝牙切换、单用户音量。
- 发现并观看同一语音频道内的桌面端屏幕共享，支持共享音频、横屏、全屏、缩放和画质选择。
- 断网重连、Wi-Fi/蜂窝网络切换和后台语音前台服务。

首版明确不做：

- 不从手机发布屏幕，因此不申请 `MediaProjection` 权限，也不实现手机屏幕采集。
- 不做摄像头视频、私聊、推送通知、直播回放或复杂社区权限管理。
- 不照搬桌面三栏布局；视觉保持 POIO 风格，但交互按手机和触控重新设计。

## 2. 对现有系统的复用判断

| 能力 | 当前实现 | Android 处理 |
| --- | --- | --- |
| 认证与会话 | Socket.IO `auth:*`，随机会话令牌 | 直接复用；令牌由 Android Keystore 保护 |
| 社区/频道/成员 | Socket.IO `space:*`、`channel:*` | 直接复用 |
| 聊天与附件 | Socket.IO + `/api/uploads` | 直接复用；Android 使用系统文件选择器 |
| 语音凭据/在线状态 | `voice:credentials`、`voice:join/leave/presence` | 信令复用；音频必须实现 Android 原生 Mumble 客户端 |
| 屏幕共享 | mediasoup H.264 Baseline/VP8、Opus、Simulcast | 只创建接收 Transport/Consumer，不创建 Producer |
| 共享结束 | `media:producerClosed` | 收到后立即释放 Consumer、轨道和全屏界面 |

当前桌面端屏幕共享已经发送三层 Simulcast，但服务端还没有暴露移动端画质切层接口。Android 开发前需要增加 `media:setPreferredLayers`，才能真正实现“自动/流畅/高清/原画”，而不是始终被动接收最高层。

## 3. 推荐技术路线

### 3.1 客户端主体

- Kotlin + Jetpack Compose：适合生命周期、前台语音服务、权限、蓝牙路由和自适应手机/平板界面。
- 单 Activity + Navigation Compose。
- Coroutines/Flow 管理连接、会话和 UI 状态。
- OkHttp 负责上传下载；官方 Socket.IO Java 客户端负责实时信令。
- Coil 或等价图片管线显示 PNG/JPEG/WebP/GIF 动态头像和聊天图片。
- Room 只缓存最近频道、草稿和消息；服务器数据库仍是权威数据源。
- 令牌不写明文配置，使用 Android Keystore 封装的本地密钥加密保存。

不推荐用 WebView 包装现有 Electron 页面，也不推荐把 React Native 作为默认路线。React Native 能复用部分 TypeScript 和官方 mediasoup React Native 适配，但 Mumble、音频路由、蓝牙、后台服务和 WebRTC 生命周期最终仍需大量 Android 原生代码，双层桥接会使最关键路径更难排错。

### 3.2 Mumble 原生语音

默认方案：基于 Mumble 官方组织的 `mumble-voip/libmumble` C++17 源码，固定到经过 POIO 验证的提交，并通过 Android NDK/CMake 编译为 `arm64-v8a` 原生库。

Android 适配层需要实现：

- JNI/Kotlin API：`connect`、`disconnect`、`mute`、`deafen`、`setOutputRoute`、`setInputGain`、`setUserVolume`、`micLevel`、`users`、`talkingState`。
- Mumble 协议会话：TLS、认证、频道移动、UDP 语音、TCP Tunnel 回退、CryptState、Ping 和自动重连。
- 48 kHz 单声道 AudioRecord/AudioTrack 或 Oboe/AAudio 音频 I/O。
- Opus 编解码、抖动缓冲、丢包处理、VAD 和说话状态。
- Android `AcousticEchoCanceler`、`NoiseSuppressor`、音频焦点和 `MODE_IN_COMMUNICATION`。
- 扬声器、听筒、有线耳机和蓝牙通信设备切换。
- 前台 Service 保持锁屏/切后台后的语音连接，并提供静音与挂断通知操作。

重要限制：官方 `libmumble` 是可用的 BSD-3-Clause 低层 C++ 库，但不是开箱即用的 Android 完整客户端，音频设备、抖动缓冲和 POIO 需要的高层状态机仍要开发。它应在第一阶段先做技术验证，不能等 UI 完成后才验证。

备选方案是复用 Mumla/Humla。它已经支持 Android 15/16、蓝牙、Opus 和自动重连，能显著缩短工期，但项目为 GPLv3；将其集成进同一 APK 通常意味着 POIO Android 派生代码也要按 GPLv3 提供。因此除非明确接受 GPLv3，不作为默认实现。

### 3.3 屏幕共享观看

- 使用 Android WebRTC + `libmediasoupclient`；优先评估从源码固定版本构建 `libmediasoup-android` AAR。
- 只创建 `recvTransport`，加载 Router RTP Capabilities，然后消费 `mediaTag=screen` 和 `mediaTag=screen-audio`。
- 视频优先 H.264 Baseline 硬件解码，设备不支持时回退 VP8。
- 使用 `SurfaceViewRenderer`/Texture 组件显示；进入全屏时锁定横屏，退出后恢复系统方向。
- 提供“自动、流畅、中等、高清”接收层；弱网、发热或丢帧时自动降低 Spatial Layer。
- `producerClosed`、Socket.IO 断线、切换频道、挂断和 Activity 销毁都必须走同一幂等清理路径，防止残留静止画面。
- 共享音频只播放 WebRTC 的 `screen-audio`，Mumble 继续承担用户语音，两路音频不能互相替代。

`libmediasoup-android` 是社区封装而非 mediasoup 官方 Android SDK。项目应固定源码提交、自行构建 AAR，并为握手、消费、切层、断开清理和 H.264/VP8 回退增加集成测试，避免直接依赖无人控制的二进制更新。

## 4. 建议工程结构

```text
apps/android/
├─ app/                       # Application、导航、依赖装配
├─ core/model/                # User、Space、Channel、Message 等模型
├─ core/protocol/             # Socket.IO 事件和协议版本
├─ core/network/              # 会话、上传下载、重连
├─ core/design/               # POIO 主题、图标和通用组件
├─ core/database/             # Room 缓存与草稿
├─ feature/auth/
├─ feature/community/
├─ feature/chat/
├─ feature/voice/
├─ feature/screenviewer/
└─ native/mumble/             # C++、JNI、CMake、Opus/Mumble 依赖

packages/protocol/
├─ schema/                    # 客户端/服务端共享 JSON Schema
└─ fixtures/                  # TS 与 Kotlin 共用的协议测试样例
```

Android 工程放入现有 monorepo，不新建孤立仓库。协议 Schema 同时被 Node 服务端和 Kotlin 测试读取，防止桌面、Android、服务端各自猜测字段。

## 5. 服务端先行改动

在开始完整 Android UI 前完成以下兼容层：

1. 增加 `app:capabilities`，返回协议版本、服务器功能、Android 最低/推荐版本和支持的编码。
2. 把认证、社区、频道、聊天、语音和媒体事件整理为共享 Schema，并为 ack 错误定义稳定错误码，中文文案留给客户端。
3. `media:join` 必须验证用户确实属于社区且有权访问该语音频道。
4. 增加 `media:leave`，让移动端切后台或离开频道时明确释放服务器资源。
5. 增加 `media:setPreferredLayers { consumerId, spatialLayer, temporalLayer }` 和查询当前层的返回值。
6. `media:join` 返回当前共享者、Producer、媒体标签、共享档位和可用层，避免 Android 依赖事件到达时序。
7. 为移动网络保留 WebRTC UDP 与 TCP 回退。当前固定 WebRTC 监听端口是 `MEDIASOUP_PORT`（默认 17921），公网防火墙应放通该端口的 UDP 和 TCP；worker 的 42000–42100 范围不是当前 `WebRtcServer` 的主要客户端入口。
8. 增加服务端协议集成测试：未授权频道、重复 join/leave、切换网络、Producer 结束、Consumer 重建和层切换。

## 6. 手机界面信息架构

### 手机

- 首页：顶部为当前社区，抽屉内是社区栏和频道列表，主区域显示聊天或语音房间。
- 语音房间：成员列表、说话状态、共享预览；底部固定麦克风、声音、路由、挂断按钮。
- 屏幕观看：点击共享预览进入沉浸式横屏；单击显示控制栏，双击适配/填满，双指缩放。
- 成员列表：使用右侧 Bottom Sheet，长按其他用户显示 0%–200% 本地音量。
- 设置：麦克风测试、输入增益、VAD 阈值、回声消除、默认输出、移动网络画质和自动播放共享音频。

### 平板/折叠屏

- 宽屏使用社区栏 + 频道栏 + 内容区三栏布局。
- 屏幕共享与成员列表可以并排，避免简单放大手机版。

## 7. 分阶段实施

以下工期以一名熟悉 Kotlin、NDK 和 WebRTC 的开发者为估算；Mumble 原生核心是主要变量。

| 阶段 | 交付物 | 预计时间 | 完成门槛 |
| --- | --- | --- | --- |
| P0 技术验证 | Android 空壳、Socket 登录、Mumble 双向语音 PoC、屏幕消费 PoC | 4–7 天 | 真机可登录、加入大厅、两机通话并观看桌面共享 |
| P1 协议与基础 | 共享 Schema、服务端移动兼容接口、Android 网络/缓存/导航 | 5–7 天 | 断线后自动恢复账号、社区和当前频道 |
| P2 社区与聊天 | 社区/频道、成员、消息、Markdown、图片文件、头像 | 7–10 天 | 与桌面端双向实时互通，中文文件名和 GIF 正常 |
| P3 原生语音产品化 | 前台服务、音频路由、AEC/NS、VAD、成员音量、重连 | 12–20 天 | 扬声器/听筒/有线/蓝牙及锁屏场景通过真机测试 |
| P4 屏幕观看产品化 | 全屏、横屏、共享音频、Simulcast 切层、弱网恢复 | 7–12 天 | 720p/1080p 观看稳定，共享结束无残留画面 |
| P5 质量与发行 | 性能、崩溃、兼容性、签名 APK/AAB、隐私说明 | 7–10 天 | 设备矩阵与长时间稳定性测试通过 |

总工期预估：约 7–10 周。若官方 libmumble Android 技术验证暴露大量缺口，可能增加 2–4 周；若接受 Mumla/Humla 的 GPLv3 方案，可缩短语音阶段，但必须先处理许可策略。

## 8. 验收指标

### 功能

- Android 与 Windows 使用同一账号、社区、频道和聊天记录。
- Android 与 Windows 在同一 Mumble 频道双向通话；静音、关闭声音、挂断和单用户音量立即生效。
- Android 只能消费屏幕共享，界面和权限中不存在发布手机屏幕入口。
- Windows 开始共享后 Android 无需重新进频道即可出现入口；Windows 停止后 1 秒内清除画面。
- Android 可全屏横屏观看并在自动/低/中/高画质间切换。

### 性能与稳定性

- 正常同地域网络下，语音加入 P95 小于 2.5 秒，目标口到耳延迟小于 180 ms。
- 1080p30 观看 30 分钟无持续音画不同步、无黑屏，正常设备平均掉帧率目标低于 3%。
- Wi-Fi 与 5G 切换后 8 秒内恢复 Socket、语音和屏幕观看，不产生重复成员或重复 Consumer。
- 语音模式锁屏 2 小时不被系统无通知杀死；挂断后麦克风和前台服务立即释放。
- 语音模式目标内存低于 150 MB；1080p 屏幕观看目标内存低于 300 MB，并记录发热降档行为。

### 设备矩阵

- Android 8/10/12/14/16。
- 至少一台高通和一台联发科设备、一台低端 4 GB 内存设备、一台平板或折叠屏。
- 扬声器、听筒、3.5 mm/USB 有线耳机、常见蓝牙耳机。

## 9. 测试与发布策略

- Kotlin 单元测试：状态机、协议解析、会话恢复、消息格式和画质策略。
- Node/Kotlin 契约测试：同一组 JSON fixtures 在两端都能解析。
- Compose UI 测试：登录、频道切换、聊天、加入/挂断语音、进入/退出全屏。
- 真机自动化与人工测试：音频焦点、来电打断、蓝牙断连、锁屏、旋转、弱网和进程重建。
- 双端回归：每个 Android 发行版必须与当前稳定 Windows 版互通，而不是只测两个 Android 客户端。
- Android 使用独立长期保存的 JKS/Play App Signing 密钥。Android APK 签名不需要购买 Windows 那类公共代码签名证书，但后续所有更新必须使用同一身份密钥。
- 首期同时生成内部测试 APK 和正式签名 APK；稳定后再决定 GitHub/ModelScope 直发 APK 或 Google Play AAB。

## 10. 开始实施前的准备

当前开发机已经在项目 `.tooling` 目录配置 Microsoft OpenJDK 17、Gradle 9.5、Android SDK 36、Build Tools 36、Platform Tools、NDK 28.2 和 CMake 3.22.1；不依赖全局 Android Studio 安装。继续 P0 仍需要：

1. 准备至少一台能够正常安装调试 APK 的 Android arm64 真机；当前 Rockchip Android 13 设备的系统包验证器配置损坏，不能代替通话验收设备。
2. 在服务器放通并核验 `17921/TCP+UDP`，用蜂窝网络完成一次 WebRTC 接收测试。
3. 已完成固定版本 OpenSSL、Opus、Protobuf、Boost 的 arm64 交叉编译，并接入 TLS、UDP/OCB2、加密 Ping、TCP 心跳及 TLS Tunnel 回退。
4. 已实现 AAudio 低延迟采集播放、系统通话预设、VAD、有限播放缓冲、前台服务和音频路由；AEC/NS 效果、抖动和蓝牙仍需正常真机验证。
5. 已实现远端结束共享立即禁用轨道、正常关闭不误报失败、沉浸式横屏全屏，以及 Socket 重新认证后强制重建 mediasoup 会话；行为仍需与 Windows 发布端联调。
6. 在 Mumble 双向语音 PoC 通过前，不把 Android 版标记为可发布版本。

## 11. 已核对的上游依据

- Mumble 官方当前不提供 Android 客户端，但维护 BSD-3-Clause 的 C++17 `libmumble`：<https://github.com/mumble-voip/libmumble>
- Mumble 官方下载页将 Mumla 列为第三方 Android 客户端：<https://www.mumble.info/downloads/>
- Mumla 3.7.x 已适配 Android 15/16，但源码为 GPLv3：<https://gitlab.com/quite/mumla>
- mediasoup 官方提供 C++ `libmediasoupclient`，其信令由应用自行定义：<https://mediasoup.org/documentation/v3/libmediasoupclient/>
- Android 社区封装 `libmediasoup-android`：<https://github.com/crow-misia/libmediasoup-android>
- Socket.IO 官方 Java 客户端 2.x 与 Socket.IO Server 3.x/4.x 兼容：<https://github.com/socketio/socket.io-client-java>

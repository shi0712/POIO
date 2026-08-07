# POIO 游戏开发手册

本文面向需要把新游戏接入 POIO 的开发者。1.3.0 起，游戏通过注册表接入，主服务 `index.ts` 不再写每个游戏的事件。游戏必须使用娱乐积分，不提供充值、提现或现实价值兑换。

## 目录与职责

```text
apps/server/src/game-plugins/
  sdk.ts          插件、房间、邀请的公共协议
  registry.ts     服务端唯一注册表
  <game>.ts       一个游戏一个事件入口
apps/desktop/src/game-plugins/
  types.ts        桌面/Web 清单接口
  registry.ts     桌面/Web 注册表
  <game>.ts       名称、封面、颜色和图标
apps/android/.../ui/games/
  GamePluginRegistry.kt   Android 注册表
```

游戏规则必须由服务端判定。客户端只发送动作并播放动画，不能自行决定中奖、胜负、积分或房间状态。

## 1. 注册服务端插件

新建 `apps/server/src/game-plugins/example.ts`：

```ts
import { z } from 'zod';
import { defineGame } from './sdk.js';

export const examplePlugin=defineGame({
  manifest:{
    id:'example',
    name:'示例游戏',
    version:1,
    mode:'solo', // solo | space | room
    description:'一句话说明',
    supportsInvites:false,
  },
  register(host){
    host.on('game:example:state',(_raw,{user})=>loadExample(user.id));
    host.on('game:example:play',(raw,{user})=>{
      const input=z.object({wager:z.number().int()}).parse(raw);
      return playExample(user.id,input.wager);
    });
  },
});
```

然后在 `game-plugins/registry.ts` 导入并加入 `gamePlugins`。宿主会统一完成登录校验、错误应答与 Socket 生命周期管理。事件名称必须使用 `game:<gameId>:<action>`。

## 2. 钱包与公平随机

积分修改、会话持久化和对局记录统一位于服务端游戏核心。现有实现可参考 `spinWheel`：

- 开局前扣除 wager；余额不足必须拒绝。
- 随机游戏使用 `createFairSecret` 和 `FairRandom`。
- 对局完成后写入 `game_rounds`，积分变化写入 `game_ledger`。
- 客户端先收到 `serverSeedHash`，结束后收到 `serverSeed`，从而可以复算。
- 所有积分操作应放在数据库事务中。

下注范围为 10–1,000,000；建议指定 10 的倍数。任何客户端传入的倍率、中奖结果或 payout 都不可采信。

## 3. 社区游戏

`mode:'space'` 的事件必须先调用：

```ts
const members=context.requireSpace(spaceId);
```

它同时完成登录用户的社区成员校验，并返回成员列表。共享状态通过 `gameEvents` 发出，再由宿主向 `game:<spaceId>` 广播。Crash 是参考实现。

## 4. 房间游戏

`mode:'room'` 使用 `GameRoomDescriptor` 描述通用房间：

```ts
{
  gameId:'example', spaceId, roomId,
  status:'waiting', capacity:2,
  playerIds:[hostId], wager:100
}
```

推荐事件集合：

- `game:<id>:rooms`：列出社区房间。
- `game:<id>:create`：创建并加入 Socket 房间。
- `game:<id>:join`：作为玩家加入。
- `game:<id>:watch`：仅观看。
- `game:<id>:leave`：离开或由房主解散。
- `game:<id>:state`：服务端推送权威状态。
- `game:<id>:closed`：房间已删除；客户端必须马上移除卡片、关闭房间并清理邀请。

创建、加入、结算和退款要在事务中完成。等待中的房主解散时，应退款、删除数据库记录并广播 `closed`。五子棋是参考实现。

## 5. 邀请协议

使用 `GameInvitationEnvelope` 与 `encodeGameInvitation()`。编码后的内容可以作为私聊消息保存，所以离线用户上线后也能看到：

```ts
encodeGameInvitation({
  gameId:'example', spaceId, roomId,
  title:'加入示例房间', wager:100, pot:200,
  expiresAt:Date.now()+60_000,
});
```

客户端识别 `[[POIO:GAME:INVITE:1]]|<base64url-json>`，显示为卡片，不显示内部标记。点击卡片的顺序必须是：选择社区 → 打开游戏中心 → `join` 房间。邀请应设置短重发冷却（当前为 5 秒）和明确过期时间；房间关闭后清理冷却和未处理邀请。

## 6. 注册客户端入口

桌面/Web：为游戏新建 `apps/desktop/src/game-plugins/<id>.ts`，使用 `defineDesktopGame` 声明封面、颜色和图标，再加入注册表。游戏页面组件通过同名 id 挂载。

Android：在 `MobileGameRegistry` 注册 `MobileGamePlugin`，提供枚举、名称、说明、封面与主题色，并在 `GameCenterScreen` 挂载对应 Compose 页面。

客户端请求必须显示 busy 状态，避免重复下注；动画结束前应禁用操作，但积分和最终结果始终以服务端响应为准。

## 7. 必需测试

提交前至少覆盖：

1. 插件 id 唯一且能出现在 `game:catalog`。
2. 非法 wager、余额不足和重复动作被拒绝。
3. 权威状态可恢复，进程重启后未丢失。
4. 结算前后钱包、流水、对局记录一致。
5. 房间创建、加入、掉线、解散、退款和再次创建。
6. 邀请过期、重发、点击加入及房间关闭后的清理。
7. Windows/Web 与 Android 均能构建，并对同一服务端协议兼容。

常用命令：

```powershell
npm.cmd test
npm.cmd run build
cd apps/android
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
```

## 兼容性规则

- 事件只新增字段时保持旧字段语义不变。
- 破坏性修改应提升插件 manifest `version`，并保留一个版本的解析兼容。
- 邀请协议当前版本为 1；客户端仍兼容 1.2.0 的五子棋旧邀请标记。
- 新游戏需要同步更新服务端、桌面/Web、Android、功能能力清单与发布说明。


# POIO 游戏开发手册

本文说明如何在当前 POIO 架构中开发并注册一个完整小游戏。游戏必须使用娱乐积分；不得提供充值、提现、现实货币兑换或可转让的现实价值。

## 1. 架构原则

1. 服务端是唯一权威：随机数、下注、落子、胜负、结算、退款和积分流水都在服务端完成。
2. 一个游戏一个目录：规则、事件插件、客户端 API、画面和清单不得继续堆进大厅文件。
3. 大厅只做平台能力：登录、钱包、历史、游戏切换、Socket 生命周期和通用错误显示。
4. 客户端只发送意图：客户端动画可以提前播放，但最终状态和余额必须采用服务端响应。
5. 协议向后兼容：事件新增字段可以直接升级；删除或改变字段语义时必须提升 manifest 版本。

## 2. 当前目录

```text
apps/server/src/games/
  shared/                 钱包、流水、对局记录、概览和公共事件
  blackjack/
    index.ts              21 点状态、规则、结算
    plugin.ts             Socket 事件与参数校验
  mines/                  其他游戏采用相同结构
  slots/
  wheel/
  crash/
  gomoku/

apps/desktop/src/games/
  shared/                 通用类型与 GameStage、下注控件等组件
  blackjack/
    types.ts              客户端状态类型
    api.ts                该游戏使用的所有 Socket 请求
    View.tsx              完整 React 页面和动画
    manifest.ts           名称、封面、主题色、图标
  mines/                  其他游戏采用相同结构
  slots/
  wheel/
  crash/
  gomoku/

apps/android/app/src/main/java/cn/poio/mobile/ui/games/
  shared/Components.kt    通用 Compose 容器与下注控件
  blackjack/
    Plugin.kt             Android 游戏清单
    View.kt               完整 Compose 页面
  mines/                  其他游戏采用相同结构
  slots/
  wheel/
  crash/
  gomoku/
```

旧的 `game-plugins/<game>.ts` 文件仅作为兼容转发层保留，新代码必须写入 `games/<game-id>/`。

## 3. 选择模式

服务端 manifest 的 `mode` 决定状态范围：

| 模式 | 用途 | 参考游戏 |
| --- | --- | --- |
| `solo` | 每个用户一份状态，不向社区广播 | Blackjack、Mines、Slots、Wheel |
| `space` | 同一社区共享实时状态 | Crash |
| `room` | 创建、加入、观战和解散独立房间 | Gomoku |

事件必须命名为 `game:<game-id>:<action>`。房间广播使用 `game:<game-id>:state` 和 `game:<game-id>:closed`。

## 4. 服务端实现

创建：

```text
apps/server/src/games/example/index.ts
apps/server/src/games/example/plugin.ts
```

`index.ts` 包含完整规则和数据库操作：

```ts
import { nanoid } from 'nanoid';
import { db } from '../../database.js';
import { FairRandom, createFairSecret } from '../../game-engine.js';
import { changeBalance, checkedWager, emitWallet, gameWallet, recordRound } from '../shared/wallet.js';

export function playExample(userId: string, wagerValue: number) {
  const wager = checkedWager(wagerValue);
  const result = db.transaction(() => {
    const roundId = nanoid();
    changeBalance(userId, -wager, 'wager', 'example', roundId);
    const proof = createFairSecret(`${userId}:${roundId}`);
    const random = new FairRandom(proof);
    const won = random.int(2) === 1;
    const payout = won ? wager * 2 : 0;
    if (payout) changeBalance(userId, payout, 'payout', 'example', roundId);
    recordRound(userId, 'example', roundId, wager, payout, won ? '获胜' : '未中奖', proof, {}, Date.now());
    return { roundId, won, wager, payout, proof: { ...proof, serverSeed: proof.serverSeed } };
  })();
  emitWallet(userId);
  return { state: result, wallet: gameWallet(userId) };
}
```

`plugin.ts` 只负责 manifest、参数校验和事件映射：

```ts
import { z } from 'zod';
import { defineGame } from '../../game-plugins/sdk.js';
import { playExample } from './index.js';

export const examplePlugin = defineGame({
  manifest: {
    id: 'example',
    name: '示例游戏',
    version: 1,
    mode: 'solo',
    description: '一句话说明',
  },
  register(host) {
    host.on('game:example:play', (raw, { user }) => {
      const { wager } = z.object({ wager: z.number().int() }).parse(raw);
      return playExample(user.id, wager);
    });
  },
});
```

最后在 `apps/server/src/game-plugins/registry.ts` 导入 `../games/example/plugin.js` 并加入 `gamePlugins`。

### 钱包与公平随机

- 使用 `checkedWager` 校验 10–1,000,000 范围。
- 扣款、结算、记录必须放在同一个数据库事务中。
- 每次积分变化都调用 `changeBalance`，禁止直接修改余额字段。
- 每局写入 `recordRound`，客户端历史才能完整显示。
- 随机游戏使用 `createFairSecret` 和 `FairRandom`；禁止使用 `Math.random()` 判定结果。
- 开局时只公开 `serverSeedHash`，结束后再公开 `serverSeed`。
- 结算后调用 `emitWallet`，让所有在线端同步余额。

## 5. 社区与房间接口

`mode: 'space'` 的事件先调用 `context.requireSpace(spaceId)`，完成成员权限校验。共享状态通过 `gameEvents` 发送，由平台广播给 `game:<spaceId>`。

`mode: 'room'` 推荐实现以下事件：

- `game:<id>:rooms`：列出当前社区房间。
- `game:<id>:create`：扣除押注并创建房间。
- `game:<id>:join`：加入等待中的房间。
- `game:<id>:watch`：只观战，不参与结算。
- `game:<id>:move`：发送玩家动作。
- `game:<id>:leave`：离开或由房主解散。
- `game:<id>:state`：推送权威状态。
- `game:<id>:closed`：房间删除，客户端立即移除卡片并清理邀请。

等待中的房主解散时必须在事务中退款并删除持久化数据。断线不应立刻判负；应给玩家短暂重连时间，或提供显式认输规则。

邀请使用 `GameInvitationEnvelope` 和 `encodeGameInvitation()`：

```ts
encodeGameInvitation({
  gameId: 'example',
  spaceId,
  roomId,
  title: '加入示例房间',
  wager: 100,
  pot: 200,
  expiresAt: Date.now() + 60_000,
});
```

邀请通过私聊消息持久化。点击卡片时依次执行：选择社区、打开游戏中心、调用 `join`。房间关闭后必须使旧邀请失效；重发冷却建议为 5 秒。

## 6. Windows/Web 实现

创建 `apps/desktop/src/games/example/`：

- `types.ts`：服务端返回状态的 TypeScript 类型。
- `api.ts`：集中封装 `game:example:*` 请求，页面中不直接拼事件名。
- `View.tsx`：游戏完整页面、操作区和动画。
- `manifest.ts`：使用 `defineDesktopGame` 声明入口。

manifest 示例：

```ts
import { Sparkles } from 'lucide-react';
import art from '../../assets/games/example-cover.png';
import { defineDesktopGame } from '../../game-plugins/types';

export const exampleDesktopPlugin = defineDesktopGame({
  id: 'example',
  name: '示例游戏',
  eyebrow: 'EXAMPLE',
  description: '一句话说明',
  accent: '#795bff',
  art,
  icon: Sparkles,
});
```

在 `apps/desktop/src/game-plugins/registry.ts` 注册 manifest，并在 `GameCenter.tsx` 挂载页面。大厅只传入状态和动作，不应复制游戏规则。

## 7. Android 实现

创建：

```text
apps/android/.../ui/games/example/Plugin.kt
apps/android/.../ui/games/example/View.kt
```

`Plugin.kt` 提供 `MobileGamePlugin`；`View.kt` 导出一个公开的 `@Composable` 页面。通用容器使用 `ui.games.shared.GameScaffold` 和 `WagerControl`。

在 `GamePluginRegistry.kt` 注册清单，在 `GameCenterScreen.kt` 中挂载页面。网络动作仍通过 `PoioActions` 进入共享 Repository，最终状态来自服务端推送或 ack。

## 8. 必需测试

每个新游戏至少覆盖：

1. 插件 id 唯一且出现在 `game:catalog`。
2. 非法 wager、余额不足、重复动作被拒绝。
3. 服务端忽略客户端伪造的倍率、payout、赢家或棋盘。
4. 钱包余额、流水和对局记录在结算前后一致。
5. 随机结果可用公开种子复算。
6. 房间游戏覆盖创建、加入、观战、非法回合、断线、解散、退款、再建和旧邀请失效。
7. Desktop 构建、Server 测试和 Android 编译全部通过。

```powershell
npm.cmd run build -w @echodeck/server
npm.cmd run test -w @echodeck/server
npm.cmd run build -w @echodeck/desktop
cd apps/android
.\gradlew.bat :app:compileDebugKotlin :app:testDebugUnitTest
```

## 9. 完成清单

- [ ] 服务端目录含 `index.ts`、`plugin.ts` 和测试。
- [ ] Desktop 目录含 `types.ts`、`api.ts`、`View.tsx`、`manifest.ts`。
- [ ] Android 目录含 `Plugin.kt`、`View.kt`。
- [ ] 三端使用相同 game id 和事件前缀。
- [ ] 没有客户端权威的积分或胜负逻辑。
- [ ] manifest 和三个注册表已更新。
- [ ] 邀请、房间关闭和重连状态已验证。
- [ ] 服务端、Desktop、Android 校验通过。

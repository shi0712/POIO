import { blackjackPlugin } from '../games/blackjack/plugin.js';
import { coreGamePlugin } from '../games/shared/plugin.js';
import { crashPlugin } from '../games/crash/plugin.js';
import { gomokuPlugin } from '../games/gomoku/plugin.js';
import { minesPlugin } from '../games/mines/plugin.js';
import type { GamePlugin } from './sdk.js';
import { slotsPlugin } from '../games/slots/plugin.js';
import { wheelPlugin } from '../games/wheel/plugin.js';
import { texasHoldemPlugin } from '../games/texas-holdem/plugin.js';
import { poolPlugin } from '../games/pool/plugin.js';

export const gamePlugins:GamePlugin[]=[coreGamePlugin,blackjackPlugin,minesPlugin,crashPlugin,slotsPlugin,wheelPlugin,gomokuPlugin,texasHoldemPlugin,poolPlugin];

export function registerGamePlugins(host:Parameters<GamePlugin['register']>[0]){
  const ids=new Set<string>();
  for(const plugin of gamePlugins){if(ids.has(plugin.manifest.id))throw new Error(`重复的游戏插件: ${plugin.manifest.id}`);ids.add(plugin.manifest.id);plugin.register(host);}
  host.on('game:catalog',()=>gamePlugins.filter(plugin=>plugin.manifest.id!=='core').map(plugin=>plugin.manifest));
}

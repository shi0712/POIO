import { blackjackPlugin } from './blackjack.js';
import { coreGamePlugin } from './core.js';
import { crashPlugin } from './crash.js';
import { gomokuPlugin } from './gomoku.js';
import { minesPlugin } from './mines.js';
import type { GamePlugin } from './sdk.js';
import { slotsPlugin } from './slots.js';
import { wheelPlugin } from './wheel.js';

export const gamePlugins:GamePlugin[]=[coreGamePlugin,blackjackPlugin,minesPlugin,crashPlugin,slotsPlugin,wheelPlugin,gomokuPlugin];

export function registerGamePlugins(host:Parameters<GamePlugin['register']>[0]){
  const ids=new Set<string>();
  for(const plugin of gamePlugins){if(ids.has(plugin.manifest.id))throw new Error(`重复的游戏插件: ${plugin.manifest.id}`);ids.add(plugin.manifest.id);plugin.register(host);}
  host.on('game:catalog',()=>gamePlugins.filter(plugin=>plugin.manifest.id!=='core').map(plugin=>plugin.manifest));
}

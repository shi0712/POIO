import { z } from 'zod';
import { defineGame } from '../../game-plugins/sdk.js';
import { cashoutMines,minesState,revealMineCell,startMines } from './index.js';
export const minesPlugin=defineGame({manifest:{id:'mines',name:'Mines',version:1,mode:'solo',description:'避开地雷并随时结算'},register(host){host.on('game:mines:state',(_raw,{user})=>minesState(user.id));host.on('game:mines:start',(raw,{user})=>{const value=z.object({wager:z.number().int(),mineCount:z.number().int()}).parse(raw);return startMines(user.id,value.wager,value.mineCount);});host.on('game:mines:reveal',(raw,{user})=>revealMineCell(user.id,z.object({cell:z.number().int().min(0).max(24)}).parse(raw).cell));host.on('game:mines:cashout',(_raw,{user})=>cashoutMines(user.id));}});

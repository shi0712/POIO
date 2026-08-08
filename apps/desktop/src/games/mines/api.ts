import { request } from '../../api';
import type { Wallet } from '../shared/types';
import type { MinesState } from './types';
export const startMines=(wager:number,mineCount:number)=>request<{state:MinesState;wallet:Wallet}>('game:mines:start',{wager,mineCount});
export const revealMinesCell=(cell:number)=>request<{state:MinesState;wallet:Wallet}>('game:mines:reveal',{cell});
export const cashoutMines=()=>request<{state:MinesState;wallet:Wallet}>('game:mines:cashout');


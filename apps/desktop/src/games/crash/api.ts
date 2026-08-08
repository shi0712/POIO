import { request } from '../../api';
import type { Wallet } from '../shared/types';
import type { CrashState } from './types';
export const placeCrashBet=(spaceId:string,wager:number)=>request<{state:CrashState;wallet:Wallet}>('game:crash:bet',{spaceId,wager});
export const cashoutCrash=(spaceId:string)=>request<{state:CrashState;wallet:Wallet}>('game:crash:cashout',{spaceId});


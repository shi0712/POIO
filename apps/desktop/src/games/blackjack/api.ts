import { request } from '../../api';
import type { Wallet } from '../shared/types';
import type { BlackjackState } from './types';
export const startBlackjack=(wager:number)=>request<{state:BlackjackState;wallet:Wallet}>('game:blackjack:start',{wager});
export const moveBlackjack=(action:'hit'|'stand'|'double')=>request<{state:BlackjackState;wallet:Wallet}>('game:blackjack:action',{action});


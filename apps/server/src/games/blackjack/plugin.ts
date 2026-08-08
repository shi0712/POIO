import { z } from 'zod';
import { defineGame } from '../../game-plugins/sdk.js';
import { blackjackAction,blackjackState,startBlackjack } from './index.js';
export const blackjackPlugin=defineGame({manifest:{id:'blackjack',name:'21 点',version:1,mode:'solo',description:'经典 Blackjack 单人对局'},register(host){host.on('game:blackjack:state',(_raw,{user})=>blackjackState(user.id));host.on('game:blackjack:start',(raw,{user})=>startBlackjack(user.id,z.object({wager:z.number().int()}).parse(raw).wager));host.on('game:blackjack:action',(raw,{user})=>blackjackAction(user.id,z.object({action:z.enum(['hit','stand','double'])}).parse(raw).action));}});

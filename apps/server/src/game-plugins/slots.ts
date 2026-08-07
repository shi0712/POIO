import { z } from 'zod';
import { playSlots, slotState } from '../games.js';
import { defineGame } from './sdk.js';

export const slotsPlugin=defineGame({
  manifest:{id:'slots',name:'霓虹转转',version:1,mode:'solo',description:'10 条中奖线与免费旋转'},
  register(host){
    host.on('game:slots:state',(_raw,{user})=>slotState(user.id));
    host.on('game:slots:spin',(raw,{user})=>{const value=z.object({wager:z.number().int(),useFreeSpin:z.boolean().optional()}).parse(raw);return playSlots(user.id,value.wager,value.useFreeSpin);});
  },
});


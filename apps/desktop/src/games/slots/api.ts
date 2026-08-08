import { request } from '../../api';
import type { Wallet } from '../shared/types';
import type { SlotSpin } from './types';
export const spinSlots=(wager:number,useFreeSpin:boolean)=>request<{spin:SlotSpin;wallet:Wallet}>('game:slots:spin',{wager,useFreeSpin});


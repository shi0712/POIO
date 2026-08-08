import { request } from '../../api';
import type { Wallet } from '../shared/types';
import type { WheelSpin } from './types';
export const spinWheel=(wager:number)=>request<{spin:WheelSpin;wallet:Wallet}>('game:wheel:spin',{wager});


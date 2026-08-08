import { blackjackState } from '../blackjack/index.js';
import { crashState } from '../crash/index.js';
import { gomokuRooms } from '../gomoku/index.js';
import { minesState } from '../mines/index.js';
import { slotState } from '../slots/index.js';
import { wheelState } from '../wheel/index.js';
import { texasRooms } from '../texas-holdem/index.js';
import { gameHistory,gameLedger,gameWallet } from './wallet.js';
export function gameOverview(userId:string,spaceId?:string){return{wallet:gameWallet(userId),ledger:gameLedger(userId,12),history:gameHistory(userId,12),blackjack:blackjackState(userId),mines:minesState(userId),slots:slotState(userId),wheel:wheelState(userId),crash:spaceId?crashState(spaceId,userId):undefined,gomokuRooms:spaceId?gomokuRooms(spaceId,userId):[],texasRooms:spaceId?texasRooms(spaceId,userId):[]};}

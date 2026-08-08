import { Bomb } from 'lucide-react';
import art from '../../assets/games/mines-cover.png';
import { defineDesktopGame } from '../../game-plugins/types';
export const minesDesktopPlugin=defineDesktopGame({id:'mines',name:'Mines',eyebrow:'MINES',description:'翻开安全水晶，随时收下不断上涨的倍率。',accent:'#42dfce',art,icon:Bomb});

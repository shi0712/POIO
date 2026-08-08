import { Spade } from 'lucide-react';
import art from '../../assets/games/blackjack-cover.png';
import { defineDesktopGame } from '../../game-plugins/types';
export const blackjackDesktopPlugin=defineDesktopGame({id:'blackjack',name:'21 点',eyebrow:'BLACKJACK',description:'要牌、停牌、加倍，与庄家正面对决。',accent:'#9d7cff',art,icon:Spade});


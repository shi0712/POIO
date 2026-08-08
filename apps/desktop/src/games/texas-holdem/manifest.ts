import { Club } from 'lucide-react';
import art from '../../assets/games/texas-holdem-cover.svg';
import { defineDesktopGame } from '../../game-plugins/types';
export const texasHoldemDesktopPlugin=defineDesktopGame({id:'texas-holdem',name:'德州扑克',eyebrow:'TEXAS HOLD’EM',description:'2–6 人实时牌桌，完整下注轮、边池、观战与可验证洗牌。',accent:'#f0b85a',art,icon:Club});

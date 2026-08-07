import { CircleDot } from 'lucide-react';import art from '../assets/games/gomoku-cover.svg';import { defineDesktopGame } from './types';
export const gomokuDesktopPlugin=defineDesktopGame({id:'gomoku',name:'联机五子棋',eyebrow:'GOMOKU DUEL',description:'创建棋桌，和社区成员实时对弈，支持观战与再战。',accent:'#c9a66b',art,icon:CircleDot});

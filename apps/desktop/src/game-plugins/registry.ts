import { blackjackDesktopPlugin } from './blackjack';import { crashDesktopPlugin } from './crash';import { gomokuDesktopPlugin } from './gomoku';import { minesDesktopPlugin } from './mines';import { slotsDesktopPlugin } from './slots';import { wheelDesktopPlugin } from './wheel';
export const desktopGames=[blackjackDesktopPlugin,minesDesktopPlugin,crashDesktopPlugin,slotsDesktopPlugin,wheelDesktopPlugin,gomokuDesktopPlugin] as const;
export type DesktopGameId=typeof desktopGames[number]['id'];

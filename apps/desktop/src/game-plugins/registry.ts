import { blackjackDesktopPlugin } from '../games/blackjack/manifest';
import { crashDesktopPlugin } from '../games/crash/manifest';
import { gomokuDesktopPlugin } from '../games/gomoku/manifest';
import { minesDesktopPlugin } from '../games/mines/manifest';
import { slotsDesktopPlugin } from '../games/slots/manifest';
import { wheelDesktopPlugin } from '../games/wheel/manifest';
import { texasHoldemDesktopPlugin } from '../games/texas-holdem/manifest';
export const desktopGames=[blackjackDesktopPlugin,minesDesktopPlugin,crashDesktopPlugin,slotsDesktopPlugin,wheelDesktopPlugin,gomokuDesktopPlugin,texasHoldemDesktopPlugin] as const;
export type DesktopGameId=typeof desktopGames[number]['id'];

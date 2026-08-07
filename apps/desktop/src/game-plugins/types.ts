import type { LucideIcon } from 'lucide-react';
export type DesktopGamePlugin={id:string;name:string;eyebrow:string;description:string;accent:string;art:string;icon:LucideIcon};
export const defineDesktopGame=<T extends DesktopGamePlugin>(plugin:T)=>plugin;


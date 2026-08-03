import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const web=resolve(here,'..');
await mkdir(resolve(web,'public'),{recursive:true});
await copyFile(resolve(web,'../desktop/build/icon.png'),resolve(web,'public/icon.png'));

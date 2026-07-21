import { cp, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist/generated/',import.meta.url),{recursive:true});
await cp(new URL('../src/generated/MumbleServer.cjs',import.meta.url),new URL('../dist/generated/MumbleServer.cjs',import.meta.url));

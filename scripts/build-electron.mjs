import { build } from 'rolldown';
import path from 'node:path';
for(const name of ['main','preload']) await build({input:path.resolve(`electron/${name}.ts`),platform:'node',external:['electron'],output:{file:`electron-dist/${name}.cjs`,format:'cjs'}});
console.log('Electron bundles built');

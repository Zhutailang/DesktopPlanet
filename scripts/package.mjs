import { packager } from '@electron/packager';
import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { freshConfig } from '../src/config.ts';
const root = process.cwd();
await writeFile(path.join(root, 'outputs', '太阳系默认配置.json'), JSON.stringify(freshConfig(), null, 2));
const stage = path.resolve('release-stage', `build-${Date.now()}`);
await mkdir(stage, { recursive: true });
await cp('dist', path.join(stage, 'dist'), { recursive: true });
await cp('electron-dist', path.join(stage, 'electron-dist'), { recursive: true });
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: pkg.main }, null, 2));
await cp('THIRD_PARTY_NOTICES.md', path.join(stage, 'THIRD_PARTY_NOTICES.md'));
const output = process.env.JOVIAN_PACKAGE_OUT || path.resolve('release');
const paths = await packager({
  dir: stage, out: output, name: 'Jovian Desk', platform: 'win32', arch: 'x64',
  electronVersion: pkg.devDependencies.electron, asar: true, overwrite: false,
  icon: path.join(root, 'public', 'icon.ico'),
  download: { cacheRoot: process.env.ELECTRON_CACHE || path.resolve('work', 'electron-cache') },
  win32metadata: { CompanyName: 'Jovian Desk', FileDescription: 'Jovian Desk - Desktop Solar System Observatory', ProductName: 'Jovian Desk', InternalName: 'jovian-desk' },
});
for (const outputPath of paths) {
  await cp('README.md', path.join(outputPath, '使用说明.md'));
  await cp('outputs/木星默认配置.json', path.join(outputPath, '木星默认配置.json'));
  await cp('outputs/太阳系默认配置.json', path.join(outputPath, '太阳系默认配置.json'));
}
console.log(paths.join('\n'));


import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd(), result=path.join(root,'test-results',`packaged-smoke-${Date.now()}`), userData=path.join(result,'user-data');
await mkdir(userData,{recursive:true});
const executablePath=path.resolve('outputs/Jovian Desk-win32-x64/Jovian Desk.exe');
const env={...process.env,JOVIAN_TEST:'1',JOVIAN_DATA_DIR:userData};delete env.ELECTRON_RUN_AS_NODE;
async function launch(){
  const app=await electron.launch({executablePath,env,timeout:60000});
  await expect.poll(()=>app.windows().length,{timeout:30000}).toBe(2);
  const page=app.windows().find(p=>!p.url().includes('settings'));
  await app.evaluate(({BrowserWindow,screen})=>{const d=screen.getAllDisplays().sort((a,b)=>a.bounds.width*a.bounds.height-b.bounds.width*b.bounds.height)[0];const w=BrowserWindow.getAllWindows().find(x=>!x.getTitle().includes('观测设置'));w.setBounds(d.workArea);w.showInactive();});
  await page.waitForFunction(()=>window.__jovianDebug?.getSnapshot().ready,null,{timeout:60000});return {app,page};
}
let running;
try{
  running=await launch();let {app,page}=running;
  const meta=await app.evaluate(({app,BrowserWindow})=>({packaged:app.isPackaged,version:app.getVersion(),windows:BrowserWindow.getAllWindows().length}));
  let scene=await page.evaluate(()=>window.__jovianDebug.getSnapshot());
  assert.deepEqual(meta,{packaged:true,version:'0.2.0',windows:2});assert.equal(scene.config.version,2);assert.equal(scene.config.planets.length,8);
  assert.equal(scene.visiblePlanets.length,8);assert.equal(scene.visibleMoons.length,0);assert.equal(scene.moons.length,21);assert.equal(scene.asteroidCount,2400);assert.equal(scene.canvasAlpha,true);
  assert.equal(await page.locator('#app > :not(#viewport):not(.planet-dock)').count(),0);
  await page.getByLabel('切换行星系统').selectOption('earth');
  await expect.poll(()=>page.evaluate(()=>{const s=window.__jovianDebug.getSnapshot();return !s.transitioning&&s.activeSystemId;}),{timeout:15000}).toBe('earth');
  assert.deepEqual((await page.evaluate(()=>window.__jovianDebug.getSnapshot())).visibleMoons,['moon']);
  const normal=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.getTitle().includes('观测设置')).getBounds());
  const display=await app.evaluate(({screen},b)=>screen.getDisplayMatching(b).bounds,normal);
  await page.getByRole('button',{name:'铺满当前屏幕',exact:true}).click();
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.getTitle().includes('观测设置')).getBounds())).toEqual(display);
  await page.keyboard.press('Escape');
  await app.close();running=null;

  const legacy=JSON.parse(await readFile(path.join(root,'outputs','木星默认配置.json'),'utf8'));legacy.planet.spinPeriodHours=17;legacy.satellites.items[0].name='迁移保留';
  await writeFile(path.join(userData,'config.json'),JSON.stringify(legacy,null,2));
  running=await launch();({app,page}=running);scene=await page.evaluate(()=>window.__jovianDebug.getSnapshot());
  assert.equal(scene.config.version,2);assert.equal(scene.activeSystemId,'jupiter');
  const jupiter=scene.config.planets.find(p=>p.id==='jupiter');assert.equal(jupiter.planet.spinPeriodHours,17);assert.equal(jupiter.satellites.items[0].name,'迁移保留');
  assert.equal(JSON.parse(await readFile(path.join(userData,'config.json'),'utf8')).version,2);
  assert.ok((await readdir(userData)).some(name=>/^config-v1-backup-\d+\.json$/.test(name)));
  await writeFile(path.join(result,'result.json'),JSON.stringify({meta,scene},null,2));
  console.log('PACKAGED SOLAR APP AND V1 MIGRATION PASSED',result);
} finally {if(running)await running.app.close();}

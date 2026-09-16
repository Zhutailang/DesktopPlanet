import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root=process.cwd(), output=path.join(root,'test-results',`bloom-${Date.now()}`);
await mkdir(output,{recursive:true});
const env={...process.env,JOVIAN_TEST:'1',JOVIAN_DATA_DIR:path.join(output,'user-data')};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({env,timeout:60000,...(process.env.JOVIAN_BLOOM_EXE?{executablePath:process.env.JOVIAN_BLOOM_EXE}:{args:[root]})});
const errors=[];
try{
  await expect.poll(()=>app.windows().length,{timeout:30000}).toBe(2);
  const page=app.windows().find(p=>!p.url().includes('settings')),settings=app.windows().find(p=>p.url().includes('settings'));
  for(const p of app.windows()){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
  await app.evaluate(({BrowserWindow,screen})=>{
    const display=screen.getAllDisplays().sort((a,b)=>a.bounds.width*a.bounds.height-b.bounds.width*b.bounds.height)[0];
    const w=BrowserWindow.getAllWindows().find(w=>!w.getTitle().includes('观测设置'));w.setBounds(display.workArea);w.showInactive();
  });
  await page.waitForFunction(()=>window.__jovianDebug?.getSnapshot().ready,null,{timeout:60000});
  async function patch(key,value){const r=await page.evaluate(({key,value})=>window.jovian.patch(key,value),{key,value});assert.equal(r.ok,true);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
  async function capture(name){const png=await page.screenshot({path:path.join(output,`${name}.png`),omitBackground:true});await sharp(png).flatten({background:'#080e18'}).png().toFile(path.join(output,`${name}-dark-desktop.png`));return sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
  const settle=id=>expect.poll(()=>page.evaluate(()=>{const s=window.__jovianDebug.getSnapshot();return !s.transitioning&&s.activeSystemId;}),{timeout:20000}).toBe(id);
  await patch('simulation.paused',true);await capture('solar-bloom');
  await patch('$navigate','jupiter');await settle('jupiter');await capture('jupiter-system-bloom');
  // Remove rings and satellites so added non-zero alpha can only be the planet's halo.
  await patch('planets.4.satellites.enabled',false);await patch('planets.4.rings.enabled',false);await patch('view.showHUD',false);
  await patch('view.bloomEnabled',false);const before=await capture('jupiter-no-bloom');
  await patch('view.bloomEnabled',true);const after=await capture('jupiter-bloom');
  let haloPixels=0,haloAlpha=0,clearPixels=0;
  for(let i=3;i<after.data.length;i+=4){if(before.data[i]===0&&after.data[i]>5){haloPixels++;haloAlpha+=after.data[i];}if(after.data[i]===0)clearPixels++;}
  assert.ok(haloPixels>2000,`Visible glow outside the actual silhouette: ${haloPixels}`);
  assert.ok(clearPixels>after.info.width*after.info.height*0.35,'The surrounding desktop stays transparent');
  for(const [x,y] of [[0,0],[after.info.width-1,0],[0,after.info.height-1],[after.info.width-1,after.info.height-1]])assert.equal(after.data[(y*after.info.width+x)*4+3],0,'No opaque background rectangle');
  const centre=await page.evaluate(()=>window.__jovianDebug.getSnapshot().sceneCenter);
  const radius=after.info.height/(await page.evaluate(()=>window.__jovianDebug.getSnapshot().viewHalfHeight)*2);
  assert.equal(await page.evaluate(p=>window.__jovianDebug.hitAt(p.x,p.y),{x:centre.x+radius+8,y:centre.y}),false,'Halo does not block desktop clicks');
  await patch('view.bloomStrength',2);const strong=await capture('jupiter-strong-bloom');let strongHaloAlpha=0;
  for(let i=3;i<strong.data.length;i+=4)if(before.data[i]===0&&strong.data[i]>5)strongHaloAlpha+=strong.data[i];
  assert.ok(strongHaloAlpha>haloAlpha*1.1,'Increasing strength visibly increases the glow');
  await patch('view.bloomStrength',0);const zero=await capture('jupiter-zero-bloom');assert.deepEqual(zero.data,before.data,'Zero intensity fully disables bloom');
  await patch('view.bloomStrength',1);await patch('view.showHUD',true);
  await patch('$navigate','earth');await settle('earth');await capture('earth-bloom');
  await patch('$navigate','saturn');await settle('saturn');await capture('saturn-bloom');
  await settings.getByRole('tab',{name:'显示',exact:true}).click();
  await settings.getByLabel('光晕强度',{exact:true}).fill('1.25');await settings.getByLabel('光晕强度',{exact:true}).press('Tab');
  await settings.getByLabel('光晕扩散范围',{exact:true}).fill('0.65');await settings.getByLabel('光晕扩散范围',{exact:true}).press('Tab');
  await expect.poll(()=>page.evaluate(()=>window.__jovianDebug.getSnapshot().config.view.bloomRadius)).toBe(0.65);
  const persisted=JSON.parse(await readFile(path.join(output,'user-data','config.json'),'utf8'));
  assert.equal(persisted.view.bloomStrength,1.25);assert.equal(persisted.view.bloomRadius,0.65);
  assert.deepEqual(errors,[],'No renderer or shader errors');
  await writeFile(path.join(output,'verification.json'),JSON.stringify({haloPixels,haloAlpha,strongHaloAlpha,clearPixels,errors},null,2));
  console.log('BLOOM, TRANSPARENCY, DESKTOP HIT TEST AND SETTINGS PASSED',output);
}catch(error){console.error('Bloom verification failed',output,errors);throw error;}
finally{await app.close();}

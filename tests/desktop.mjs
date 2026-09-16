import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import sharp from 'sharp';
const root=process.cwd(), resultDir=path.join(root,'test-results',`solar-${Date.now()}`), userData=path.join(resultDir,'user-data');
await mkdir(userData,{recursive:true});
const env={...process.env,JOVIAN_TEST:'1',JOVIAN_DATA_DIR:userData};delete env.ELECTRON_RUN_AS_NODE;
const options={args:[root],env,timeout:60000};
let application,planet,settings;const errors=[];const snapshots={};
async function launch(){
  application=await electron.launch(options);await expect.poll(()=>application.windows().length,{timeout:30000}).toBe(2);
  planet=application.windows().find(p=>!p.url().includes('settings'));settings=application.windows().find(p=>p.url().includes('settings'));
  for(const page of application.windows()){page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
  await application.evaluate(({BrowserWindow,screen})=>{
    const display=screen.getAllDisplays().sort((a,b)=>a.bounds.width*a.bounds.height-b.bounds.width*b.bounds.height)[0];
    const widget=BrowserWindow.getAllWindows().find(w=>!w.getTitle().includes('观测设置'));
    widget.setBounds(display.workArea);widget.showInactive();
  });
  await planet.waitForFunction(()=>window.__jovianDebug?.getSnapshot().ready,null,{timeout:60000});
  await settings.getByRole('heading',{name:'星球本体',exact:true}).waitFor();
}
const snapshot=()=>planet.evaluate(()=>window.__jovianDebug.getSnapshot());
const patch=(path,value)=>planet.evaluate(({path,value})=>window.jovian.patch(path,value),{path,value});
async function settled(id){await expect.poll(async()=>{const s=await snapshot();return !s.transitioning&&s.activeSystemId===id;},{timeout:12000}).toBe(true);}
async function navigate(id){await planet.getByLabel('切换行星系统').selectOption(id);await settled(id);}
async function capture(name){await planet.screenshot({path:path.join(resultDir,`${name}.png`),omitBackground:true});snapshots[name]=await snapshot();}
async function fill(label,value){const input=settings.getByLabel(label,{exact:true});await input.fill(String(value));await input.press('Tab');}
try{
  await launch();let s=await snapshot();assert.equal(s.activeSystemId,'solar');assert.equal(s.visiblePlanets.length,8);assert.equal(s.visibleMoons.length,0);assert.equal(s.asteroidCount,2400);assert.equal(s.canvasAlpha,true);
  assert.equal(await planet.locator('#app > :not(#viewport):not(.planet-dock)').count(),0);
  await patch('simulation.paused',true);await capture('solar-overview');console.log('Solar overview ready');
  await patch('view.transitionSeconds',2);
  await patch('$navigate','earth');
  await planet.waitForFunction(()=>{const s=window.__jovianDebug.getSnapshot();return s.transitioning&&s.transitionProgress>0.2&&s.transitionProgress<0.8;});
  await capture('transition-to-earth');await settled('earth');await capture('earth-moon');
  await patch('view.transitionSeconds',1.1);
  const alpha=await sharp(path.join(resultDir,'transition-to-earth.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let visible=0,transparent=0;for(let i=3;i<alpha.data.length;i+=4){if(alpha.data[i]>10)visible++;if(alpha.data[i]===0)transparent++;}
  assert.ok(visible>500&&transparent>alpha.info.width*alpha.info.height*0.3,'Transition preserves transparent background and visible scene');
  const counts={mercury:0,venus:0,earth:1,mars:2,jupiter:4,saturn:7,uranus:5,neptune:2};
  for(const [id,count] of Object.entries(counts)){await navigate(id);s=await snapshot();assert.deepEqual(s.visiblePlanets,[id]);assert.equal(s.visibleMoons.length,count);await capture(`system-${id}`);}
  console.log('All eight planetary systems and transition rendering passed');
  await planet.getByLabel('切换行星系统').selectOption('earth');
  await planet.getByLabel('切换行星系统').selectOption('mars');
  await planet.getByLabel('切换行星系统').selectOption('saturn');await settled('saturn');
  await planet.getByRole('button',{name:'返回太阳系',exact:true}).click();await settled('solar');
  const earthPoint=await planet.evaluate(()=>window.__jovianDebug.screenPosition('earth'));assert.ok(earthPoint);
  await planet.mouse.dblclick(earthPoint.x,earthPoint.y);await settled('earth');
  await patch('simulation.paused',false);const before=(await snapshot()).planets.find(p=>p.id==='earth').spin;
  await expect.poll(async()=>(await snapshot()).planets.find(p=>p.id==='earth').spin).not.toBe(before);
  await patch('simulation.paused',true);const frozen=(await snapshot()).planets.find(p=>p.id==='earth').spin;
  await fill('自转周期',27);await expect.poll(async()=>(await snapshot()).config.planets.find(p=>p.id==='earth').planet.spinPeriodHours).toBe(27);
  assert.equal((await snapshot()).planets.find(p=>p.id==='earth').spin,frozen);
  await fill('自转周期',0);await expect(settings.getByRole('status')).toContainText('spinPeriodHours');
  assert.equal((await snapshot()).config.planets.find(p=>p.id==='earth').planet.spinPeriodHours,27);
  await navigate('jupiter');assert.equal((await snapshot()).config.planets.find(p=>p.id==='jupiter').planet.spinPeriodHours,9.925);
  await settings.getByRole('tab',{name:'星环',exact:true}).click();await settings.getByRole('button',{name:'宽环演示'}).click();
  await expect.poll(async()=>(await snapshot()).config.planets.find(p=>p.id==='jupiter').rings.width).toBe(1.1);await capture('custom-jupiter-rings');
  await settings.getByRole('tab',{name:'卫星',exact:true}).click();await settings.getByRole('button',{name:/添加卫星/}).click();
  await fill('卫星名称','自定义木卫');await fill('卫星半径',2300);await fill('轨道倾角',35);await fill('卫星自转周期',18);await fill('卫星公转周期',70);
  await expect.poll(async()=>(await snapshot()).visibleMoons.length).toBe(5);
  await navigate('earth');assert.equal((await snapshot()).visibleMoons.length,1);await navigate('jupiter');assert.equal((await snapshot()).visibleMoons.length,5);
  console.log('Spin, independent settings, rings and custom moons passed');
  await settings.getByRole('tab',{name:'太阳系',exact:true}).click();await settings.getByRole('button',{name:/添加行星/}).click();
  await expect.poll(async()=>(await snapshot()).config.planets.length).toBe(9);
  const customId=(await snapshot()).config.navigation.selectedPlanetId;await settled(customId);
  await fill('行星名称','蓝色新世界');await fill('行星半径',7000);await fill('自转周期',20);await fill('行星公转周期',40000);
  await settings.getByRole('tab',{name:'卫星',exact:true}).click();await settings.getByRole('button',{name:/添加卫星/}).click();
  await fill('卫星名称','新世界之月');await fill('卫星半径',500);await fill('卫星公转周期',88);await fill('卫星自转周期',88);
  await expect.poll(async()=>(await snapshot()).visibleMoons.length).toBe(1);await capture('custom-planet-system');
  await navigate('solar');assert.equal((await snapshot()).visiblePlanets.length,9);assert.equal((await snapshot()).visibleMoons.length,0);
  await navigate(customId);assert.equal((await snapshot()).config.planets.find(p=>p.id===customId).satellites.items[0].name,'新世界之月');
  await settings.getByRole('tab',{name:'显示',exact:true}).click();await settings.getByLabel('空间比例',{exact:true}).selectOption('physical');
  await expect.poll(async()=>(await snapshot()).config.view.scaleMode).toBe('physical');
  await settings.getByLabel('空间比例',{exact:true}).selectOption('presentation');
  const beforeDrag=await snapshot(),centre=beforeDrag.sceneCenter,orientation=beforeDrag.orientation,zoomBeforeDrag=beforeDrag.config.view.zoom,halfHeightBeforeDrag=beforeDrag.viewHalfHeight;
  await planet.mouse.move(centre.x,centre.y);await planet.mouse.down();await planet.mouse.move(centre.x+55,centre.y+18,{steps:10});await planet.mouse.up();
  await expect.poll(async()=>JSON.stringify((await snapshot()).orientation)).not.toBe(JSON.stringify(orientation));
  const afterDrag=await snapshot();assert.equal(afterDrag.config.view.zoom,zoomBeforeDrag);assert.ok(Math.abs(afterDrag.viewHalfHeight-halfHeightBeforeDrag)<1e-9);
  await planet.mouse.wheel(0,-140);
  await expect.poll(async()=>(await snapshot()).config.view.zoom).toBeGreaterThan(1);
  const exportPath=path.join(resultDir,'export.json');await application.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},exportPath);
  await settings.getByRole('button',{name:'导出',exact:true}).click();
  await expect.poll(async()=>{try{return JSON.parse(await readFile(exportPath,'utf8')).version;}catch{return 0;}}).toBe(2);
  const exported=JSON.parse(await readFile(exportPath,'utf8'));assert.equal(exported.planets.length,9);assert.equal(exported.planets.at(-1).satellites.items.length,1);
  const importPath=path.join(resultDir,'import.json');exported.planets.at(-1).planet.spinPeriodHours=33;await writeFile(importPath,JSON.stringify(exported));
  await application.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},importPath);
  await settings.getByRole('button',{name:'导入',exact:true}).click();await expect.poll(async()=>(await snapshot()).config.planets.at(-1).planet.spinPeriodHours).toBe(33);
  await application.close();application=null;await launch();await settled(customId);assert.equal((await snapshot()).config.planets.at(-1).planet.spinPeriodHours,33);
  await settings.getByRole('tab',{name:'星球',exact:true}).click();await settings.getByRole('button',{name:'删除此自定义行星及其卫星'}).click();await settled('solar');
  assert.equal((await snapshot()).config.planets.length,8);assert.equal((await snapshot()).moons.some(m=>m.id.startsWith(customId+'/')),false);
  console.log('Custom planet lifecycle, export/import and persisted restart passed');
  await writeFile(path.join(resultDir,'verification.json'),JSON.stringify({snapshots,errors},null,2));assert.deepEqual(errors,[],'No renderer or shader errors');
  console.log('ALL SOLAR DESKTOP CHECKS PASSED',resultDir);
}catch(error){
  try{await writeFile(path.join(resultDir,'failure-snapshot.json'),JSON.stringify(await snapshot(),null,2));}catch{}
  if(application)for(const [i,page]of application.windows().entries()){try{await page.screenshot({path:path.join(resultDir,`failure-${i}.png`),omitBackground:true,timeout:5000});}catch{}}
  console.error('Solar verification failed',resultDir,errors,error);process.exitCode=1;
}finally{if(application)await application.close();}


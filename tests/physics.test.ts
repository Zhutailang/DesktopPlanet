import test from 'node:test';
import assert from 'node:assert/strict';
import { freshConfig, configSchema, patchedConfig, newMoon, newPlanet, AU_KM, JUPITER_RADIUS_KM } from '../src/config.ts';
import { freshConfig as legacyConfig } from '../src/legacy-config.ts';
import { advanceAngle, eccentricAnomaly, moonRadius, orbitPosition, solarAxis, solarPosition, Simulation, TAU } from '../src/physics.ts';
const close = (a: number, b: number, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const local = () => patchedConfig(freshConfig(), '$navigate', 'jupiter');
const jupiter = (config = local()) => config.planets.find(p => p.id === 'jupiter')!;

test('eight major planets, 21 major moons and the v2 defaults are valid', () => {
  const config = freshConfig(); assert.equal(config.planets.length, 8); assert.equal(config.planets.reduce((n,p) => n + p.satellites.items.length, 0), 21);
  assert.ok(configSchema.safeParse(config).success); assert.equal(config.navigation.systemId, 'solar');assert.equal(config.view.launchAtLogin,false);
  assert.equal(config.view.hiddenLayer,'top');assert.equal(config.view.hiddenOpacity,0.72);
  assert.equal(config.view.windowWidth,860);assert.equal(config.view.windowHeight,790);
});
test('older v2 configs gain display defaults while keeping their existing settings', () => {
  const old=structuredClone(freshConfig()) as any;
  delete old.view.bloomEnabled;delete old.view.bloomStrength;delete old.view.bloomRadius;delete old.view.launchAtLogin;delete old.view.hiddenLayer;delete old.view.hiddenOpacity;delete old.view.windowWidth;delete old.view.windowHeight;
  old.view.zoom=1.7;old.planets[4].planet.spinPeriodHours=17;
  const next=configSchema.parse(old);
  assert.equal(next.view.bloomEnabled,true);assert.equal(next.view.bloomStrength,1);assert.equal(next.view.bloomRadius,0.55);
  assert.equal(next.view.launchAtLogin,false);
  assert.equal(next.view.hiddenLayer,'top');assert.equal(next.view.hiddenOpacity,0.72);
  assert.equal(next.view.windowWidth,860);assert.equal(next.view.windowHeight,790);
  assert.equal(next.view.zoom,1.7);assert.equal(next.planets[4].planet.spinPeriodHours,17);
  assert.throws(()=>patchedConfig(next,'view.bloomStrength',3.1));assert.throws(()=>patchedConfig(next,'view.bloomRadius',-0.1));
  assert.throws(()=>patchedConfig(next,'view.hiddenOpacity',0.1));assert.throws(()=>patchedConfig(next,'view.hiddenLayer','middle'));
  assert.throws(()=>patchedConfig(next,'view.windowWidth',319));assert.throws(()=>patchedConfig(next,'view.windowHeight',240.5));
});
test('physical periods and reverse spin integrate correctly independent of frame rate', () => {
  close(advanceAngle(0, 9.925 * 3600 / 4, 9.925), Math.PI / 2); close(advanceAngle(0.4, 9.925 * 3600, 9.925), 0.4);
  close(advanceAngle(0, 3600, 4, true), 3 * Math.PI / 2);
  const config = local(), a = new Simulation(), b = new Simulation();
  for (let n=0;n<30;n++) a.step(1/30,config); for (let n=0;n<144;n++) b.step(1/144,config);
  for (const [id,p] of a.planets) { close(p.spin,b.planets.get(id)!.spin); close(p.orbit,b.planets.get(id)!.orbit); }
  for (const [id,p] of a.moons) close(p.orbit,b.moons.get(id)!.orbit);
});
test('Kepler solver and inclined periapsis/apoapsis distances', () => {
  for (const e of [0,0.1,0.5,0.85]) for(let n=0;n<100;n++) { const m=n/100*TAU,E=eccentricAnomaly(m,e); close(E-e*Math.sin(E),m); }
  const moon={...jupiter().satellites.items[0], eccentricity:0.35, inclinationDeg:43, ascendingNodeDeg:71, periapsisDeg:36};
  close(Math.hypot(...orbitPosition(moon,0,'physical')),moon.semiMajorAxisKm/JUPITER_RADIUS_KM*0.65);
  close(Math.hypot(...orbitPosition(moon,Math.PI,'physical')),moon.semiMajorAxisKm/JUPITER_RADIUS_KM*1.35);
});
test('independent planet/moon spin and orbital switches, plus global pause', () => {
  const config=local(), body=jupiter(config), sim=new Simulation(); sim.sync(config);
  body.planet.spinEnabled=false; body.orbit.orbitEnabled=false; body.satellites.items[0].spinEnabled=false; body.satellites.items[1].orbitEnabled=false;
  const before=structuredClone({planet:sim.planets.get('jupiter'), io:sim.moons.get('jupiter/io'), europa:sim.moons.get('jupiter/europa')});
  sim.step(1,config); assert.deepEqual(sim.planets.get('jupiter'),before.planet);
  close(sim.moons.get('jupiter/io')!.spin,before.io!.spin); assert.notEqual(sim.moons.get('jupiter/io')!.orbit,before.io!.orbit);
  close(sim.moons.get('jupiter/europa')!.orbit,before.europa!.orbit);
  config.simulation.paused=true; const frozen=JSON.stringify([[...sim.planets],[...sim.moons],sim.elapsedHours]); sim.step(50,config);
  assert.equal(JSON.stringify([[...sim.planets],[...sim.moons],sim.elapsedHours]),frozen);
});
test('period edits and switching systems preserve phases, even in hidden systems', () => {
  const config=local(),sim=new Simulation(); sim.step(1,config); const initial=structuredClone(sim.moons.get('jupiter/io'));
  jupiter(config).satellites.items[0].orbitPeriodHours=1; config.simulation.timeScale=6000; sim.sync(config);
  assert.deepEqual(sim.moons.get('jupiter/io'),initial);
  const next=patchedConfig(config,'$navigate','earth'); sim.sync(next); assert.deepEqual(sim.moons.get('jupiter/io'),initial);
  sim.step(1,next); assert.notEqual(sim.moons.get('jupiter/io')!.orbit,initial!.orbit);
  jupiter(next).satellites.items[0].phaseDeg=90; sim.sync(next); close(sim.moons.get('jupiter/io')!.orbit,Math.PI/2);
});
test('solar and local speeds are distinct and exact; asteroid mapping preserves radial order', () => {
  const config=freshConfig(),sim=new Simulation(); sim.step(1,config); close(sim.elapsedHours,240);
  config.navigation.systemId='earth'; sim.step(1,config); close(sim.elapsedHours,240+1/3);
  const radii=[0.387,0.723,1,1.67,2.1,3.3,4.95,9.58,19.2,30.1].map(au=>solarAxis(au*AU_KM,'presentation'));
  for(let i=1;i<radii.length;i++) assert.ok(radii[i]>radii[i-1]);
  const earth=config.planets.find(p=>p.id==='earth')!;
  close(Math.hypot(...solarPosition(earth.orbit,0,'physical')),1-earth.orbit.eccentricity);
});
test('presentation keeps Saturn moons outside its rings and preserves editable moon sizes', () => {
  const saturn=freshConfig().planets.find(p=>p.id==='saturn')!, radius=saturn.planet.radiusKm, outer=saturn.rings.innerRadius+saturn.rings.width;
  let previous=0;
  for(const moon of saturn.satellites.items){
    const near=Math.hypot(...orbitPosition(moon,0,'presentation',radius,2.5,outer));
    assert.ok(near-moonRadius(moon,radius,'presentation',2.5)>outer, `${moon.id} must clear the ring`);
    assert.ok(near>previous, `${moon.id} must retain orbital order`);previous=near;
    close(Math.hypot(...orbitPosition(moon,0,'physical',radius,2.5,outer)),moon.semiMajorAxisKm/radius*(1-moon.eccentricity));
  }
  const earth=freshConfig().planets.find(p=>p.id==='earth')!, moon=earth.satellites.items[0];
  const small=moonRadius(moon,earth.planet.radiusKm,'presentation',2.5);
  const large=moonRadius({...moon,radiusKm:moon.radiusKm*2},earth.planet.radiusKm,'presentation',2.5);
  close(large,small*2); assert.ok(large>0.42);
});
test('small moons and custom bodies are validated against their actual parent radius', () => {
  const config=local(), mars=config.planets.find(p=>p.id==='mars')!;
  assert.equal(mars.satellites.items[1].radiusKm,6.2);
  for(const parent of config.planets) { const m=newMoon(0,parent.planet.radiusKm); const next=structuredClone(config); next.planets.find(p=>p.id===parent.id)!.satellites.items.push(m); assert.ok(configSchema.safeParse(next).success); }
  const invalid=structuredClone(config); invalid.planets.find(p=>p.id==='earth')!.satellites.items[0].semiMajorAxisKm=7000; assert.equal(configSchema.safeParse(invalid).success,false);
  const custom=newPlanet(config.planets.length); config.planets.push(custom); config.navigation.selectedPlanetId=custom.id; config.navigation.systemId=custom.id;
  assert.ok(configSchema.safeParse(config).success); const sim=new Simulation();sim.sync(config);assert.ok(sim.planets.has(custom.id));
  config.planets.pop();config.navigation={systemId:'solar',selectedPlanetId:'earth'};sim.sync(config);assert.equal(sim.planets.has(custom.id),false);
});
test('v1 Jupiter data migrates without losing custom satellites or settings', () => {
  const old=legacyConfig();old.planet.spinPeriodHours=17;old.rings.color='#123abc';old.view.zoom=1.75;old.satellites.items[0].name='保留的卫星';
  const migrated=configSchema.parse(old),body=jupiter(migrated);
  assert.equal(migrated.version,2);assert.equal(migrated.navigation.systemId,'jupiter');assert.equal(body.planet.spinPeriodHours,17);
  assert.deepEqual(body.rings,old.rings);assert.equal(body.satellites.items[0].name,'保留的卫星');assert.equal(migrated.view.zoom,1.75);
  assert.equal(migrated.planets.length,8);assert.equal(migrated.simulation.overviewTimeScale,864000);
  const bad={...old,planet:{...old.planet,spinPeriodHours:0}};assert.equal(configSchema.safeParse(bad).success,false);
});
test('invalid IDs, collisions, non-finite values, stale navigation and prototype paths are rejected atomically', () => {
  const config=local(),path='planets.4.planet.spinPeriodHours';for(const value of [0,-1,NaN,Infinity])assert.throws(()=>patchedConfig(config,path,value));
  const duplicate=structuredClone(config);duplicate.planets[1].id=duplicate.planets[0].id;assert.equal(configSchema.safeParse(duplicate).success,false);
  const moonDuplicate=structuredClone(config);jupiter(moonDuplicate).satellites.items[1].id='io';assert.equal(configSchema.safeParse(moonDuplicate).success,false);
  assert.throws(()=>patchedConfig(config,'$navigate','missing'));assert.throws(()=>patchedConfig(config,'planets.0.orbit.semiMajorAxisKm',1000));
  for(const key of ['__proto__.polluted','constructor.prototype.polluted'])assert.throws(()=>patchedConfig(config,key,true));
  assert.throws(()=>patchedConfig(config,'planets.4.rings.color','red'));assert.equal(jupiter(config).rings.color,'#a3927a');
});

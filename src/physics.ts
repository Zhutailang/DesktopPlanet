import { AU_KM, JUPITER_RADIUS_KM } from './constants.ts';
import type { Config, MoonConfig, OrbitConfig } from './config.ts';
import { timeScaleFor } from './config.ts';
export const TAU = Math.PI * 2;
export const radians = (degrees: number) => degrees * Math.PI / 180;
export const wrapAngle = (angle: number) => ((angle % TAU) + TAU) % TAU;
export const smoothstep = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * x * (x * (x * 6 - 15) + 10); };
export function advanceAngle(angle: number, seconds: number, hours: number, reverse = false) {
  if (!(hours > 0) || !Number.isFinite(seconds)) return angle;
  return wrapAngle(angle + seconds / (hours * 3600) * TAU * (reverse ? -1 : 1));
}
export function eccentricAnomaly(meanAnomaly: number, eccentricity: number) {
  const m = wrapAngle(meanAnomaly); let e = eccentricity < 0.8 ? m : Math.PI;
  for (let n = 0; n < 20; n++) { const step = (e - eccentricity * Math.sin(e) - m) / (1 - eccentricity * Math.cos(e)); e -= step; if (Math.abs(step) < 1e-12) break; }
  return e;
}
export function moonRadius(moon: MoonConfig, parentRadius: number, mode: Config['view']['scaleMode'], scale: number) {
  return mode === 'physical' ? moon.radiusKm / parentRadius : Math.max(0.028, moon.radiusKm / parentRadius * scale);
}
export function displayedAxis(moon: MoonConfig, mode: Config['view']['scaleMode'], parentRadius = JUPITER_RADIUS_KM, moonScale = 8, ringOuter = 1) {
  const a = moon.semiMajorAxisKm / parentRadius;
  const outsideRings = a * (1 - moon.eccentricity) > ringOuter + moon.radiusKm / parentRadius;
  const clearance = outsideRings ? Math.max(1.15, ringOuter + 0.08) : 1.15;
  const minimum = (clearance + moonRadius(moon, parentRadius, mode, moonScale)) / (1 - moon.eccentricity);
  const compressed = a <= ringOuter ? a : ringOuter + 0.7 * Math.log1p((a - ringOuter) / 0.7);
  return mode === 'physical' ? a : Math.max(compressed, minimum);
}
export function solarAxis(km: number, mode: Config['view']['scaleMode']) {
  const au = km / AU_KM; return mode === 'physical' ? au : 1.5 + 3.25 * Math.log1p(au * 1.8);
}
export function ellipsePosition(orbit: OrbitConfig, phase: number, a: number): [number, number, number] {
  const e = eccentricAnomaly(phase, orbit.eccentricity);
  let x = a * (Math.cos(e) - orbit.eccentricity), z = -a * Math.sqrt(1 - orbit.eccentricity ** 2) * Math.sin(e);
  const peri = radians(orbit.periapsisDeg);
  [x, z] = [x * Math.cos(peri) + z * Math.sin(peri), -x * Math.sin(peri) + z * Math.cos(peri)];
  const tilt = radians(orbit.inclinationDeg), y = -z * Math.sin(tilt); z *= Math.cos(tilt);
  const node = radians(orbit.ascendingNodeDeg);
  return [x * Math.cos(node) + z * Math.sin(node), y, -x * Math.sin(node) + z * Math.cos(node)];
}
/** Apply the same monotonic radial mapping to every orbit and to the asteroid belt. */
export function solarPosition(orbit: OrbitConfig, phase: number, mode: Config['view']['scaleMode']): [number, number, number] {
  const raw = ellipsePosition(orbit, phase, orbit.semiMajorAxisKm / AU_KM);
  if (mode === 'physical') return raw;
  const radius = Math.hypot(...raw), mapped = solarAxis(radius * AU_KM, mode);
  return raw.map(v => v / radius * mapped) as [number, number, number];
}
export function orbitPosition(moon: MoonConfig, phase: number, mode: Config['view']['scaleMode'], parentRadius = JUPITER_RADIUS_KM, moonScale = 8, ringOuter = 1) {
  return ellipsePosition(moon, phase, displayedAxis(moon, mode, parentRadius, moonScale, ringOuter));
}
export type Phase = { orbit: number; spin: number; initialPhase: number };
export class Simulation {
  elapsedHours = 0;
  planets = new Map<string, Phase>(); moons = new Map<string, Phase>();
  moonKey(planetId: string, moonId: string) { return `${planetId}/${moonId}`; }
  private syncPhase(map: Map<string, Phase>, id: string, initial: number) {
    const phase = map.get(id);
    if (!phase) map.set(id, { orbit: radians(initial), spin: -2.42, initialPhase: initial });
    else if (phase.initialPhase !== initial) { phase.orbit = radians(initial); phase.initialPhase = initial; }
  }
  sync(config: Config) {
    const planets = new Set<string>(), moons = new Set<string>();
    for (const system of config.planets) {
      planets.add(system.id); this.syncPhase(this.planets, system.id, system.orbit.phaseDeg);
      for (const moon of system.satellites.items) { const id = this.moonKey(system.id, moon.id); moons.add(id); this.syncPhase(this.moons, id, moon.phaseDeg); }
    }
    for (const id of this.planets.keys()) if (!planets.has(id)) this.planets.delete(id);
    for (const id of this.moons.keys()) if (!moons.has(id)) this.moons.delete(id);
  }
  step(realSeconds: number, config: Config) {
    this.sync(config);
    if (config.simulation.paused || !Number.isFinite(realSeconds) || realSeconds <= 0) return;
    const seconds = realSeconds * timeScaleFor(config); this.elapsedHours += seconds / 3600;
    for (const system of config.planets) {
      const phase = this.planets.get(system.id)!;
      if (system.planet.spinEnabled) phase.spin = advanceAngle(phase.spin, seconds, system.planet.spinPeriodHours, system.planet.retrograde);
      if (system.orbit.orbitEnabled) phase.orbit = advanceAngle(phase.orbit, seconds, system.orbit.orbitPeriodHours, system.orbit.retrograde);
      for (const moon of system.satellites.items) {
        const p = this.moons.get(this.moonKey(system.id, moon.id))!;
        if (moon.spinEnabled) p.spin = advanceAngle(p.spin, seconds, moon.spinPeriodHours, moon.retrograde);
        if (moon.orbitEnabled) p.orbit = advanceAngle(p.orbit, seconds, moon.orbitPeriodHours, moon.retrograde);
      }
    }
  }
}

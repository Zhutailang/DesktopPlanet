import { z } from 'zod';
import { configSchema as legacySchema } from './legacy-config.ts';
import { defaultPlanets } from './catalog.ts';
import { AU_KM, SUN_RADIUS_KM } from './constants.ts';
export { AU_KM, SUN_RADIUS_KM, JUPITER_RADIUS_KM } from './constants.ts';

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const name = z.string().trim().min(1).max(32);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '请使用六位十六进制颜色');
export const surfaceSchema = z.enum(['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'moon', 'io', 'europa', 'ganymede', 'callisto', 'ice', 'titan', 'rock', 'none']);
export const orbitSchema = z.object({
  semiMajorAxisKm: num(1, AU_KM * 200), eccentricity: num(0, 0.85), inclinationDeg: num(0, 180),
  ascendingNodeDeg: num(0, 360), periapsisDeg: num(0, 360), phaseDeg: num(0, 360),
  orbitPeriodHours: num(0.01, 1e8), orbitEnabled: z.boolean(), retrograde: z.boolean(),
}).strict();
export const moonSchema = orbitSchema.extend({
  id, name, enabled: z.boolean(), radiusKm: num(0.1, 50000), color, texture: surfaceSchema,
  spinPeriodHours: num(0.01, 1e8), spinEnabled: z.boolean(), referencePlane: z.enum(['equatorial', 'ecliptic']).default('equatorial'),
}).strict();
const ringsSchema = z.object({ enabled: z.boolean(), innerRadius: num(1.01, 8), width: num(0.005, 8), color, density: num(0, 1) }).strict();
export const planetSystemSchema = z.object({
  id, name, builtin: z.boolean(), enabled: z.boolean(),
  planet: z.object({ radiusKm: num(1, 200000), color, texture: surfaceSchema, spinEnabled: z.boolean(), spinPeriodHours: num(0.01, 1e8),
    retrograde: z.boolean(), axialTiltDeg: num(-180, 180), flattening: num(0, 0.3), atmosphere: num(0, 1) }).strict(),
  orbit: orbitSchema, rings: ringsSchema,
  satellites: z.object({ enabled: z.boolean(), showOrbits: z.boolean(), items: z.array(moonSchema).max(32) }).strict(),
}).strict().superRefine((system, ctx) => {
  if (system.id === 'solar') ctx.addIssue({ code: 'custom', path: ['id'], message: 'solar 为太阳系视图保留 ID' });
  if (system.orbit.semiMajorAxisKm * (1 - system.orbit.eccentricity) <= SUN_RADIUS_KM + system.planet.radiusKm)
    ctx.addIssue({ code: 'custom', path: ['orbit', 'semiMajorAxisKm'], message: '近日点不能穿过太阳' });
  const ids = new Set<string>();
  system.satellites.items.forEach((moon, index) => {
    if (ids.has(moon.id)) ctx.addIssue({ code: 'custom', path: ['satellites', 'items', index, 'id'], message: '同一系统的卫星 ID 不能重复' });
    ids.add(moon.id);
    if (moon.semiMajorAxisKm * (1 - moon.eccentricity) <= system.planet.radiusKm + moon.radiusKm)
      ctx.addIssue({ code: 'custom', path: ['satellites', 'items', index, 'semiMajorAxisKm'], message: `近心点不能穿过${system.name}` });
  });
});
const v2Schema = z.object({
  version: z.literal(2), planets: z.array(planetSystemSchema).min(1).max(24),
  navigation: z.object({ systemId: z.string(), selectedPlanetId: id }).strict(),
  simulation: z.object({ timeScale: num(1, 1e8), overviewTimeScale: num(1, 1e8).default(864000), paused: z.boolean() }).strict(),
  solar: z.object({ showOrbits: z.boolean(), asteroidBelt: z.boolean(), asteroidCount: num(100, 6000).int() }).strict(),
  view: z.object({ scaleMode: z.enum(['presentation', 'physical']), moonScale: num(1, 8), zoom: num(0.15, 5),
    ambientLight: num(0, 0.5), sunlight: num(0.5, 5), alwaysOnTop: z.boolean(), clickThrough: z.boolean(), showHUD: z.boolean(),
    launchAtLogin: z.boolean().default(false),
    hiddenLayer: z.enum(['top', 'bottom']).default('top'), hiddenOpacity: num(0.2, 1).default(0.72),
    windowWidth: num(320, 7680).int().default(860), windowHeight: num(240, 4320).int().default(790),
    fps: z.union([z.literal(30), z.literal(60)]), transitionSeconds: num(0.35, 3).default(1.1),
    bloomEnabled: z.boolean().default(true), bloomStrength: num(0, 3).default(1), bloomRadius: num(0, 1).default(0.55) }).strict(),
}).strict().superRefine((config, ctx) => {
  const ids = new Set(config.planets.map(p => p.id));
  if (ids.size !== config.planets.length) ctx.addIssue({ code: 'custom', path: ['planets'], message: '行星 ID 不能重复' });
  if (!ids.has(config.navigation.selectedPlanetId)) ctx.addIssue({ code: 'custom', path: ['navigation'], message: '当前编辑的行星不存在' });
  if (config.navigation.systemId !== 'solar' && !ids.has(config.navigation.systemId)) ctx.addIssue({ code: 'custom', path: ['navigation'], message: '目标行星系统不存在' });
});
export type Config = z.infer<typeof v2Schema>;
export type PlanetSystem = z.infer<typeof planetSystemSchema>;
export type MoonConfig = z.infer<typeof moonSchema>;
export type OrbitConfig = z.infer<typeof orbitSchema>;
export type Surface = z.infer<typeof surfaceSchema>;
export type Result = { ok: true; config: Config } | { ok: false; error: string };
export function freshConfig(): Config {
  return { version: 2, planets: defaultPlanets(), navigation: { systemId: 'solar', selectedPlanetId: 'earth' },
    simulation: { timeScale: 1200, overviewTimeScale: 864000, paused: false }, solar: { showOrbits: true, asteroidBelt: true, asteroidCount: 2400 },
    view: { scaleMode: 'presentation', moonScale: 2.5, zoom: 1, ambientLight: 0.09, sunlight: 2.8, alwaysOnTop: true, clickThrough: true, showHUD: true, launchAtLogin: false, hiddenLayer: 'top', hiddenOpacity: 0.72, windowWidth: 860, windowHeight: 790, fps: 60, transitionSeconds: 1.1,
      bloomEnabled: true, bloomStrength: 1, bloomRadius: 0.55 } };
}
function migrate(input: unknown) {
  if (!input || typeof input !== 'object' || (input as any).version !== 1) return input;
  const parsed = legacySchema.safeParse(input); if (!parsed.success) return input;
  const old = parsed.data, next = freshConfig(), jupiter = next.planets.find(p => p.id === 'jupiter')!;
  Object.assign(jupiter.planet, old.planet); jupiter.rings = old.rings;
  jupiter.satellites = { enabled: old.satellites.enabled, showOrbits: old.satellites.showOrbits, items: old.satellites.items.map(m => ({ ...m, referencePlane: 'equatorial' as const })) };
  Object.assign(next.simulation, old.simulation); Object.assign(next.view, old.view);
  next.navigation = { systemId: 'jupiter', selectedPlanetId: 'jupiter' }; return next;
}
export const configSchema = z.preprocess(migrate, v2Schema);
export const selectedSystem = (config: Config) => config.planets.find(p => p.id === config.navigation.selectedPlanetId)!;
export const timeScaleFor = (config: Config) => config.navigation.systemId === 'solar' ? config.simulation.overviewTimeScale : config.simulation.timeScale;
export const systemLabel = (system: PlanetSystem) => system.id === 'earth' ? '地月系统' : `${system.name}系统`;
export const systemPath = (config: Config) => `planets.${config.planets.findIndex(p => p.id === config.navigation.selectedPlanetId)}`;
export function newMoon(index: number, parentRadius = 71492): MoonConfig {
  return { id: `moon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: `卫星 ${index + 1}`, enabled: true,
    radiusKm: Math.max(0.1, Math.min(1600, parentRadius * 0.08)), color: '#c7bba6', texture: 'rock', semiMajorAxisKm: parentRadius * (5 + index * 2),
    eccentricity: 0.02, inclinationDeg: 12, ascendingNodeDeg: 0, periapsisDeg: 0, phaseDeg: index * 47 % 360,
    spinPeriodHours: 120 + index * 24, orbitPeriodHours: 120 + index * 24, spinEnabled: true, orbitEnabled: true, retrograde: false, referencePlane: 'equatorial' };
}
export function newPlanet(index: number): PlanetSystem {
  const a = 2 + index * 0.8;
  return { id: `planet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: `自定义行星 ${Math.max(1, index - 7)}`, builtin: false, enabled: true,
    planet: { radiusKm: 6371, color: '#8fadc2', texture: 'rock', spinEnabled: true, spinPeriodHours: 24, retrograde: false, axialTiltDeg: 20, flattening: 0.003, atmosphere: 0.1 },
    orbit: { semiMajorAxisKm: a * AU_KM, eccentricity: 0.02, inclinationDeg: 3, ascendingNodeDeg: 0, periapsisDeg: 0, phaseDeg: index * 47 % 360, orbitPeriodHours: Math.sqrt(a ** 3) * 365.25 * 24, orbitEnabled: true, retrograde: false },
    rings: { enabled: false, innerRadius: 1.5, width: 0.6, color: '#c6b492', density: 0.5 }, satellites: { enabled: true, showOrbits: true, items: [] } };
}
export function patchedConfig(config: Config, path: string, value: unknown): Config {
  if (typeof path !== 'string' || path.length > 180) throw new Error('无效配置路径');
  if (path === '$config') return configSchema.parse(value);
  if (path === '$navigate') {
    if (typeof value !== 'string') throw new Error('无效行星系统');
    const next = structuredClone(config); next.navigation.systemId = value;
    if (value !== 'solar') next.navigation.selectedPlanetId = value;
    next.view.zoom = 1; return configSchema.parse(next);
  }
  const keys = path.split('.');
  if (keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('无效配置路径');
  const next = structuredClone(config); let node: any = next;
  for (const key of keys.slice(0, -1)) { if (!node || !Object.hasOwn(node, key)) throw new Error('配置项不存在'); node = node[key]; }
  const last = keys.at(-1)!; if (!node || !Object.hasOwn(node, last)) throw new Error('配置项不存在');
  node[last] = value; return configSchema.parse(next);
}
export function readableError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map(i => `${i.path.join('.')}：${i.message}`).slice(0, 3).join('\n');
  return error instanceof Error ? error.message : '操作失败，请重试';
}

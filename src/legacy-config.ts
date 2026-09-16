import { z } from 'zod';

export const JUPITER_RADIUS_KM = 71492;
const number = (min: number, max: number) => z.number().finite().min(min).max(max);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '请使用六位十六进制颜色');

export const moonSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().trim().min(1).max(32),
  enabled: z.boolean(),
  radiusKm: number(10, 15000),
  color,
  texture: z.enum(['io', 'europa', 'ganymede', 'callisto', 'rock', 'none']),
  semiMajorAxisKm: number(90000, 20000000),
  eccentricity: number(0, 0.85),
  inclinationDeg: number(0, 180),
  ascendingNodeDeg: number(0, 360),
  periapsisDeg: number(0, 360),
  phaseDeg: number(0, 360),
  spinPeriodHours: number(0.01, 100000),
  orbitPeriodHours: number(0.01, 100000),
  spinEnabled: z.boolean(),
  orbitEnabled: z.boolean(),
  retrograde: z.boolean(),
}).strict().refine(m => m.semiMajorAxisKm * (1 - m.eccentricity) > JUPITER_RADIUS_KM + m.radiusKm,
  { message: '近木点距离过小：卫星轨道不能穿过木星。', path: ['semiMajorAxisKm'] });

export const configSchema = z.object({
  version: z.literal(1),
  planet: z.object({
    spinEnabled: z.boolean(), spinPeriodHours: number(0.01, 100000),
    retrograde: z.boolean(), axialTiltDeg: number(-90, 90),
    flattening: number(0, 0.2), atmosphere: number(0, 1),
  }).strict(),
  simulation: z.object({ timeScale: number(1, 100000), paused: z.boolean() }).strict(),
  rings: z.object({
    enabled: z.boolean(), innerRadius: number(1.05, 5), width: number(0.01, 5),
    color, density: number(0, 1),
  }).strict(),
  satellites: z.object({
    // Retained for importing v1 files; the clean planet view no longer draws text labels.
    enabled: z.boolean(), showOrbits: z.boolean(), showLabels: z.boolean(),
    items: z.array(moonSchema).max(16).refine(ms => new Set(ms.map(m => m.id)).size === ms.length, '卫星 ID 不能重复'),
  }).strict(),
  view: z.object({
    scaleMode: z.enum(['presentation', 'physical']), moonScale: number(1, 8),
    zoom: number(0.15, 5), ambientLight: number(0, 0.5), sunlight: number(0.5, 5),
    alwaysOnTop: z.boolean(), clickThrough: z.boolean(), showHUD: z.boolean(),
    fps: z.union([z.literal(30), z.literal(60)]),
  }).strict(),
}).strict();

export type Config = z.infer<typeof configSchema>;
export type MoonConfig = z.infer<typeof moonSchema>;
export type Result = { ok: true; config: Config } | { ok: false; error: string };

function moon(id: MoonConfig['texture'], name: string, radiusKm: number, a: number, period: number, phase: number, e: number, i: number): MoonConfig {
  return { id, name, enabled: true, radiusKm, color: '#ffffff', texture: id,
    semiMajorAxisKm: a, eccentricity: e, inclinationDeg: i, ascendingNodeDeg: 0,
    periapsisDeg: 0, phaseDeg: phase, spinPeriodHours: period, orbitPeriodHours: period,
    spinEnabled: true, orbitEnabled: true, retrograde: false };
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  planet: { spinEnabled: true, spinPeriodHours: 9.925, retrograde: false, axialTiltDeg: 3.13, flattening: 0.06487, atmosphere: 0.18 },
  simulation: { timeScale: 1200, paused: false },
  rings: { enabled: true, innerRadius: 1.72, width: 0.09, color: '#a3927a', density: 0.055 },
  satellites: { enabled: true, showOrbits: true, showLabels: false, items: [
    moon('io', '木卫一 · Io', 1821.49, 421800, 42.4593, 25, 0.0041, 0.05),
    moon('europa', '木卫二 · Europa', 1560.8, 671100, 85.2283, 155, 0.0094, 0.47),
    moon('ganymede', '木卫三 · Ganymede', 2631.2, 1070400, 171.7093, 215, 0.0013, 0.2),
    moon('callisto', '木卫四 · Callisto', 2410.3, 1882700, 400.536, 325, 0.0074, 0.19),
  ] },
  view: { scaleMode: 'presentation', moonScale: 2.5, zoom: 1, ambientLight: 0.09, sunlight: 2.8, alwaysOnTop: true, clickThrough: true, showHUD: true, fps: 60 },
};

export function freshConfig(): Config { return structuredClone(DEFAULT_CONFIG); }

export function newMoon(index: number): MoonConfig {
  return { ...moon('rock', `卫星 ${index + 1}`, 1600, 800000 + index * 150000, 120 + index * 24, index * 47 % 360, 0.02, 12),
    id: `moon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, color: '#c7bba6' };
}

/** Only allow existing own properties. Both renderer and main validate all writes. */
export function patchedConfig(config: Config, path: string, value: unknown): Config {
  if (typeof path !== 'string' || path.length > 160) throw new Error('无效配置路径');
  const keys = path.split('.');
  if (keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('无效配置路径');
  const next = structuredClone(config);
  let node: any = next;
  for (const key of keys.slice(0, -1)) {
    if (!node || !Object.hasOwn(node, key)) throw new Error('配置项不存在');
    node = node[key];
  }
  const last = keys.at(-1)!;
  if (!node || !Object.hasOwn(node, last)) throw new Error('配置项不存在');
  node[last] = value;
  return configSchema.parse(next);
}

export function readableError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map(i => `${i.path.join('.')}：${i.message}`).slice(0, 3).join('\n');
  return error instanceof Error ? error.message : '操作失败，请重试';
}

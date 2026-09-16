import type { MoonConfig, PlanetSystem, Surface } from './config.ts';
import { AU_KM } from './constants.ts';
// NASA/JPL mean physical and orbital values; phases are illustrative, not ephemerides.
function moon(id: string, name: string, radius: number, axis: number, days: number, phase: number, texture: Surface = 'ice', e = 0.001, i = 0): MoonConfig {
  return { id, name, enabled: true, radiusKm: radius, color: '#ffffff', texture,
    semiMajorAxisKm: axis, eccentricity: e, inclinationDeg: i, ascendingNodeDeg: 0, periapsisDeg: 0, phaseDeg: phase,
    spinPeriodHours: days * 24, orbitPeriodHours: days * 24, spinEnabled: true, orbitEnabled: true, retrograde: false, referencePlane: 'equatorial' };
}
function planet(id: Surface, name: string, radius: number, a: number, days: number, spin: number, tilt: number, e: number, i: number, phase: number, moons: MoonConfig[] = []): PlanetSystem {
  return { id, name, builtin: true, enabled: true,
    planet: { radiusKm: radius, color: '#ffffff', texture: id, spinEnabled: true, spinPeriodHours: spin, retrograde: false, axialTiltDeg: tilt, flattening: 0, atmosphere: 0 },
    orbit: { semiMajorAxisKm: a * AU_KM, eccentricity: e, inclinationDeg: i, ascendingNodeDeg: 0, periapsisDeg: 0, phaseDeg: phase, orbitPeriodHours: days * 24, orbitEnabled: true, retrograde: false },
    rings: { enabled: false, innerRadius: 1.5, width: 0.5, color: '#bba888', density: 0.5 }, satellites: { enabled: true, showOrbits: true, items: moons } };
}
export function defaultPlanets(): PlanetSystem[] {
  const earthMoon = moon('moon', '月球 · Moon', 1737.4, 384400, 27.321661, 34, 'moon', 0.0549, 5.145);
  earthMoon.referencePlane = 'ecliptic';
  const result = [
    planet('mercury', '水星', 2439.7, 0.3871, 87.969, 1407.6, 0.034, 0.2056, 7.005, 40),
    planet('venus', '金星', 6051.8, 0.7233, 224.701, 5832.5, 177.36, 0.0068, 3.395, 180),
    planet('earth', '地球', 6378.137, 1, 365.256, 23.9345, 23.44, 0.0167, 0, 308, [earthMoon]),
    planet('mars', '火星', 3396.2, 1.5237, 686.98, 24.6229, 25.19, 0.0934, 1.85, 96, [
      moon('phobos', '火卫一 · Phobos', 11.08, 9375, 0.3187, 26, 'rock', 0.015, 1.1),
      moon('deimos', '火卫二 · Deimos', 6.2, 23458, 1.26244, 200, 'rock', 0.0003, 1.8),
    ]),
    planet('jupiter', '木星', 71492, 5.2044, 4332.59, 9.925, 3.13, 0.0489, 1.303, 230, [
      moon('io', '木卫一 · Io', 1821.49, 421800, 1.7691375, 25, 'io', 0.0041, 0.05),
      moon('europa', '木卫二 · Europa', 1560.8, 671100, 3.551179, 155, 'europa', 0.0094, 0.47),
      moon('ganymede', '木卫三 · Ganymede', 2631.2, 1070400, 7.154554, 215, 'ganymede', 0.0013, 0.2),
      moon('callisto', '木卫四 · Callisto', 2410.3, 1882700, 16.689, 325, 'callisto', 0.0074, 0.19),
    ]),
    planet('saturn', '土星', 60268, 9.5826, 10759.22, 10.656, 26.73, 0.0565, 2.485, 35, [
      moon('mimas', '土卫一 · Mimas', 198.2, 186000, 0.942422, 20, 'ice', 0.020, 1.6),
      moon('enceladus', '土卫二 · Enceladus', 252.1, 238400, 1.370218, 80, 'ice', 0.005),
      moon('tethys', '土卫三 · Tethys', 531.1, 295000, 1.887802, 145, 'ice', 0.001, 1.1),
      moon('dione', '土卫四 · Dione', 561.4, 377700, 2.736916, 195, 'ice', 0.002),
      moon('rhea', '土卫五 · Rhea', 763.5, 527200, 4.5175, 245, 'ice', 0.001, 0.3),
      moon('titan', '土卫六 · Titan', 2574.76, 1221900, 15.945421, 305, 'titan', 0.029, 0.3),
      moon('iapetus', '土卫八 · Iapetus', 734.5, 3560800, 79.330183, 355, 'callisto', 0.029, 15.47),
    ]),
    planet('uranus', '天王星', 25559, 19.2184, 30688.5, 17.24, 97.77, 0.0463, 0.773, 140, [
      moon('miranda', '天卫五 · Miranda', 235.8, 129846, 1.413479, 20, 'ice', 0.001, 4.4),
      moon('ariel', '天卫一 · Ariel', 578.9, 190929, 2.520379, 95, 'ice', 0.001, 0.1),
      moon('umbriel', '天卫二 · Umbriel', 584.7, 265986, 4.144177, 170, 'callisto', 0.004, 0.1),
      moon('titania', '天卫三 · Titania', 788.9, 436298, 8.705869, 245, 'ice', 0.002, 0.1),
      moon('oberon', '天卫四 · Oberon', 761.4, 583511, 13.463237, 320, 'callisto', 0.002, 0.1),
    ]),
    planet('neptune', '海王星', 24764, 30.11, 60182, 16.11, 28.32, 0.0095, 1.77, 300, [
      moon('triton', '海卫一 · Triton', 1353.4, 354800, 5.876994, 30, 'ice', 0.000016, 157.3),
      moon('nereid', '海卫二 · Nereid', 170, 5513400, 360.1362, 205, 'rock', 0.7507, 7.2),
    ]),
  ];
  const find = (id: string) => result.find(p => p.id === id)!;
  Object.assign(find('earth').planet, { flattening: 0.00335, atmosphere: 0.45 });
  Object.assign(find('mars').planet, { flattening: 0.00589, atmosphere: 0.045 });
  Object.assign(find('venus').planet, { atmosphere: 0.15 });
  Object.assign(find('jupiter').planet, { flattening: 0.06487, atmosphere: 0.18 });
  Object.assign(find('saturn').planet, { flattening: 0.09796, atmosphere: 0.12 });
  Object.assign(find('uranus').planet, { flattening: 0.02293, atmosphere: 0.22 });
  Object.assign(find('neptune').planet, { flattening: 0.01708, atmosphere: 0.24 });
  find('jupiter').rings = { enabled: true, innerRadius: 1.72, width: 0.09, color: '#a3927a', density: 0.055 };
  find('saturn').rings = { enabled: true, innerRadius: 1.24, width: 1.03, color: '#d1c0a0', density: 0.88 };
  find('uranus').rings = { enabled: true, innerRadius: 1.64, width: 0.38, color: '#847e72', density: 0.14 };
  find('neptune').rings = { enabled: true, innerRadius: 1.69, width: 0.85, color: '#7b766b', density: 0.06 };
  return result;
}

import * as THREE from 'three';
import type { Config, PlanetSystem, MoonConfig } from './config.ts';
import { AU_KM, SUN_RADIUS_KM } from './constants.ts';
import { Simulation, TAU, radians, orbitPosition, moonRadius, solarAxis, solarPosition } from './physics.ts';
import { createAtmosphereMaterial, createRingMaterial, moonTexture } from './materials.ts';

const sphere = new THREE.SphereGeometry(1, 96, 64);
const smallSphere = new THREE.SphereGeometry(1, 36, 24);
const textures = new Map<string, THREE.Texture>();
export async function loadTextures(renderer: THREE.WebGLRenderer) {
  const names = ['sun', 'mercury', 'venus', 'earth', 'earth-clouds', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'moon'];
  await Promise.all(names.map(async name => {
    const texture = await new THREE.TextureLoader().loadAsync(`./textures/${name}.jpg`);
    texture.colorSpace = name === 'earth-clouds' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    textures.set(name, texture); renderer.initTexture(texture);
  }));
  for (const name of ['io', 'europa', 'ganymede', 'callisto', 'ice', 'titan', 'rock']) moonTexture(name);
}
function bodyMaterial(kind: string, color: string) {
  const map = textures.get(kind) || moonTexture(kind);
  // A faint textured emission lifts night-side detail without flattening the sunlight.
  const material = new THREE.MeshStandardMaterial({
    map, color, roughness: kind === 'earth' ? 0.72 : 1, metalness: 0,
    emissive: color, emissiveMap: map, emissiveIntensity: 0.08,
  });
  if (kind === 'jupiter') material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        diffuseColor *= texture2D(map, vec2(vMapUv.x, clamp(vMapUv.y, 0.061, 0.939)));
      #endif`).replace('#include <emissivemap_fragment>', `
      #ifdef USE_EMISSIVEMAP
        totalEmissiveRadiance *= texture2D(emissiveMap, vec2(vEmissiveMapUv.x, clamp(vEmissiveMapUv.y, 0.061, 0.939))).rgb;
      #endif`);
  };
  return material;
}
type Body = { root: THREE.Group; axis: THREE.Group; mesh: THREE.Mesh; system: PlanetSystem; ring?: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>; air?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>; clouds?: THREE.Mesh; };
type Moon = { mesh: THREE.Mesh; params: MoonConfig; system: PlanetSystem };
export class SceneView {
  readonly scene = new THREE.Scene();
  readonly inspection = new THREE.Group();
  readonly camera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.01, 100000);
  readonly bodies = new Map<string, Body>();
  readonly moons: Moon[] = [];
  readonly hits: THREE.Object3D[] = [];
  readonly ownedGeometry: THREE.BufferGeometry[] = [];
  readonly ownedMaterials: THREE.Material[] = [];
  readonly orbitObjects: THREE.LineLoop[] = [];
  private ambient = new THREE.AmbientLight('#c4d1dc', 0.09);
  private sun = new THREE.DirectionalLight('#fff7e7', 2.8);
  private solarLight = new THREE.PointLight('#fff5dd', 2.8, 0, 0);
  private belt?: THREE.Points;
  private star?: THREE.Mesh;
  private signature = '';
  private bounds = new THREE.Box3();
  readonly sunDirection = new THREE.Vector3(-5, 4, 8).normalize();
  halfHeight = 4;
  sceneCenter = { x: 0, y: 0 };
  constructor(readonly id: string, config: Config) {
    this.inspection.quaternion.setFromEuler(new THREE.Euler(id === 'solar' ? 0.60 : 0.36, 0, -0.025));
    this.scene.add(this.inspection, this.ambient);
    this.camera.position.z = 1000;
    if (id === 'solar') this.scene.add(this.solarLight);
    else {
      this.sun.position.copy(this.sunDirection).multiplyScalar(10); this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024); Object.assign(this.sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.1, far: 40 });
      this.sun.shadow.bias = -0.0001; this.sun.shadow.normalBias = 0.008;
      this.scene.add(this.sun, this.sun.target);
    }
    this.configure(config);
  }
  private material<T extends THREE.Material>(material: T): T { this.ownedMaterials.push(material); return material; }
  private geometry<T extends THREE.BufferGeometry>(geometry: T): T { this.ownedGeometry.push(geometry); return geometry; }
  private line(points: THREE.Vector3[], color = '#8eafa0', opacity = 0.16) {
    const line = new THREE.LineLoop(this.geometry(new THREE.BufferGeometry().setFromPoints(points)), this.material(new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
    this.orbitObjects.push(line); return line;
  }
  private addBody(system: PlanetSystem, radius: number, full: boolean) {
    const root = new THREE.Group(), axis = new THREE.Group(); root.add(axis); this.inspection.add(root); root.scale.setScalar(radius);
    axis.rotation.z = radians(system.planet.axialTiltDeg);
    const mesh = new THREE.Mesh(sphere, this.material(bodyMaterial(system.planet.texture, system.planet.color)));
    mesh.scale.y = 1 - system.planet.flattening; mesh.castShadow = full; mesh.receiveShadow = full;
    mesh.userData.systemId = system.id; axis.add(mesh); this.hits.push(mesh);
    const body: Body = { root, axis, mesh, system }; this.bodies.set(system.id, body);
    if (system.planet.texture === 'earth') {
      const clouds = new THREE.Mesh(sphere, this.material(new THREE.MeshStandardMaterial({ color: '#ffffff', alphaMap: textures.get('earth-clouds'), transparent: true, opacity: 0.72, depthWrite: false, roughness: 1 })));
      clouds.scale.set(1.007, (1 - system.planet.flattening) * 1.007, 1.007); axis.add(clouds); body.clouds = clouds;
    }
    if (system.rings.enabled && system.rings.density > 0) {
      const ring = new THREE.Mesh(this.geometry(new THREE.RingGeometry(system.rings.innerRadius, system.rings.innerRadius + system.rings.width, 256)), this.material(createRingMaterial()));
      const u = ring.material.uniforms; u.uInner.value = system.rings.innerRadius; u.uWidth.value = system.rings.width; u.uDensity.value = system.rings.density;
      u.uColor.value.set(system.rings.color); u.uPolar.value = 1 - system.planet.flattening;
      ring.rotation.x = -Math.PI / 2; axis.add(ring); body.ring = ring;
      ring.userData.systemId = system.id; if (system.rings.density > 0.12) this.hits.push(ring);
    }
    if (full && system.planet.atmosphere > 0) {
      const air = new THREE.Mesh(sphere, this.material(createAtmosphereMaterial()));
      air.scale.set(1.013, (1 - system.planet.flattening) * 1.013, 1.013); air.material.uniforms.uStrength.value = system.planet.atmosphere;
      axis.add(air); body.air = air;
    }
    return body;
  }
  configure(config: Config) {
    this.ambient.intensity = config.view.ambientLight; this.sun.intensity = config.view.sunlight; this.solarLight.intensity = config.view.sunlight;
    const system = config.planets.find(p => p.id === this.id);
    if (this.id !== 'solar' && !system) return;
    const signature = JSON.stringify([this.id === 'solar' ? config.planets.map(p => ({ ...p, satellites: undefined })) : system, config.solar, config.view.scaleMode, config.view.moonScale]);
    if (signature === this.signature) return;
    this.signature = signature; this.clear();
    if (this.id === 'solar') {
      const sunRadius = config.view.scaleMode === 'physical' ? SUN_RADIUS_KM / AU_KM : 0.70;
      this.star = new THREE.Mesh(sphere, this.material(new THREE.MeshBasicMaterial({ map: textures.get('sun'), color: '#fff0d8' })));
      this.star.scale.setScalar(sunRadius); this.inspection.add(this.star); this.hits.push(this.star);
      for (const p of config.planets.filter(p => p.enabled)) {
        const radius = config.view.scaleMode === 'physical' ? p.planet.radiusKm / AU_KM : 0.105 + 0.31 * Math.sqrt(p.planet.radiusKm / 71492);
        this.addBody(p, radius, false);
        const line = this.line(Array.from({ length: 256 }, (_, i) => new THREE.Vector3(...solarPosition(p.orbit, i / 256 * TAU, config.view.scaleMode))), '#96afa0', 0.20);
        line.visible = config.solar.showOrbits; this.inspection.add(line);
      }
      if (config.solar.asteroidBelt) {
        const points = new Float32Array(config.solar.asteroidCount * 3);
        let seed = 17021; const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
        for (let i = 0; i < config.solar.asteroidCount; i++) {
          const radius = solarAxis((2.1 + random() * 1.2) * AU_KM, config.view.scaleMode), angle = random() * TAU;
          points.set([Math.cos(angle) * radius, (random() - 0.5) * radius * 0.045, -Math.sin(angle) * radius], i * 3);
        }
        const geometry = this.geometry(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
        this.belt = new THREE.Points(geometry, this.material(new THREE.PointsMaterial({ color: '#ae9a75', size: 1.25, sizeAttenuation: false, transparent: true, opacity: 0.48, depthWrite: false })));
        this.inspection.add(this.belt);
      }
    } else if (system) {
      const body = this.addBody(system, 1, true);
      for (const moon of system.satellites.items.filter(m => system.satellites.enabled && m.enabled)) {
        const reference = moon.referencePlane === 'ecliptic' ? this.inspection : body.axis;
        const mesh = new THREE.Mesh(smallSphere, this.material(bodyMaterial(moon.texture, moon.color)));
        const radius = moonRadius(moon, system.planet.radiusKm, config.view.scaleMode, config.view.moonScale);
        mesh.scale.setScalar(radius);
        if (['phobos', 'deimos'].includes(moon.id)) mesh.scale.multiply(new THREE.Vector3(1.2, 0.87, 0.95));
        mesh.castShadow = true; mesh.receiveShadow = true; reference.add(mesh); this.hits.push(mesh); this.moons.push({ mesh, params: moon, system });
        const outer = system.rings.enabled ? system.rings.innerRadius + system.rings.width : 1;
        const orbit = this.line(Array.from({ length: 256 }, (_, i) => new THREE.Vector3(...orbitPosition(moon, i / 256 * TAU, config.view.scaleMode, system.planet.radiusKm, config.view.moonScale, outer))));
        orbit.visible = system.satellites.showOrbits; reference.add(orbit);
      }
    }
  }
  update(config: Config, simulation: Simulation) {
    for (const [id, body] of this.bodies) {
      const phase = simulation.planets.get(id);
      if (!phase) continue;
      body.mesh.rotation.y = phase.spin;
      if (body.clouds) body.clouds.rotation.y = body.mesh.rotation.y + simulation.elapsedHours * 0.0002;
      if (this.id === 'solar') body.root.position.set(...solarPosition(body.system.orbit, phase?.orbit || 0, config.view.scaleMode));
    }
    for (const entry of this.moons) {
      const phase = simulation.moons.get(simulation.moonKey(entry.system.id, entry.params.id));
      if (!phase) continue;
      const outer = entry.system.rings.enabled ? entry.system.rings.innerRadius + entry.system.rings.width : 1;
      entry.mesh.position.set(...orbitPosition(entry.params, phase.orbit, config.view.scaleMode, entry.system.planet.radiusKm, config.view.moonScale, outer));
      entry.mesh.rotation.set(radians(entry.params.inclinationDeg), phase?.spin || 0, 0);
    }
    if (this.star) this.star.rotation.y = simulation.elapsedHours / 648 * TAU;
    if (this.belt) this.belt.rotation.y = simulation.elapsedHours / (4.7 * 365.25 * 24) * TAU;
    this.scene.updateMatrixWorld(true);
    for (const body of this.bodies.values()) {
      const direction = this.id === 'solar' ? body.root.getWorldPosition(new THREE.Vector3()).negate().normalize() : this.sunDirection;
      if (body.ring) body.ring.material.uniforms.uSun.value.copy(direction).applyQuaternion(body.ring.getWorldQuaternion(new THREE.Quaternion()).invert());
      if (body.air) body.air.material.uniforms.uSun.value.copy(direction).transformDirection(this.camera.matrixWorldInverse);
    }
  }
  frameCamera(width: number, height: number, reserved: number, zoom: number, flight = 1, focus = new THREE.Vector3()) {
    const usable = Math.max(height * 0.4, height - reserved), aspect = width / usable;
    // Measure the system in its canonical pose. Using the rotated inspection group
    // here makes an orthographic camera breathe in and out while the user drags.
    const orientation = this.inspection.quaternion.clone();
    this.inspection.quaternion.identity();
    this.bounds.setFromObject(this.inspection);
    this.inspection.quaternion.copy(orientation);
    this.inspection.updateWorldMatrix(true, true);
    const maxX = Math.max(Math.abs(this.bounds.min.x), Math.abs(this.bounds.max.x));
    const maxY = Math.max(Math.abs(this.bounds.min.y), Math.abs(this.bounds.max.y));
    this.halfHeight = Math.max(1.35, maxX * 1.08 / aspect, maxY * 1.08) / zoom * height / usable * flight;
    const offset = (height - usable) / height * this.halfHeight;
    this.camera.left = -this.halfHeight * width / height + focus.x; this.camera.right = this.halfHeight * width / height + focus.x;
    this.camera.top = this.halfHeight - offset + focus.y; this.camera.bottom = -this.halfHeight - offset + focus.y;
    this.camera.position.z = Math.max(1000, this.bounds.max.z + 1000); this.camera.far = this.camera.position.z - this.bounds.min.z + 1000;
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(); this.sceneCenter = { x: width / 2, y: usable / 2 };
  }
  clear() {
    this.inspection.clear(); this.bodies.clear(); this.moons.length = 0; this.hits.length = 0; this.orbitObjects.length = 0;
    this.ownedMaterials.forEach(m => m.dispose()); this.ownedGeometry.forEach(g => g.dispose()); this.ownedMaterials.length = 0; this.ownedGeometry.length = 0;
    this.belt = undefined; this.star = undefined;
  }
  dispose() { this.clear(); this.sun.shadow.map?.dispose(); }
}

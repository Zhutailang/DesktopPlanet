import * as THREE from 'three';

// Small, deterministic procedural maps. These are visual approximations, not NASA moon maps.
function hash(x: number, y: number, z: number) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const u = smooth(x - ix), v = smooth(y - iy), w = smooth(z - iz);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const a = mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), u);
  const b = mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u);
  const c = mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u);
  const d = mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u);
  return mix(mix(a, b, v), mix(c, d, v), w);
}
const moonTextureCache = new Map<string, THREE.CanvasTexture>();
export function moonTexture(kind: string): THREE.CanvasTexture | null {
  if (kind === 'none') return null;
  if (moonTextureCache.has(kind)) return moonTextureCache.get(kind)!;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const pixels = context.createImageData(canvas.width, canvas.height);
  const palette: Record<string, [number[], number[]]> = {
    ice: [[123, 130, 135], [226, 232, 230]], titan: [[131, 77, 21], [220, 170, 82]],
    io: [[104, 68, 27], [239, 218, 129]], europa: [[113, 84, 62], [223, 212, 185]],
    ganymede: [[62, 58, 52], [177, 171, 154]], callisto: [[36, 33, 30], [137, 132, 120]], rock: [[68, 65, 60], [186, 180, 164]],
  };
  const [dark, light] = palette[kind] || palette.rock;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 512; x++) {
    const lat = y / 256 * Math.PI, lon = x / 512 * Math.PI * 2;
    const sx = Math.sin(lat) * Math.cos(lon), sy = Math.cos(lat), sz = Math.sin(lat) * Math.sin(lon);
    let value = 0, scale = 4, weight = 0.52;
    for (let octave = 0; octave < 5; octave++) { value += noise(sx * scale + 9, sy * scale + 7, sz * scale + 3) * weight; scale *= 2.1; weight *= 0.5; }
    let t = Math.min(1, Math.max(0, (value - 0.23) * 2.4));
    if (kind === 'europa') {
      const cracks = Math.abs(Math.sin(sx * 30 + sy * 18 + noise(sx * 7, sy * 7, sz * 7) * 16));
      t = cracks < 0.055 ? 0.3 : 0.78 + t * 0.22;
    }
    if (kind === 'io') t = Math.pow(t, 0.7);
    const idx = (y * 512 + x) * 4;
    for (let c = 0; c < 3; c++) pixels.data[idx + c] = dark[c] + (light[c] - dark[c]) * t;
    pixels.data[idx + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  // Crater ejecta on the rock and ice moons, kept subtle at desktop size.
  if (kind !== 'europa' && kind !== 'io') for (let i = 0; i < 210; i++) {
    const x = hash(i, 3, 7) * 512, y = 18 + hash(i, 7, 9) * 220, r = 0.45 + hash(i, 9, 4) ** 3 * 3.5;
    context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2);
    context.strokeStyle = kind === 'callisto' ? 'rgba(240,232,218,.42)' : 'rgba(233,225,202,.25)'; context.lineWidth = 0.7; context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping;
  moonTextureCache.set(kind, texture); return texture;
}

export function createRingMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color('#b5a086') }, uDensity: { value: 0.1 },
      uInner: { value: 1.72 }, uWidth: { value: 0.09 }, uPolar: { value: 0.93513 },
      uSun: { value: new THREE.Vector3(-0.5, 0.5, 1).normalize() },
    },
    vertexShader: `varying vec3 vLocal;
      void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uSun;
      uniform float uDensity; uniform float uInner; uniform float uWidth; uniform float uPolar;
      varying vec3 vLocal;
      float band(float t, float frequency) {
        return sin(t*frequency) * clamp(1.0-fwidth(t)*frequency/3.14159,0.0,1.0);
      }
      void main() {
        float r = length(vLocal.xy);
        float t = clamp((r-uInner)/uWidth, 0.0, 1.0);
        float bands = .60 + .13*band(t,29.0) + .12*band(t,149.0) + .08*band(t,487.0) + .04*band(t,1237.0);
        float gap = 1.0 - .88 * exp(-pow((t-.68)*55.0, 2.0));
        float edge = smoothstep(0.0,.025,t) * (1.0-smoothstep(.97,1.0,t));
        // The ring's local z is the polar axis; analytic planet shadow.
        vec3 p = vec3(vLocal.xy, vLocal.z/uPolar);
        vec3 d = vec3(uSun.xy, uSun.z/uPolar);
        float along = max(0.0,-dot(p,d)/dot(d,d));
        float clearance = length(p + along*d);
        float lit = smoothstep(.98,1.025,clearance);
        float opacity = uDensity * bands * gap * edge;
        if (opacity < .001) discard;
        gl_FragColor = vec4(uColor * (.60+.40*bands) * (.06 + .94*lit), opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function createAtmosphereMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide,
    uniforms: { uStrength: { value: 0.18 }, uSun: { value: new THREE.Vector3() } },
    vertexShader: `varying vec3 vNormal; varying vec3 vPosition;
      void main() { vec4 pos = modelViewMatrix * vec4(position,1.0); vPosition=pos.xyz; vNormal=normalize(normalMatrix*normal); gl_Position=projectionMatrix*pos; }`,
    fragmentShader: `uniform float uStrength; uniform vec3 uSun; varying vec3 vNormal; varying vec3 vPosition;
      void main() {
        vec3 n=normalize(vNormal); vec3 v=normalize(-vPosition);
        float rim = pow(1.0-abs(dot(n,v)), 5.0);
        float day = .1 + .9*max(dot(n,normalize(uSun)),0.0);
        gl_FragColor=vec4(vec3(.69,.78,.83),rim * uStrength * day * .65);
        #include <colorspace_fragment>
      }`,
  });
}

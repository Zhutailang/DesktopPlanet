import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { Config } from './config.ts';

/** HDR bloom with an explicit alpha compositor for a transparent desktop window. */
export class DesktopBloom {
  private readonly mixed = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private readonly bloom = new UnrealBloomPass(new THREE.Vector2(64, 64), 1, 0.55, 0.18);
  private readonly quad = new FullScreenQuad();
  private readonly mix = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    uniforms: { uFrom: { value: null }, uTo: { value: null }, uMix: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `varying vec2 vUv; uniform sampler2D uFrom; uniform sampler2D uTo; uniform float uMix;
      void main(){ gl_FragColor=mix(texture2D(uFrom,vUv),texture2D(uTo,vUv),uMix); }`,
  });
  private readonly output = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: { uScene: { value: null }, uBloom: { value: null }, uEnabled: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `varying vec2 vUv; uniform sampler2D uScene; uniform sampler2D uBloom; uniform float uEnabled;
      vec3 displayColor(vec3 light){
        #ifdef TONE_MAPPING
          light=toneMapping(light);
        #endif
        return linearToOutputTexel(vec4(light,1.0)).rgb;
      }
      void main(){
        vec4 scene=texture2D(uScene,vUv);
        vec3 glow=max(texture2D(uBloom,vUv).rgb,vec3(0.0))*uEnabled;
        vec3 surface=scene.a>0.00001?scene.rgb/scene.a:vec3(0.0);
        // Keep surface detail while the light spreads outside the silhouette.
        vec3 bodyColor=displayColor(surface+glow*0.18);
        vec3 haloColor=displayColor(glow);
        float haloAlpha=clamp(max(haloColor.r,max(haloColor.g,haloColor.b)),0.0,1.0);
        float falloff=smoothstep(0.015,0.065,haloAlpha);
        haloColor*=falloff; haloAlpha*=falloff;
        float alpha=scene.a+(1.0-scene.a)*haloAlpha;
        // Premultiplied output lets the halo blend into any desktop background.
        gl_FragColor=vec4(bodyColor*scene.a+haloColor*(1.0-scene.a),alpha);
      }`,
  });

  constructor() {
    // UnrealBloomPass normally adds bloom into its source, including its alpha.
    // Retain that source unchanged; our final pass composites the glow with coverage.
    this.bloom.blendMaterial.colorWrite = false;
    this.output.uniforms.uBloom.value = this.bloom.renderTargetsHorizontal[0].texture;
    this.bloom.materialHighPassFilter.uniforms.smoothWidth.value = 0.12;
    // The broadest mips add a soft fringe, rather than a veil across the whole desktop.
    [1, 0.75, 0.4, 0.12, 0.035].forEach((weight, i) => this.bloom.bloomTintColors[i].setScalar(weight));
  }

  setSize(width: number, height: number) {
    this.mixed.setSize(width, height);
    // Cap the blur buffers for large displays; the detailed scene stays full resolution.
    const scale = Math.min(1, 1600 / Math.max(width, height));
    this.bloom.setSize(Math.max(64, Math.round(width * scale)), Math.max(64, Math.round(height * scale)));
  }

  render(renderer: THREE.WebGLRenderer, from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget | null, amount: number, view: Config['view']) {
    let source = from;
    if (to) {
      this.mix.uniforms.uFrom.value = from.texture; this.mix.uniforms.uTo.value = to.texture; this.mix.uniforms.uMix.value = amount;
      renderer.setRenderTarget(this.mixed); this.quad.material = this.mix; this.quad.render(renderer); source = this.mixed;
    }
    const enabled = view.bloomEnabled && view.bloomStrength > 0;
    if (enabled) {
      this.bloom.strength = view.bloomStrength; this.bloom.radius = view.bloomRadius;
      this.bloom.render(renderer, source, source, 0, false);
    }
    this.output.uniforms.uScene.value = source.texture; this.output.uniforms.uEnabled.value = enabled ? 1 : 0;
    renderer.setRenderTarget(null); this.quad.material = this.output; this.quad.render(renderer);
  }

  dispose() {
    this.bloom.dispose(); this.mixed.dispose(); this.mix.dispose(); this.output.dispose(); this.quad.dispose();
  }
}

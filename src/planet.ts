import * as THREE from 'three';
import { api, desktop } from './bridge.ts';
import type { WindowState } from './bridge.ts';
import type { Config } from './config.ts';
import { systemLabel, timeScaleFor } from './config.ts';
import { Simulation, smoothstep } from './physics.ts';
import { SceneView, loadTextures } from './scene-view.ts';
import { DesktopBloom } from './bloom.ts';
import { icon, escapeHTML } from './icons.ts';
import './style.css';
import './widget.css';

const app = document.querySelector<HTMLElement>('#app')!;
if (!desktop) document.body.classList.add('browser-preview');
app.innerHTML = `
  <div id="viewport" aria-label="可拖动旋转的太阳系与行星系统"></div>
  <section class="planet-dock interactive hud" aria-label="星系控制台">
    <div class="system-switcher"><button id="solar-overview" title="返回太阳系总览" aria-label="返回太阳系">${icon('sun', 16)}<span>太阳系</span></button><select id="system-select" aria-label="切换行星系统"><option value="solar">太阳系总览</option></select></div>
    <nav class="dock-bar" aria-label="星球操作">
      <button id="move-widget" class="dock-brand" title="拖动移动窗口" aria-label="移动窗口"><span class="live-dot"></span><span><b>JOVIAN</b><small id="body-name">太阳系观测</small></span></button>
      <span class="dock-divider" aria-hidden="true"></span>
      <button id="toggle-pause" class="icon-button" title="暂停时间 · 空格" aria-label="暂停时间">${icon('pause')}</button>
      <button id="reset-view" class="icon-button" title="重置视角 · R" aria-label="重置视角">${icon('reset')}</button>
      <button id="fill-screen" class="icon-button dock-fill" title="铺满当前屏幕 · F11" aria-label="铺满当前屏幕" aria-pressed="false">${icon('expand')}<span>铺满屏幕</span></button>
      <button id="toolbar-settings" class="icon-button" title="观测设置 · S" aria-label="打开观测设置">${icon('sliders')}</button>
    </nav>
    <div class="dock-status"><span id="scale-caption">距离压缩 · 星体放大</span><span id="time-caption">正在准备…</span></div>
    <div id="loading" class="dock-message"><span class="spinner"></span>正在展开太阳系…</div>
    <div id="notice" class="dock-message" role="status" hidden></div>
  </section>`;
let noticeTimer: ReturnType<typeof setTimeout>;
function notice(message: string) {
  const el = document.querySelector<HTMLElement>('#notice')!; el.textContent = message; el.hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { el.hidden = true; }, 4500);
}
let windowState: WindowState = { filled: false };
function applyWindowState(state: WindowState) {
  windowState = state;
  const button = document.querySelector<HTMLButtonElement>('#fill-screen')!;
  button.innerHTML = `${icon(state.filled ? 'restore' : 'expand')}<span>${state.filled ? '还原窗口' : '铺满屏幕'}</span>`;
  button.setAttribute('aria-label', state.filled ? '还原窗口' : '铺满当前屏幕'); button.setAttribute('aria-pressed', `${state.filled}`);
  button.title = state.filled ? '还原窗口 · F11 / Esc' : '铺满当前屏幕 · F11';
  document.querySelector<HTMLButtonElement>('#move-widget')!.disabled = state.filled;
}
api.onWindowState(applyWindowState); void api.getWindowState().then(applyWindowState);
document.querySelector('#fill-screen')!.addEventListener('click', () => { void api.toggleFillScreen().then(applyWindowState).catch(error => notice(error.message)); });
document.querySelector('#toolbar-settings')!.addEventListener('click', () => api.openSettings());

async function init() {
  let config = await api.getConfig();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.id = 'planet-canvas'; document.querySelector('#viewport')!.append(renderer.domElement);
  const dock = document.querySelector<HTMLElement>('.planet-dock')!;
  const simulation = new Simulation(); simulation.sync(config);
  const views = new Map<string, SceneView>();
  let active: SceneView;
  let transition: { from: SceneView; to: SceneView; fromZoom: number; duration: number; outFocus: THREE.Vector3; inFocus: THREE.Vector3 } | null = null;
  let displayedZoom = config.view.zoom;
  let ready = false, reserved = 100, progress = 1;
  let dragging = false, moving = false, spinSpeed = 0, lastMoveTime = 0, lastHitIgnore = false;
  let cursor = { x: -100, y: -100 };
  const spinAxis = new THREE.Vector3(0, 1, 0), previousBall = new THREE.Vector3(), deltaQ = new THREE.Quaternion();
  const raycaster = new THREE.Raycaster();
  const targetOptions = { type: THREE.HalfFloatType, samples: Math.min(4, renderer.capabilities.maxSamples) };
  const targets = [new THREE.WebGLRenderTarget(1, 1, targetOptions), new THREE.WebGLRenderTarget(1, 1, targetOptions)];
  const post = new DesktopBloom();
  function resize() {
    reserved = dock.hidden ? 0 : innerHeight - dock.getBoundingClientRect().top + 10;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2()); targets.forEach(t => t.setSize(size.x, size.y));
    post.setSize(size.x, size.y);
  }
  function refreshUI() {
    const select = document.querySelector<HTMLSelectElement>('#system-select')!;
    const options = `<option value="solar">太阳系总览</option>` + config.planets.map(p => `<option value="${p.id}">${escapeHTML(systemLabel(p))}</option>`).join('');
    if (select.innerHTML !== options) select.innerHTML = options;
    select.value = config.navigation.systemId;
    const planet = config.planets.find(p => p.id === config.navigation.systemId);
    document.querySelector('#body-name')!.textContent = planet ? systemLabel(planet) : '太阳系观测';
    document.querySelector<HTMLButtonElement>('#solar-overview')!.disabled = config.navigation.systemId === 'solar';
    document.querySelector('#scale-caption')!.textContent = config.view.scaleMode === 'physical' ? '真实大小与距离' : config.navigation.systemId === 'solar' ? '距离压缩 · 星体放大' : '距离压缩 · 卫星放大';
    document.querySelector('#time-caption')!.textContent = config.simulation.paused ? '时间已暂停' : `时间 × ${timeScaleFor(config).toLocaleString('en-US')}`;
    const pause = document.querySelector<HTMLButtonElement>('#toggle-pause')!;
    pause.innerHTML = icon(config.simulation.paused ? 'play' : 'pause'); pause.setAttribute('aria-label', config.simulation.paused ? '继续时间' : '暂停时间');
    pause.title = config.simulation.paused ? '继续时间 · 空格' : '暂停时间 · 空格';
    document.querySelector('.live-dot')!.classList.toggle('paused', config.simulation.paused); dock.hidden = !config.view.showHUD;
  }
  const patch = async (path: string, value: unknown) => { const result = await api.patch(path, value); if (!result.ok) notice(result.error); };
  const navigate = (id: string) => { endPointer(); void patch('$navigate', id); };
  document.querySelector('#system-select')!.addEventListener('change', event => navigate((event.target as HTMLSelectElement).value));
  document.querySelector('#solar-overview')!.addEventListener('click', () => navigate('solar'));
  const getView = (id: string) => {
    if (!views.has(id)) views.set(id, new SceneView(id, config));
    return views.get(id)!;
  };
  function startTransition(id: string, now: number) {
    if (transition || active.id === id) return;
    const to = getView(id); to.configure(config); to.update(config, simulation);
    const outFocus = active.id === 'solar' ? active.bodies.get(id)?.root.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3() : new THREE.Vector3();
    const inFocus = to.id === 'solar' ? to.bodies.get(active.id)?.root.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3() : new THREE.Vector3();
    transition = { from: active, to, fromZoom: displayedZoom, duration: config.view.transitionSeconds, outFocus, inFocus }; progress = 0; spinSpeed = 0;
  }
  function applyConfig(next: Config) {
    config = next; simulation.sync(config); refreshUI();
    if (ready) { views.forEach(view => view.configure(config)); startTransition(config.navigation.systemId, performance.now()); }
  }
  function bodyAt(x: number, y: number) {
    if (!active) return undefined;
    for (const view of transition ? [transition.to, transition.from] : [active]) {
      raycaster.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, 1 - y / innerHeight * 2), view.camera);
      const hit = raycaster.intersectObjects(view.hits, false)[0]; if (hit) return hit;
    }
    return undefined;
  }
  function updateHitTest() {
    if (dragging || moving || !ready) return;
    const inside = cursor.x >= 0 && cursor.y >= 0 && cursor.x < innerWidth && cursor.y < innerHeight;
    const ui = inside && !!document.elementFromPoint(cursor.x, cursor.y)?.closest('.interactive');
    const body = inside && !!bodyAt(cursor.x, cursor.y), ignore = !ui && !body;
    if (ignore !== lastHitIgnore) { lastHitIgnore = ignore; api.setHitTest(ignore); }
    renderer.domElement.style.cursor = body ? 'grab' : 'default';
  }
  api.onCursor(point => { cursor = point; updateHitTest(); });
  function ballPoint(x: number, y: number) {
    const r = innerHeight / (active.halfHeight * 2), v = new THREE.Vector3((x - active.sceneCenter.x) / r, (active.sceneCenter.y - y) / r, 0);
    const length = v.x * v.x + v.y * v.y; v.z = length <= 0.5 ? Math.sqrt(1 - length) : 0.5 / Math.sqrt(length); return v.normalize();
  }
  function startPointer(event: PointerEvent, move = false) {
    if (!ready || transition || event.button !== 0 || ((move || event.altKey) && windowState.filled)) return;
    if (!move && !bodyAt(event.clientX, event.clientY)) return;
    event.preventDefault(); moving = move || event.altKey; dragging = !moving; spinSpeed = 0;
    api.setDragging(true); api.setHitTest(false); lastHitIgnore = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (moving) api.moveStart(); else { previousBall.copy(ballPoint(event.clientX, event.clientY)); lastMoveTime = performance.now(); }
  }
  function endPointer() {
    if (performance.now() - lastMoveTime > 100) spinSpeed = 0;
    dragging = false; moving = false; api.setDragging(false); api.moveEnd(); updateHitTest();
  }
  renderer.domElement.addEventListener('pointerdown', event => startPointer(event));
  document.querySelector('#move-widget')!.addEventListener('pointerdown', event => startPointer(event as PointerEvent, true));
  document.addEventListener('pointermove', event => {
    cursor = { x: event.clientX, y: event.clientY }; updateHitTest();
    if (!dragging) return;
    const point = ballPoint(event.clientX, event.clientY); deltaQ.setFromUnitVectors(previousBall, point); active.inspection.quaternion.premultiply(deltaQ).normalize();
    const now = performance.now(), angle = 2 * Math.acos(Math.min(1, Math.abs(deltaQ.w)));
    if (angle > 0.00001) { spinAxis.set(deltaQ.x, deltaQ.y, deltaQ.z).normalize(); spinSpeed = Math.min(3, angle / Math.max(0.008, (now - lastMoveTime) / 1000)); }
    previousBall.copy(point); lastMoveTime = now;
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(event, endPointer);
  window.addEventListener('blur', endPointer);
  renderer.domElement.addEventListener('dblclick', event => { const hit = bodyAt(event.clientX, event.clientY); if (active.id === 'solar' && hit?.object.userData.systemId) navigate(hit.object.userData.systemId); });
  let zoomTimer: ReturnType<typeof setTimeout>;
  renderer.domElement.addEventListener('wheel', event => {
    event.preventDefault(); config.view.zoom = Math.min(5, Math.max(0.15, config.view.zoom * Math.exp(-event.deltaY * 0.001)));
    clearTimeout(zoomTimer); zoomTimer = setTimeout(() => { void patch('view.zoom', config.view.zoom); }, 120);
  }, { passive: false });
  const togglePause = () => patch('simulation.paused', !config.simulation.paused);
  const resetView = () => { active?.inspection.quaternion.setFromEuler(new THREE.Euler(active.id === 'solar' ? 0.60 : 0.36, 0, -0.025)); spinSpeed = 0; };
  document.querySelector('#toggle-pause')!.addEventListener('click', togglePause);
  document.querySelector('#reset-view')!.addEventListener('click', () => api.resetView());
  document.addEventListener('keydown', event => {
    if (event.repeat || (event.target as HTMLElement).closest('input,select,textarea')) return;
    if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); void togglePause(); }
    if (event.key.toLowerCase() === 'r') api.resetView(); if (event.key.toLowerCase() === 's') api.openSettings();
    if (event.key === 'Backspace') { event.preventDefault(); navigate('solar'); }
    if (!desktop && event.key === 'F11') { event.preventDefault(); void api.toggleFillScreen().then(applyWindowState); }
  });
  api.onCommand(command => { if (command === 'reset-view') resetView(); }); api.onConfig(applyConfig);
  window.addEventListener('resize', resize); new ResizeObserver(resize).observe(dock);
  refreshUI(); resize(); await loadTextures(renderer);
  // Compile the built-in views before revealing the scene to avoid first-switch shader stalls.
  for (const id of ['solar', ...config.planets.map(p => p.id)]) {
    const view = getView(id); view.update(config, simulation); view.frameCamera(innerWidth, innerHeight, reserved, config.view.zoom);
    await renderer.compileAsync(view.scene, view.camera);
    renderer.setRenderTarget(targets[0]);
    await renderer.compileAsync(view.scene, view.camera); renderer.render(view.scene, view.camera);
    renderer.setRenderTarget(null);
  }
  renderer.setRenderTarget(targets[1]); renderer.clear(); renderer.setRenderTarget(null);
  post.render(renderer, targets[0], targets[1], 0, config.view);
  active = getView(config.navigation.systemId); ready = true; document.querySelector('#loading')!.remove(); resize();
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); notice('显卡上下文中断，正在等待恢复…'); });
  renderer.domElement.addEventListener('webglcontextrestored', () => notice('画面已恢复'));
  let previous = performance.now(), lastRendered = 0, firstFrame = true;
  function frame(now: number) {
    requestAnimationFrame(frame); if (now - lastRendered < 1000 / config.view.fps - 0.5) return;
    const dt = Math.min((now - previous) / 1000, 0.5); previous = now; lastRendered = now; simulation.step(dt, config);
    if (!transition && !dragging && spinSpeed > 0.001) { active.inspection.quaternion.premultiply(deltaQ.setFromAxisAngle(spinAxis, spinSpeed * dt)).normalize(); spinSpeed *= Math.exp(-dt * 3.2); }
    if (transition) {
      const t = transition; progress = Math.min(1, progress + Math.min(dt, 1 / 15) / t.duration); const eased = smoothstep(progress);
      t.from.update(config, simulation); t.to.update(config, simulation);
      t.from.frameCamera(innerWidth, innerHeight, reserved, t.fromZoom, t.from.id === 'solar' ? 1 - eased * 0.60 : 1 + eased * 0.25, t.outFocus.clone().multiplyScalar(eased));
      t.to.frameCamera(innerWidth, innerHeight, reserved, config.view.zoom, t.to.id === 'solar' ? 0.45 + 0.55 * eased : 1.20 - 0.20 * eased, t.inFocus.clone().multiplyScalar(1 - eased));
      renderer.setRenderTarget(targets[0]); renderer.render(t.from.scene, t.from.camera);
      renderer.setRenderTarget(targets[1]); renderer.render(t.to.scene, t.to.camera);
      post.render(renderer, targets[0], targets[1], eased, config.view);
      if (progress >= 1) { active = t.to; transition = null; displayedZoom = config.view.zoom; startTransition(config.navigation.systemId, now); }
    } else {
      active.update(config, simulation); active.frameCamera(innerWidth, innerHeight, reserved, config.view.zoom);
      renderer.setRenderTarget(targets[0]); renderer.render(active.scene, active.camera);
      post.render(renderer, targets[0], null, 0, config.view);
      displayedZoom = config.view.zoom;
    }
    for (const [id, view] of views) if (id !== 'solar' && !config.planets.some(p => p.id === id) && view !== active && view !== transition?.from && view !== transition?.to) { view.dispose(); views.delete(id); }
    updateHitTest(); if (firstFrame) { firstFrame = false; api.ready(); }
  }
  requestAnimationFrame(frame);
  window.__jovianDebug = {
    getSnapshot: () => ({ ready, config, windowState, activeSystemId: active.id, targetSystemId: config.navigation.systemId, transitioning: !!transition, transitionProgress: progress,
      sceneCenter: active.sceneCenter, orientation: active.inspection.quaternion.toArray(), viewHalfHeight: active.halfHeight, elapsedHours: simulation.elapsedHours, canvasAlpha: renderer.getContext().getContextAttributes()?.alpha,
      planets: [...simulation.planets].map(([id, phase]) => ({ id, ...phase })),
      visiblePlanets: [...active.bodies.keys()], visibleMoons: active.moons.map(m => m.params.id), asteroidCount: active.id === 'solar' && config.solar.asteroidBelt ? config.solar.asteroidCount : 0,
      moons: [...simulation.moons].map(([id, phase]) => ({ id, ...phase })), textureCount: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }),
    hitAt: (x: number, y: number) => !!bodyAt(x, y),
    screenPosition: (id: string) => { const body = active.bodies.get(id); if (!body) return null; const p = body.root.getWorldPosition(new THREE.Vector3()).project(active.camera); return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 }; },
  };
}
init().catch(error => { console.error(error); const loading = document.querySelector('#loading'); if (loading) loading.textContent = `启动失败：${error.message}`; api.ready(); });

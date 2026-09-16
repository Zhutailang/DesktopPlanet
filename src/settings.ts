import { api, desktop } from './bridge.ts';
import type { Config } from './config.ts';
import { freshConfig, newMoon, newPlanet, selectedSystem, systemPath, systemLabel, timeScaleFor, AU_KM } from './config.ts';
import { icon, escapeHTML } from './icons.ts';
import './style.css';

let config = await api.getConfig();
let system = selectedSystem(config);
let activeTab = 'planet';
let selectedMoon = system.satellites.items[0]?.id || '';
let toastTimer: ReturnType<typeof setTimeout>;
const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <header class="titlebar"><div class="wordmark"><span class="brand-orbit">${icon('ring', 20)}</span>JOVIAN<span class="wordmark-suffix">DESK</span></div>
    <div class="window-actions"><button class="window-button" id="minimize" aria-label="最小化">${icon('minus', 15)}</button><button class="window-button" id="close-settings" aria-label="关闭设置">${icon('close', 15)}</button></div>
  </header>
  <div class="settings-system-row"><label for="edit-system">编辑行星</label><select id="edit-system" aria-label="编辑行星"></select></div>
  <section class="panel-hero"><div class="hero-copy"><div class="eyebrow">YOUR DESKTOP OBSERVATORY</div><h1>木星<span>JUPITER</span></h1><p>把一颗星球，放在桌面上。</p></div><div class="hero-planet" aria-hidden="true"></div></section>
  <div class="hero-facts"><div><span>赤道半径</span><strong>71,492 <small>km</small></strong></div><div><span>自转周期</span><strong id="hero-period">9.925 <small>h</small></strong></div><div><span>卫星</span><strong id="hero-moons">04 <small>颗</small></strong></div></div>
  <section class="time-console"><div class="time-console-top"><div class="time-title"><span class="live-dot" id="time-dot"></span><span id="time-state">时间流动中</span></div><button class="soft-button" id="pause-time">${icon('pause', 13)}<span>暂停</span></button></div>
    <div class="time-console-bottom"><label class="speed-input"><input type="number" min="1" max="100000000" step="1" data-path="simulation.timeScale" aria-label="时间倍率" value="${timeScaleFor(config)}"><span>× 时间倍率</span></label><div class="speed-presets"><button data-speed="1">实时</button><button data-speed="1200">演示</button><button data-speed="6000">快进</button></div></div>
    <p id="time-description">现实 1 秒 = 模拟 20 分钟</p>
  </section>
  <nav class="settings-tabs" aria-label="配置分类" role="tablist">
    ${[['planet', 'planet', '星球'], ['rings', 'ring', '星环'], ['moons', 'moons', '卫星'], ['solar', 'sun', '太阳系'], ['display', 'window', '显示']].map(([id, glyph, label]) => `<button role="tab" id="tab-${id}" data-tab="${id}" aria-controls="config-content" aria-selected="${id === activeTab}">${icon(glyph, 17)}${label}</button>`).join('')}
  </nav>
  <section class="config-scroll" id="config-content" role="tabpanel" aria-labelledby="tab-planet"></section>
  <footer class="panel-footer"><div class="save-state" id="save-state">${icon('check', 13)}<span>已保存到本机</span></div><div class="footer-actions"><button id="import-config" title="导入 JSON">${icon('upload', 14)}导入</button><button id="export-config" title="导出 JSON">${icon('download', 14)}导出</button><button id="reset-config" title="恢复太阳系默认配置">${icon('reset', 14)}</button></div></footer>
  <div class="toast" id="toast" role="status"></div>
  <dialog id="confirm-reset" class="confirm-dialog"><h2>恢复太阳系默认配置？</h2><p>所有行星、星环和卫星会恢复为初始值。你可以先导出当前配置，保留自己的设置。</p><div><button class="secondary-button" id="cancel-reset">取消</button><button class="primary-button" id="apply-reset">恢复默认</button></div></dialog>`;

const content = document.querySelector<HTMLElement>('#config-content')!;
const scoped = (path: string) => /^(planet|rings|satellites|orbit)(\.|$)/.test(path) || ['name', 'enabled'].includes(path);
const resolvePath = (path: string) => scoped(path) ? `${systemPath(config)}.${path}` : path === 'simulation.timeScale' && config.navigation.systemId === 'solar' ? 'simulation.overviewTimeScale' : path;
const valueAt = (path: string) => resolvePath(path).split('.').reduce((value: any, key) => value[key], config);
const surfaces: [string, string][] = [['mercury','水星岩面'],['venus','金星云层'],['earth','地球大陆与海洋'],['mars','火星地表'],['jupiter','木星云带'],['saturn','土星云带'],['uranus','天王星'],['neptune','海王星'],['moon','月球地图'],['io','木卫一近似'],['europa','冰裂纹近似'],['ganymede','冰岩近似'],['callisto','暗色陨坑'],['ice','冰质卫星近似'],['titan','泰坦云层近似'],['rock','通用岩石'],['none','纯基础颜色']];
const hint = (text: string) => `<p class="section-note">${text}</p>`;
const heading = (title: string, subtitle: string) => `<div class="section-heading"><h2>${escapeHTML(title)}</h2><p>${escapeHTML(subtitle)}</p></div>`;
function numeric(label: string, path: string, min: number, max: number, step: number, unit: string, description = '', slider = false) {
  const value = valueAt(path);
  return `<div class="field ${slider ? 'with-slider' : ''}"><div class="field-heading"><label for="field-${path}">${label}</label><span class="field-unit">${unit}</span></div>
    <div class="numeric-control">${slider ? `<input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-path="${path}" aria-label="${label}滑块">` : ''}<input id="field-${path}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" data-path="${path}" aria-label="${label}"></div>${description ? `<small class="field-help">${description}</small>` : ''}</div>`;
}
function toggle(label: string, path: string, description = '') {
  return `<label class="toggle-row"><span class="toggle-text"><span>${label}</span>${description ? `<small>${description}</small>` : ''}</span><input type="checkbox" data-path="${path}" ${valueAt(path) ? 'checked' : ''} aria-label="${label}"><span class="switch" aria-hidden="true"></span></label>`;
}
function colorField(label: string, path: string) {
  const value = valueAt(path);
  return `<div class="field color-field"><label for="field-${path}">${label}</label><div><span data-color-value="${path}">${value.toUpperCase()}</span><input type="color" id="field-${path}" value="${value}" data-path="${path}" aria-label="${label}"></div></div>`;
}
function select(label: string, path: string, options: [string, string][]) {
  return `<div class="field"><label for="field-${path}">${label}</label><select id="field-${path}" data-path="${path}" aria-label="${label}">${options.map(([value, text]) => `<option value="${value}" ${valueAt(path) === value ? 'selected' : ''}>${text}</option>`).join('')}</select></div>`;
}
function textField(label: string, path: string) {
  return `<div class="field"><label for="field-${path}">${label}</label><input id="field-${path}" type="text" maxlength="32" data-path="${path}" value="${escapeHTML(valueAt(path))}" aria-label="${label}"></div>`;
}

function render() {
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach(el => el.setAttribute('aria-selected', `${el.dataset.tab === activeTab}`));
  content.setAttribute('aria-labelledby', `tab-${activeTab}`);
  if (activeTab === 'planet') {
    content.innerHTML = heading('星球本体', `${system.name}的外观、轴倾角与独立运动。`) +
      textField('行星名称', 'name') + toggle('在太阳系中显示', 'enabled') +
      numeric('行星半径', 'planet.radiusKm', 1, 200000, 0.1, 'km') + colorField('行星基础颜色', 'planet.color') + select('行星表面', 'planet.texture', surfaces) +
      toggle('自动自转', 'planet.spinEnabled', '拖动观察时，自转仍会独立进行') +
      numeric('自转周期', 'planet.spinPeriodHours', 0.01, 100000000, 0.001, '小时 / 圈', '使用恒星自转周期；演示速度同时受时间倍率影响。') +
      `<div class="inline-metric">屏幕上转一圈 <strong id="effective-period">—</strong></div>` +
      toggle('反向自转', 'planet.retrograde') +
      `<div class="section-divider"></div>` +
      numeric('自转轴倾角', 'planet.axialTiltDeg', -180, 180, 0.01, '°', '相对轨道法线；大于 90° 的倾角本身已表示逆向轴，反向自转开关会额外反转。', true) +
      numeric('扁率', 'planet.flattening', 0, 0.2, 0.00001, '', '赤道与极半径之差除以赤道半径。', true) +
      numeric('大气边缘', 'planet.atmosphere', 0, 1, 0.01, '', '轻微的散射光，避免过亮的发光轮廓。', true) +
      heading('绕太阳的轨道', `当前半长轴约 ${(system.orbit.semiMajorAxisKm / AU_KM).toFixed(3)} AU`) +
      numeric('行星轨道半长轴', 'orbit.semiMajorAxisKm', 700000, AU_KM * 200, 1000, 'km', '1 AU = 149,597,870.7 km。') +
      numeric('行星轨道离心率', 'orbit.eccentricity', 0, 0.85, 0.001, '', '', true) +
      numeric('行星轨道倾角', 'orbit.inclinationDeg', 0, 180, 0.01, '°', '', true) +
      numeric('行星升交点经度', 'orbit.ascendingNodeDeg', 0, 360, 0.1, '°', '', true) +
      numeric('行星近心点幅角', 'orbit.periapsisDeg', 0, 360, 0.1, '°', '', true) +
      numeric('行星轨道相位', 'orbit.phaseDeg', 0, 360, 0.1, '°', '', true) +
      toggle('行星公转', 'orbit.orbitEnabled') + numeric('行星公转周期', 'orbit.orbitPeriodHours', 0.01, 100000000, 0.01, '小时 / 圈') +
      toggle('反向公转', 'orbit.retrograde') +
      `<div class="source-card"><span class="source-label">SURFACE & ORBIT</span><strong>NASA / JPL · Solar System Scope</strong><p>木星使用 Hubble 地图；其他主要天体使用授权行星贴图。未测绘的卫星地貌使用程序近似，初始轨道相位用于展示。</p></div>` +
      (!system.builtin ? `<button class="danger-text" id="delete-planet">删除此自定义行星及其卫星</button>` : '');
    document.querySelector('#delete-planet')?.addEventListener('click', async () => {
      const next = structuredClone(config); next.planets = next.planets.filter(p => p.id !== system.id);
      next.navigation = { systemId: 'solar', selectedPlanetId: next.planets[0].id }; next.view.zoom = 1;
      await setValue('$config', next); activeTab = 'solar'; render();
    });
  } else if (activeTab === 'rings') {
    content.innerHTML = heading('星环系统', `${system.name}的赤道环带。`) +
      toggle('显示星环', 'rings.enabled', '星环参数独立保存在当前行星系统中') +
      `<div class="preset-pair"><button class="preset-card" id="faint-rings"><span class="preset-orbit faint"></span><strong>木星尘埃环</strong><small>细窄 · 稀薄</small></button><button class="preset-card" id="wide-rings"><span class="preset-orbit wide"></span><strong>宽环演示</strong><small>自定义外观</small></button></div>` +
      numeric('内侧半径', 'rings.innerRadius', 1.05, 5, 0.01, '行星半径', `从行星中心测量；1 单位 = ${system.planet.radiusKm.toLocaleString()} km。`, true) +
      numeric('星环宽度', 'rings.width', 0.01, 5, 0.01, '行星半径', '', true) +
      colorField('星环颜色', 'rings.color') +
      numeric('星环密度', 'rings.density', 0, 1, 0.005, '', '控制视觉不透明度。0 完全不可见，1 最浓密。', true) +
      hint('星环位于当前行星的赤道平面，包含细密环带和行星投影；尺寸以当前行星半径为单位。');
    document.querySelector('#faint-rings')!.addEventListener('click', () => setValue('rings', freshConfig().planets.find(p => p.id === 'jupiter')!.rings));
    document.querySelector('#wide-rings')!.addEventListener('click', () => setValue('rings', { enabled: true, innerRadius: 1.3, width: 1.1, color: '#d0b68c', density: 0.82 }));
  } else if (activeTab === 'moons') {
    renderMoons();
  } else if (activeTab === 'solar') {
    renderSolar();
  } else {
    content.innerHTML = heading('观测与桌面', '在真实尺度和清晰展示之间切换。') +
      select('空间比例', 'view.scaleMode', [['presentation', '展示比例 · 轨道压缩'], ['physical', '真实比例 · 大小与距离一致']]) +
      hint('展示比例会压缩距离、放大星体与微小卫星。真实比例使用统一大小与距离尺度，太阳系中的行星将很难看见。') +
      numeric('卫星显示倍率', 'view.moonScale', 1, 8, 0.1, '×', '仅在展示比例下生效。', true) +
      numeric('过渡时长', 'view.transitionSeconds', 0.35, 3, 0.05, '秒', '系统切换时的镜头缩放与淡入淡出。', true) +
      numeric('视图缩放', 'view.zoom', 0.15, 5, 0.05, '×', '也可以把鼠标移到星体上滚动滚轮。', true) +
      `<div class="section-divider"></div>` +
      numeric('太阳光强度', 'view.sunlight', 0.5, 5, 0.05, '', '', true) +
      numeric('暗面补光', 'view.ambientLight', 0, 0.5, 0.005, '', '降低补光能获得更接近太空的深暗夜面。', true) +
      toggle('Bloom 光晕', 'view.bloomEnabled', '让星体亮部向轮廓外柔和扩散') +
      numeric('光晕强度', 'view.bloomStrength', 0, 3, 0.05, '', '提高数值，光晕更明亮。', true) +
      numeric('光晕扩散范围', 'view.bloomRadius', 0, 1, 0.05, '', '提高数值，光晕更宽、更柔和。', true) +
      `<div class="section-divider"></div>` +
      toggle('始终置顶', 'view.alwaysOnTop', '星球保持在其他窗口上方') +
      toggle('透明区域鼠标穿透', 'view.clickThrough', '星球以外的空白仍可点击桌面') +
      toggle('显示底部控制台', 'view.showHUD', '隐藏后可通过托盘或 Ctrl + Alt + J 打开设置') +
      select('帧率上限', 'view.fps', [['60', '60 fps · 流畅'], ['30', '30 fps · 节能']]) +
      `<div class="shortcut-card"><h3>操作指南</h3><p><kbd>总览中双击行星</kbd><span>进入该行星系统</span></p><p><kbd>Backspace</kbd><span>返回太阳系</span></p><p><kbd>左键拖动</kbd><span>旋转观察姿态</span></p><p><kbd>Alt + 拖动</kbd><span>移动桌面窗口</span></p><p><kbd>F11</kbd><span>铺满当前屏幕 / 还原</span></p><p><kbd>Esc</kbd><span>退出铺满</span></p><p><kbd>空格</kbd><span>暂停 / 继续时间</span></p><p><kbd>R</kbd><span>重置视角</span></p><p><kbd>Ctrl + Alt + J</kbd><span>打开设置</span></p></div>` +
      `<button class="danger-text" id="quit-app">退出 Jovian Desk</button>`;
    document.querySelector('#quit-app')!.addEventListener('click', () => api.quit());
  }
  refresh();
}


function renderSolar() {
  content.innerHTML = heading('太阳系', '总览只呈现太阳、行星和主小行星带。') +
    toggle('显示行星轨道', 'solar.showOrbits') + toggle('显示主小行星带', 'solar.asteroidBelt') +
    numeric('小行星颗粒数量', 'solar.asteroidCount', 100, 6000, 100, '颗', '主小行星带位于约 2.1–3.3 AU，颗粒用于示意分布。', true) +
    `<div class="moon-list">${config.planets.map(p => `<button class="moon-picker" data-edit-planet="${p.id}"><span class="moon-summary"><strong>${escapeHTML(p.name)}</strong><small>${(p.orbit.semiMajorAxisKm / AU_KM).toFixed(2)} AU · ${p.satellites.items.length} 颗卫星${p.builtin ? '' : ' · 自定义'}</small></span><span class="moon-enabled-dot ${p.enabled ? 'on' : ''}"></span>${icon('chevron',14)}</button>`).join('')}</div>` +
    `<button class="add-moon" id="add-planet" ${config.planets.length >= 24 ? 'disabled' : ''}>${icon('plus',16)}添加行星 <span>${config.planets.length} / 24</span></button>` +
    hint('每颗行星都有自己的半径、贴图、颜色、自转、公转、星环和卫星数组。点选行星进入编辑；可在“星球”页隐藏预设行星或删除自定义行星。');
  content.querySelectorAll<HTMLElement>('[data-edit-planet]').forEach(button => button.addEventListener('click', async () => {
    await setValue('$navigate', button.dataset.editPlanet!); activeTab = 'planet'; render(); content.scrollTop = 0;
  }));
  document.querySelector('#add-planet')!.addEventListener('click', async () => {
    const next = structuredClone(config), item = newPlanet(next.planets.length); next.planets.push(item);
    next.navigation = { systemId: item.id, selectedPlanetId: item.id }; next.view.zoom = 1;
    await setValue('$config', next); activeTab = 'planet'; render(); content.scrollTop = 0;
  });
}

function renderMoons() {
  const moons = system.satellites.items;
  if (!moons.some(m => m.id === selectedMoon)) selectedMoon = moons[0]?.id || '';
  const index = moons.findIndex(m => m.id === selectedMoon);
  const moon = moons[index];
  const p = `satellites.items.${index}`;
  content.innerHTML = heading('卫星系统', '每一颗卫星，都有自己的轨道与周期。') +
    toggle('启用卫星系统', 'satellites.enabled') +
    `<div class="moon-list">${moons.map(m => `<button class="moon-picker ${m.id === selectedMoon ? 'selected' : ''}" data-moon="${m.id}"><span class="moon-dot ${m.texture}"></span><span class="moon-summary"><strong>${escapeHTML(m.name)}</strong><small>${m.radiusKm.toLocaleString('en-US')} km <i>·</i> ${m.orbitPeriodHours.toFixed(2)} h</small></span><span class="moon-enabled-dot ${m.enabled ? 'on' : ''}"></span>${icon('chevron', 14)}</button>`).join('')}</div>` +
    `<button class="add-moon" id="add-moon" ${moons.length >= 32 ? 'disabled' : ''}>${icon('plus', 16)}添加卫星 <span>${moons.length} / 32</span></button>` +
    (moon ? `<div class="moon-editor"><div class="moon-editor-heading"><span>编辑卫星</span><button id="delete-moon" class="danger-text">删除</button></div>` +
      textField('卫星名称', `${p}.name`) + toggle('显示这颗卫星', `${p}.enabled`) +
      numeric('卫星半径', `${p}.radiusKm`, 0.1, 50000, 0.1, 'km') + colorField('基础颜色', `${p}.color`) +
      select('表面地貌', `${p}.texture`, surfaces) +
      `<div class="section-divider"></div><h3 class="group-title">椭圆轨道</h3>` +
      numeric('轨道半长轴', `${p}.semiMajorAxisKm`, 1, AU_KM * 200, 100, 'km', '相对于当前行星中心；近心点不能穿过行星表面。') +
      numeric('离心率', `${p}.eccentricity`, 0, 0.85, 0.001, '', '0 为圆轨道，数值越大越狭长。', true) +
      select('轨道参考平面', `${p}.referencePlane`, [['equatorial', '行星赤道平面'], ['ecliptic', '黄道参考平面']]) +
      numeric('轨道倾角', `${p}.inclinationDeg`, 0, 180, 0.01, '°', '相对所选参考平面；倾角大于 90° 表示逆行轨道。', true) +
      numeric('升交点经度', `${p}.ascendingNodeDeg`, 0, 360, 0.1, '°', '', true) +
      numeric('近心点幅角', `${p}.periapsisDeg`, 0, 360, 0.1, '°', '', true) +
      numeric('轨道相位', `${p}.phaseDeg`, 0, 360, 0.1, '°', '修改此项会主动重新定位卫星。', true) +
      `<div class="section-divider"></div><h3 class="group-title">独立运动</h3>` +
      toggle('卫星自转', `${p}.spinEnabled`) +
      numeric('卫星自转周期', `${p}.spinPeriodHours`, 0.01, 100000000, 0.0001, '小时 / 圈') +
      toggle('卫星公转', `${p}.orbitEnabled`) +
      numeric('卫星公转周期', `${p}.orbitPeriodHours`, 0.01, 100000000, 0.0001, '小时 / 圈') +
      toggle('逆向运动', `${p}.retrograde`, '同时反向推进自转和公转') +
      `<button class="secondary-button full-width" id="sync-period">将自转周期设为公转周期</button>` +
      hint('四颗伽利略卫星默认自转与公转周期相同。椭圆轨道按开普勒方程推进；周期与轨道大小可独立修改，用于演示。卫星地貌为程序生成的近似效果。') + `</div>` : hint('当前没有卫星。点击“添加卫星”建立第一条轨道。')) +
    `<div class="section-divider"></div>` + toggle('显示轨道线', 'satellites.showOrbits');
  content.querySelectorAll<HTMLElement>('[data-moon]').forEach(button => button.addEventListener('click', () => { selectedMoon = button.dataset.moon!; render(); }));
  document.querySelector('#add-moon')!.addEventListener('click', async () => {
    const item = newMoon(system.satellites.items.length, system.planet.radiusKm); selectedMoon = item.id;
    await setValue('satellites.items', [...system.satellites.items, item]); render();
    document.querySelector('.moon-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelector('#delete-moon')?.addEventListener('click', async () => { await setValue('satellites.items', system.satellites.items.filter(m => m.id !== selectedMoon)); selectedMoon = system.satellites.items[0]?.id || ''; render(); });
  document.querySelector('#sync-period')?.addEventListener('click', () => setValue(`${p}.spinPeriodHours`, system.satellites.items[index].orbitPeriodHours));
}

function refresh() {
  const selector = document.querySelector<HTMLSelectElement>('#edit-system')!;
  const options = config.planets.map(p => `<option value="${p.id}">${escapeHTML(systemLabel(p))}</option>`).join('');
  if (selector.innerHTML !== options) selector.innerHTML = options; selector.value = system.id;
  document.querySelector('.hero-copy h1')!.innerHTML = `${escapeHTML(system.name)}<span>${system.builtin ? system.id.toUpperCase() : 'CUSTOM'}</span>`;
  document.querySelector('.hero-facts strong')!.innerHTML = `${system.planet.radiusKm.toLocaleString()} <small>km</small>`;
  document.querySelector<HTMLElement>('.hero-planet')!.style.backgroundImage = `url('./textures/${['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune','moon'].includes(system.planet.texture) ? system.planet.texture : 'moon'}.jpg')`;
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-path]').forEach(input => {
    let value: any; try { value = valueAt(input.dataset.path!); } catch { return; }
    if (document.activeElement !== input) {
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = value;
      else input.value = `${value}`;
    }
    if (input instanceof HTMLInputElement && input.type === 'range') {
      const progress = (Number(value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100;
      input.style.setProperty('--fill', `${progress}%`);
    }
  });
  document.querySelectorAll<HTMLElement>('[data-color-value]').forEach(el => el.textContent = valueAt(el.dataset.colorValue!).toUpperCase());
  document.querySelector('#hero-period')!.innerHTML = `${system.planet.spinPeriodHours.toLocaleString('en-US', { maximumFractionDigits: 3 })} <small>h</small>`;
  document.querySelector('#hero-moons')!.innerHTML = `${String(system.satellites.enabled ? system.satellites.items.filter(m => m.enabled).length : 0).padStart(2, '0')} <small>颗</small>`;
  const seconds = system.planet.spinPeriodHours * 3600 / timeScaleFor(config);
  const effective = document.querySelector('#effective-period');
  if (effective) effective.textContent = !system.planet.spinEnabled ? '自转已关闭' : config.simulation.paused ? '时间已暂停' : seconds < 60 ? `约 ${seconds.toFixed(1)} 秒` : seconds < 3600 ? `约 ${(seconds / 60).toFixed(1)} 分钟` : `约 ${(seconds / 3600).toFixed(2)} 小时`;
  document.querySelector('#time-state')!.textContent = config.simulation.paused ? '时间已暂停' : '时间流动中';
  document.querySelector('#time-dot')!.classList.toggle('paused', config.simulation.paused);
  document.querySelector('#pause-time')!.innerHTML = `${icon(config.simulation.paused ? 'play' : 'pause', 13)}<span>${config.simulation.paused ? '继续' : '暂停'}</span>`;
  const scale = timeScaleFor(config);
  document.querySelector('#time-description')!.textContent = scale < 60 ? `现实 1 秒 = 模拟 ${scale.toLocaleString()} 秒` : `现实 1 秒 = 模拟 ${(scale / 60).toLocaleString('en-US', { maximumFractionDigits: 2 })} 分钟`;
  document.querySelectorAll<HTMLElement>('[data-speed]').forEach((el, index) => {
    el.dataset.speed = String((config.navigation.systemId === 'solar' ? [1, 864000, 4320000] : [1, 1200, 6000])[index]);
    el.classList.toggle('active', Number(el.dataset.speed) === scale);
  });
}
function toast(message: string, error = false) {
  const el = document.querySelector<HTMLElement>('#toast')!;
  el.textContent = message; el.classList.toggle('error', error); el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), error ? 6500 : 2500);
}
async function setValue(path: string, value: unknown) {
  const status = document.querySelector('#save-state span')!; status.textContent = '正在保存…';
  const result = await api.patch(resolvePath(path), value);
  if (result.ok) { config = result.config; system = selectedSystem(config); status.textContent = '已保存到本机'; refresh(); }
  else { status.textContent = '配置未更改'; toast(result.error, true); (document.activeElement as HTMLElement)?.blur(); refresh(); }
}
function controlChange(event: Event) {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  const path = target.dataset.path; if (!path) return;
  const live = target instanceof HTMLInputElement && (target.type === 'range' || target.type === 'color');
  if (event.type === 'input' && !live) return;
  if (event.type === 'change' && live) return;
  let value: any = target.value;
  if (target instanceof HTMLInputElement && target.type === 'checkbox') value = target.checked;
  else if ((target instanceof HTMLInputElement && ['number', 'range'].includes(target.type)) || path === 'view.fps') {
    if (target.value.trim() === '') { toast('请输入一个数值', true); target.blur(); refresh(); return; }
    value = Number(target.value);
  }
  void setValue(path, value);
}
app.addEventListener('input', controlChange); app.addEventListener('change', controlChange);
document.querySelectorAll<HTMLElement>('[data-tab]').forEach(button => button.addEventListener('click', () => { activeTab = button.dataset.tab!; render(); content.scrollTop = 0; }));
document.querySelectorAll<HTMLElement>('[data-speed]').forEach(button => button.addEventListener('click', () => setValue('simulation.timeScale', Number(button.dataset.speed))));
document.querySelector('#pause-time')!.addEventListener('click', () => setValue('simulation.paused', !config.simulation.paused));
document.querySelector('#close-settings')!.addEventListener('click', () => api.closeSettings());
document.querySelector('#minimize')!.addEventListener('click', () => api.minimizeSettings());
document.querySelector('#export-config')!.addEventListener('click', async () => { const result = await api.exportConfig(); if (result.ok) toast('配置已导出'); else if (!result.canceled) toast(result.error || '导出失败', true); });
document.querySelector('#import-config')!.addEventListener('click', async () => {
  const result = await api.importConfig(); if ('canceled' in result) return;
  if (result.ok) { config = result.config; system = selectedSystem(config); render(); toast('配置已导入并生效'); } else toast(result.error, true);
});
const resetDialog = document.querySelector<HTMLDialogElement>('#confirm-reset')!;
document.querySelector('#reset-config')!.addEventListener('click', () => resetDialog.showModal());
document.querySelector('#cancel-reset')!.addEventListener('click', () => resetDialog.close());
document.querySelector('#apply-reset')!.addEventListener('click', async () => {
  const result = await api.resetConfig(); resetDialog.close();
  if (result.ok) { config = result.config; system = selectedSystem(config); render(); toast('已恢复太阳系默认配置'); } else toast(result.error, true);
});
document.querySelector('#edit-system')!.addEventListener('change', event => { void setValue('$navigate', (event.target as HTMLSelectElement).value); });
api.onConfig(next => {
  const nextSystem = selectedSystem(next);
  const systemChanged = system.id !== nextSystem.id;
  const planetsChanged = JSON.stringify(config.planets.map(p => [p.id,p.name,p.enabled])) !== JSON.stringify(next.planets.map(p => [p.id,p.name,p.enabled]));
  const structureChanged = JSON.stringify(system.satellites.items.map(m => [m.id,m.name])) !== JSON.stringify(nextSystem.satellites.items.map(m => [m.id,m.name]));
  config = next; system = nextSystem;
  if (systemChanged) { selectedMoon = system.satellites.items[0]?.id || ''; render(); return; }
  if (activeTab === 'solar' && planetsChanged) { render(); return; }
  if (activeTab === 'moons' && structureChanged && !(document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text')) render();
  else refresh();
});
if (!desktop) document.title += '（浏览器预览）';
render();

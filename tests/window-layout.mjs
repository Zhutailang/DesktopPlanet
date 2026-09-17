import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = process.cwd();
const resultDir = path.join(root, 'test-results', `window-layout-${Date.now()}`);
const userData = path.join(resultDir, 'user-data');
await mkdir(resultDir, { recursive: true });
const env = { ...process.env, JOVIAN_TEST: '1', JOVIAN_DATA_DIR: userData };
delete env.ELECTRON_RUN_AS_NODE;
const options = { args: [root], env, timeout: 60000 };
let application;
const errors = [];
const layouts = [];
try {
  application = await electron.launch(options);
  await expect.poll(() => application.windows().length, { timeout: 30000 }).toBe(2);
  let planet = application.windows().find(page => !page.url().includes('settings'));
  const settings = application.windows().find(page => page.url().includes('settings'));
  for (const page of application.windows()) { page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)); }
  await planet.waitForFunction(() => window.__jovianDebug?.getSnapshot().ready);
  await settings.getByRole('heading', { name: '星球本体' }).waitFor();
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('观测设置')).isVisible()), false);
  assert.equal(await planet.locator('.widget-top, .moon-label, #moon-labels, .floating-button').count(), 0);
  assert.equal(await planet.locator('#app > :not(#viewport):not(.planet-dock)').count(), 0);

  for (const [width, height] of [[1024, 600], [800, 480], [480, 320], [320, 240]]) {
    await application.evaluate(({ BrowserWindow, screen }, size) => {
      const { x, y } = screen.getPrimaryDisplay().workArea;
      BrowserWindow.getAllWindows().find(w => !w.getTitle().includes('观测设置')).setBounds({ x: x + 30, y: y + 30, ...size });
    }, { width, height });
    await expect.poll(() => planet.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
    await expect.poll(() => planet.locator('canvas').evaluate(el => [el.clientWidth, el.clientHeight])).toEqual([width, height]);
    await planet.waitForFunction(() => window.__jovianDebug.getSnapshot().sceneCenter.x === innerWidth / 2);
    const layout = await planet.evaluate(() => {
      const dock = document.querySelector('.planet-dock');
      const bounds = dock.getBoundingClientRect();
      return {
        size: [innerWidth, innerHeight], dock: bounds.toJSON(),
        overflow: document.documentElement.scrollWidth > innerWidth || dock.scrollWidth > dock.clientWidth,
        buttons: [...dock.querySelectorAll('button')].map(button => ({ label: button.getAttribute('aria-label'), ...button.getBoundingClientRect().toJSON() })),
        scene: window.__jovianDebug.getSnapshot(),
      };
    });
    assert.equal(layout.overflow, false, `No overflow at ${width}×${height}: ${JSON.stringify(layout.dock)}`);
    assert.ok(Math.abs(layout.dock.x + layout.dock.width / 2 - width / 2) <= 1);
    assert.ok(layout.dock.bottom <= height && layout.dock.y > height / 2);
    for (const button of layout.buttons) assert.ok(button.x >= 0 && button.right <= width && button.y >= 0 && button.bottom <= height, `${width}×${height}: ${button.label} must fit`);
    assert.equal(layout.scene.canvasAlpha, true);
    const centre = layout.scene.sceneCenter;
    assert.equal(await planet.evaluate(p => window.__jovianDebug.hitAt(p.x, p.y), centre), true);
    assert.equal(await planet.evaluate(() => window.__jovianDebug.hitAt(2, 2)), false);
    await planet.screenshot({ path: path.join(resultDir, `planet-${width}x${height}.png`), omitBackground: true });
    layouts.push(layout);
  }

  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.getTitle().includes('观测设置')).isResizable()), true);
  await planet.getByRole('button', { name: '打开观测设置' }).click();
  await settings.getByRole('tab', { name: '显示', exact: true }).click();
  await settings.getByLabel('窗口宽度', { exact: true }).fill('640');
  await settings.getByLabel('窗口宽度', { exact: true }).press('Tab');
  await settings.getByLabel('窗口高度', { exact: true }).fill('420');
  await settings.getByLabel('窗口高度', { exact: true }).press('Tab');
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => {
    const bounds = BrowserWindow.getAllWindows().find(w => !w.getTitle().includes('观测设置')).getBounds(); return [bounds.width, bounds.height];
  })).toEqual([640, 420]);
  await expect.poll(() => planet.evaluate(() => {
    const view = window.__jovianDebug.getSnapshot().config.view; return [view.windowWidth, view.windowHeight];
  })).toEqual([640, 420]);
  await settings.getByRole('tab', { name: '星球', exact: true }).click();
  await settings.getByRole('button', { name: '关闭设置' }).click();

  // Use the smallest connected display, including a non-primary monitor when available.
  const displays = await application.evaluate(({ screen }) => screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor })));
  const target = [...displays].sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0];
  // Finish a drag from an oversized window: its bottom dock must remain on the destination screen.
  await application.evaluate(({ BrowserWindow, screen }, area) => {
    globalThis.__originalCursor = screen.getCursorScreenPoint;
    screen.getCursorScreenPoint = () => ({ x: area.x + 100, y: area.y + 100 });
    BrowserWindow.getAllWindows().find(w => !w.getTitle().includes('观测设置')).setBounds({ x: area.x + 20, y: area.y + 20, width: area.width + 100, height: area.height + 100 });
  }, target.workArea);
  await planet.evaluate(async () => {
    window.jovian.moveStart(); await window.jovian.getWindowState();
    window.jovian.moveEnd(); await window.jovian.getWindowState();
  });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.getTitle().includes('观测设置')).getBounds())).toEqual(target.workArea);
  await application.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.__originalCursor; delete globalThis.__originalCursor; });
  const normal = { x: target.workArea.x + 12, y: target.workArea.y + 12, width: Math.min(720, target.workArea.width - 24), height: Math.min(440, target.workArea.height - 24) };
  await application.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows().find(w => !w.getTitle().includes('观测设置')).setBounds(bounds), normal);
  const getBounds = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.getTitle().includes('观测设置')).getBounds());
  await planet.getByRole('button', { name: '铺满当前屏幕', exact: true }).click();
  await expect.poll(getBounds).toEqual(target.bounds);
  await expect(planet.getByRole('button', { name: '还原窗口', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(planet.getByRole('button', { name: '移动窗口' })).toBeDisabled();
  assert.equal(await planet.evaluate(() => window.__jovianDebug.getSnapshot().canvasAlpha), true);
  await planet.screenshot({ path: path.join(resultDir, 'planet-filled-current-screen.png'), omitBackground: true });

  await planet.getByRole('button', { name: '打开观测设置' }).click();
  const settingsBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle().includes('观测设置')).getBounds());
  assert.ok(settingsBounds.x >= target.workArea.x && settingsBounds.y >= target.workArea.y);
  assert.ok(settingsBounds.x + settingsBounds.width <= target.workArea.x + target.workArea.width);
  assert.ok(settingsBounds.y + settingsBounds.height <= target.workArea.y + target.workArea.height);
  await settings.screenshot({ path: path.join(resultDir, 'settings-small-screen.png') });
  assert.ok(await settings.locator('.config-scroll').evaluate(el => el.clientHeight > 150));
  await settings.getByRole('button', { name: '关闭设置' }).click();

  // Settings remain usable even on a 320 × 240 panel.
  await application.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('观测设置'));
    panel.setSize(320, 240); panel.showInactive();
  });
  await expect.poll(() => settings.evaluate(() => [innerWidth, innerHeight])).toEqual([320, 240]);
  const compactSettings = await settings.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    scroll: document.querySelector('.config-scroll').clientHeight,
    footerBottom: document.querySelector('.panel-footer').getBoundingClientRect().bottom,
  }));
  assert.equal(compactSettings.overflow, false);
  assert.ok(compactSettings.scroll >= 50 && compactSettings.footerBottom <= 240);
  await settings.getByLabel('自转周期', { exact: true }).fill('12');
  await settings.getByLabel('自转周期', { exact: true }).press('Tab');
  await expect.poll(() => planet.evaluate(() => window.__jovianDebug.getSnapshot().config.planets.find(p => p.id === 'earth').planet.spinPeriodHours)).toBe(12);
  await settings.screenshot({ path: path.join(resultDir, 'settings-320x240.png') });
  await settings.getByRole('button', { name: '关闭设置' }).click();

  await planet.keyboard.press('Escape');
  await expect.poll(getBounds).toEqual(normal);
  await expect(planet.getByRole('button', { name: '移动窗口' })).toBeEnabled();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.getTitle().includes('观测设置')).showInactive());
  await planet.getByLabel('切换行星系统').selectOption('earth');
  await expect.poll(() => planet.evaluate(() => { const s=window.__jovianDebug.getSnapshot(); return !s.transitioning && s.activeSystemId; }), { timeout: 15000 }).toBe('earth');
  const centre = await planet.evaluate(() => window.__jovianDebug.getSnapshot().sceneCenter);
  const before = await planet.evaluate(() => window.__jovianDebug.getSnapshot().orientation);
  await planet.mouse.move(centre.x, centre.y); await planet.mouse.down();
  await planet.mouse.move(centre.x + 45, centre.y + 20, { steps: 8 }); await planet.mouse.up();
  assert.notDeepEqual(await planet.evaluate(() => window.__jovianDebug.getSnapshot().orientation), before);
  await planet.keyboard.press('F11'); await expect.poll(getBounds).toEqual(target.bounds);
  await planet.getByRole('button', { name: '还原窗口', exact: true }).click(); await expect.poll(getBounds).toEqual(normal);
  await planet.keyboard.press('F11'); await expect.poll(getBounds).toEqual(target.bounds);
  await application.close(); application = null;

  const persisted = JSON.parse(await readFile(path.join(userData, 'window-state.json'), 'utf8'));
  assert.equal(persisted.filled, true); assert.equal(persisted.displayId, target.id);
  assert.deepEqual(persisted.bounds, normal);
  application = await electron.launch(options);
  await expect.poll(() => application.windows().length, { timeout: 30000 }).toBe(2);
  planet = application.windows().find(page => !page.url().includes('settings'));
  await planet.waitForFunction(() => window.__jovianDebug?.getSnapshot().ready);
  await expect.poll(getBounds).toEqual(target.bounds);
  await expect(planet.getByRole('button', { name: '还原窗口', exact: true })).toBeVisible();
  await planet.keyboard.press('Escape'); await expect.poll(getBounds).toEqual(normal);
  assert.deepEqual(errors, []);
  await writeFile(path.join(resultDir, 'verification.json'), JSON.stringify({ displays, target, normal, layouts, compactSettings, persisted, errors }, null, 2));
  console.log('ALL WINDOW LAYOUT CHECKS PASSED', resultDir);
} catch (error) {
  if (application) for (const [i, page] of application.windows().entries()) {
    try { await page.screenshot({ path: path.join(resultDir, `failure-${i}.png`), omitBackground: true, timeout: 5000 }); } catch {}
  }
  console.error('Window layout verification failed', resultDir, error);
  process.exitCode = 1;
} finally { if (application) await application.close(); }

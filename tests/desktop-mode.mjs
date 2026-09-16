import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'test-results', `desktop-mode-${Date.now()}`);
await mkdir(output, { recursive: true });
const env = { ...process.env, JOVIAN_TEST: '1', JOVIAN_DATA_DIR: path.join(output, 'user-data') };
delete env.ELECTRON_RUN_AS_NODE;
const launch = process.env.JOVIAN_DESKTOP_EXE
  ? { executablePath: process.env.JOVIAN_DESKTOP_EXE, env, timeout: 60000 }
  : { args: [root], env, timeout: 60000 };
const app = await electron.launch(launch);
const errors = [];

try {
  await expect.poll(() => app.windows().length, { timeout: 30000 }).toBe(2);
  const page = app.windows().find(candidate => !candidate.url().includes('settings'));
  for (const candidate of app.windows()) {
    candidate.on('pageerror', error => errors.push(error.message));
    candidate.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  }
  await page.waitForFunction(() => window.__jovianDebug?.getSnapshot().ready, null, { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => {
    const widget = BrowserWindow.getAllWindows().find(window => !window.getTitle().includes('观测设置'));
    globalThis.__presentationCalls = [];
    const original = widget.setSkipTaskbar.bind(widget);
    widget.setSkipTaskbar = value => {
      globalThis.__presentationCalls.push(['setSkipTaskbar', value]);
      return original(value);
    };
    widget.showInactive();
  });

  await expect(page.locator('.planet-dock')).toBeVisible();
  assert.deepEqual(await app.evaluate(() => globalThis.__jovianTest.presentation()), {
    controlsHidden: false, taskbarHidden: false, desktopLayer: false, desktopLayerError: '', alwaysOnTop: true, focusable: true,
  });

  await page.getByRole('button', { name: '隐藏操作 UI', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '隐藏操作 UI？' });
  await expect(dialog).toBeVisible();
  const warning = await dialog.textContent();
  assert.match(warning, /Windows 任务栏/);
  assert.match(warning, /桌面底层/);
  assert.match(warning, /系统托盘/);
  assert.match(warning, /切换星系/);
  await page.screenshot({ path: path.join(output, 'hide-confirmation.png'), omitBackground: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  assert.equal(await page.evaluate(() => window.__jovianDebug.getSnapshot().config.view.showHUD), true);

  await page.getByRole('button', { name: '隐藏操作 UI', exact: true }).click();
  await dialog.getByRole('button', { name: '隐藏并置底', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__jovianDebug.getSnapshot().config.view.showHUD)).toBe(false);
  await expect(page.locator('.planet-dock')).toBeHidden();
  await expect.poll(async () => {
    const state = await app.evaluate(() => globalThis.__jovianTest.presentation());
    if (state.desktopLayerError) throw new Error(state.desktopLayerError);
    return state.desktopLayer;
  }, { timeout: 15000 }).toBe(true);
  const hidden = await app.evaluate(() => globalThis.__jovianTest.presentation());
  assert.deepEqual(hidden, {
    controlsHidden: true, taskbarHidden: true, desktopLayer: true, desktopLayerError: '', alwaysOnTop: false, focusable: false,
  });
  assert.ok((await app.evaluate(() => globalThis.__presentationCalls)).some(([, value]) => value === true));

  const systems = await app.evaluate(() => globalThis.__jovianTest.traySystems());
  assert.deepEqual(systems.map(system => system.id), ['solar', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
  await app.evaluate(() => globalThis.__jovianTest.switchSystem('mars'));
  await expect.poll(() => page.evaluate(() => {
    const state = window.__jovianDebug.getSnapshot();
    return state.transitioning ? null : state.activeSystemId;
  }), { timeout: 20000 }).toBe('mars');
  await expect(page.locator('.planet-dock')).toBeHidden();
  await app.evaluate(() => globalThis.__jovianTest.switchSystem('solar'));
  await expect.poll(() => page.evaluate(() => {
    const state = window.__jovianDebug.getSnapshot();
    return state.transitioning ? null : state.activeSystemId;
  }), { timeout: 20000 }).toBe('solar');

  await app.evaluate(() => globalThis.__jovianTest.restoreControls());
  await expect(page.locator('.planet-dock')).toBeVisible();
  await expect.poll(() => app.evaluate(() => globalThis.__jovianTest.presentation())).toEqual({
    controlsHidden: false, taskbarHidden: false, desktopLayer: false, desktopLayerError: '', alwaysOnTop: true, focusable: true,
  });
  assert.ok((await app.evaluate(() => globalThis.__presentationCalls)).some(([, value]) => value === false));
  await page.screenshot({ path: path.join(output, 'restored-controls.png'), omitBackground: true });
  assert.deepEqual(errors, [], 'No renderer errors');
  await writeFile(path.join(output, 'verification.json'), JSON.stringify({ hidden, systems, errors }, null, 2));
  console.log('DESKTOP MODE, CONFIRMATION, NATIVE LAYERING, TRAY RESTORE AND SYSTEM SWITCH PASSED', output);
} catch (error) {
  console.error('Desktop mode verification failed', output, errors);
  throw error;
} finally {
  await app.close();
}

import type { Config, Result } from './config.ts';
import { freshConfig, patchedConfig, readableError, configSchema } from './config.ts';

export interface WindowState { filled: boolean }

export interface DesktopBridge {
  getConfig(): Promise<Config>;
  patch(path: string, value: unknown): Promise<Result>;
  onConfig(callback: (config: Config) => void): () => void;
  onCommand(callback: (command: string) => void): () => void;
  getWindowState(): Promise<WindowState>;
  onWindowState(callback: (state: WindowState) => void): () => void;
  toggleFillScreen(): Promise<WindowState>;
  exitFillScreen(): Promise<WindowState>;
  openSettings(): void;
  closeSettings(): void;
  minimizeSettings(): void;
  quit(): void;
  resetView(): void;
  resetConfig(): Promise<Result>;
  exportConfig(): Promise<{ ok: boolean; error?: string; canceled?: boolean }>;
  importConfig(): Promise<Result | { canceled: true }>;
  setHitTest(ignore: boolean): void;
  setDragging(dragging: boolean): void;
  moveStart(): void;
  moveEnd(): void;
  onCursor(callback: (p: { x: number; y: number }) => void): () => void;
  ready(): void;
}
declare global { interface Window { jovian?: DesktopBridge; __jovianDebug?: any } }

const channel = new BroadcastChannel('jovian-preview');
let previewConfig = freshConfig();
try { previewConfig = configSchema.parse(JSON.parse(localStorage.getItem('jovian-config') || 'null')); } catch { /* First launch. */ }
const listeners = new Set<(config: Config) => void>();
channel.onmessage = event => { const valid = configSchema.safeParse(event.data); if (valid.success) { previewConfig = valid.data; listeners.forEach(fn => fn(previewConfig)); } };
const commands = new Set<(command: string) => void>();
function setPreview(config: Config): Result {
  previewConfig = config;
  localStorage.setItem('jovian-config', JSON.stringify(config));
  channel.postMessage(config);
  listeners.forEach(fn => fn(config));
  return { ok: true, config };
}
export const desktop = !!window.jovian;
export const api: DesktopBridge = window.jovian ?? {
  getConfig: async () => previewConfig,
  patch: async (path, value) => { try { return setPreview(patchedConfig(previewConfig, path, value)); } catch (e) { return { ok: false, error: readableError(e) }; } },
  onConfig: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  onCommand: fn => { commands.add(fn); return () => { commands.delete(fn); }; },
  getWindowState: async () => ({ filled: !!document.fullscreenElement }),
  onWindowState: fn => {
    const changed = () => fn({ filled: !!document.fullscreenElement });
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  },
  toggleFillScreen: async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    return { filled: !!document.fullscreenElement };
  },
  exitFillScreen: async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    return { filled: !!document.fullscreenElement };
  },
  openSettings: () => { window.open('./settings.html', 'jovian-settings', 'width=440,height=820'); },
  closeSettings: () => window.close(), minimizeSettings: () => {}, quit: () => window.close(),
  resetView: () => commands.forEach(fn => fn('reset-view')),
  resetConfig: async () => setPreview(freshConfig()),
  exportConfig: async () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(previewConfig, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'jovian-config.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); return { ok: true };
  },
  importConfig: async () => ({ ok: false, error: '浏览器预览请使用桌面版导入配置。' }),
  setHitTest: () => {}, setDragging: () => {}, moveStart: () => {}, moveEnd: () => {},
  onCursor: () => () => {}, ready: () => {},
};

// Handle these in both renderers so the shortcuts also work while settings has focus.
if (desktop) document.addEventListener('keydown', event => {
  if (event.repeat || event.defaultPrevented) return;
  if (event.key === 'F11') { event.preventDefault(); void api.toggleFillScreen(); }
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
    event.preventDefault(); void api.exitFillScreen();
  }
});

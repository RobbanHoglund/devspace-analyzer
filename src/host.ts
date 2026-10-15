import { invoke as tauriInvoke, isTauri } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { Report } from './types';
import type { ScanScope } from './scanScope';

export type HostAction = { tab?: 'overview' | 'findings' | 'projects' | 'coverage'; scanRoots?: string[]; cancel?: boolean; availability?: string };
type Bootstrap = { roots?: string[]; protectedPaths?: string[]; includeCaches?: boolean; report?: Report; reportScope?: ScanScope; unavailable?: string };
type VSCodeAPI = { postMessage(message: unknown): void };
declare global { interface Window { acquireVsCodeApi?: () => VSCodeAPI } }

const api = window.acquireVsCodeApi?.();
export const inVSCode = !!api;
export const native = inVSCode || isTauri();
export const bootstrap: Bootstrap = inVSCode ? JSON.parse(document.getElementById('devspace-bootstrap')?.textContent ?? '{}') : {};
if (inVSCode) document.body.classList.add('devspace-vscode');
let sequence = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const listeners = new Map<string, Set<(payload: any) => void>>();
window.addEventListener('message', event => {
  if (!inVSCode || !event.data || typeof event.data !== 'object') return;
  const message = event.data;
  if (message.type === 'response' && Number.isSafeInteger(message.id)) {
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id);
    if (typeof message.error === 'string') request.reject(new Error(message.error));
    else request.resolve(message.result);
  } else if (message.type === 'event' && typeof message.name === 'string') {
    listeners.get(message.name)?.forEach(listener => listener(message.payload));
  }
});

export function invoke<T = void>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!api) return tauriInvoke<T>(command, args);
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try { api.postMessage({ type: 'request', id, command, args: args ?? {} }); }
    catch (error) { pending.delete(id); reject(error); }
  });
}
export async function listen<T>(name: string, callback: (event: { payload: T }) => void): Promise<() => void> {
  if (!api) return tauriListen<T>(name, callback);
  const wrapped = (payload: T) => callback({ payload });
  const set = listeners.get(name) ?? new Set(); set.add(wrapped); listeners.set(name, set);
  return () => { set.delete(wrapped); };
}
export async function chooseFolders(): Promise<string[] | string | null> {
  return api ? invoke<string[] | null>('choose_folders') : open({ directory: true, multiple: true, title: 'Choose developer workspace folders' });
}
export function readPreference(key: string): string[] {
  try {
    const value: unknown = inVSCode
      ? key === 'devspace.roots' ? bootstrap.roots : bootstrap.protectedPaths
      : JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length <= 32768).slice(0, 20000) : [];
  } catch { return []; }
}
export async function savePreferences(roots: string[], protectedPaths: string[], includeCaches: boolean): Promise<void> {
  if (api) await invoke('save_preferences', { roots, protectedPaths, includeCaches });
  else { localStorage.setItem('devspace.roots', JSON.stringify(roots)); localStorage.setItem('devspace.protected', JSON.stringify(protectedPaths)); }
}

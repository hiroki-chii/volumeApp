import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const isTauri = () => '__TAURI_INTERNALS__' in window;

export const volumeApi = {
  getVolume: () => (isTauri() ? invoke('get_volume') : Promise.resolve(50)),
  setVolume: (volume) => isTauri() ? invoke('set_volume', { volume }) : Promise.resolve(),
  getMute: () => (isTauri() ? invoke('get_mute') : Promise.resolve(false)),
  setMute: (muted) => isTauri() ? invoke('set_mute', { muted }) : Promise.resolve(),
  getSettings: () => (isTauri() ? invoke('get_settings') : Promise.resolve({ step: 2 })),
  setSetting: (key, value) => isTauri() ? invoke('set_setting', { key, value }) : Promise.resolve(),
  resizeWindow: (width, height) => isTauri() ? invoke('resize_window', { width, height }) : Promise.resolve(),
  setHover: (hovering) => isTauri() ? invoke('set_hover', { hovering }) : Promise.resolve(),
  onVolumeUpdated: (callback) => isTauri() ? listen('volume-updated', (event) => callback(event.payload)) : Promise.resolve(() => {}),
  onMuteUpdated: (callback) => isTauri() ? listen('mute-updated', (event) => callback(event.payload)) : Promise.resolve(() => {}),
  onOpenSettings: (callback) => isTauri() ? listen('open-settings', callback) : Promise.resolve(() => {}),
  onForceOSD: (callback) => isTauri() ? listen('force-osd', callback) : Promise.resolve(() => {}),
};

// Local storage for customization settings

import { getItem, setItem } from '@/lib/storage';
import { CustomizationState, DEFAULT_CUSTOMIZATION } from './types';

const CUSTOMIZATION_KEY = 'customization';
const CUSTOMIZATION_VERSION_KEY = 'customization_version';
// Bump to force refresh when module structure changes.
// 9 — added the Inventory 2 tile at order 3. The "ensure all default modules
// exist" merge below would have appended it at the END instead, so without this
// bump the new tile would land after Settings for anyone with saved
// customization. A bump discards local tile ordering, which is the lesser cost.
const CURRENT_VERSION = 9;

export function getCustomization(): CustomizationState {
  // Force reset if version changed (e.g. modules were restructured)
  const storedVersion = getItem<number>(CUSTOMIZATION_VERSION_KEY, 0);
  if (storedVersion < CURRENT_VERSION) {
    setItem(CUSTOMIZATION_KEY, DEFAULT_CUSTOMIZATION);
    setItem(CUSTOMIZATION_VERSION_KEY, CURRENT_VERSION);
    return DEFAULT_CUSTOMIZATION;
  }

  const stored = getItem<CustomizationState>(CUSTOMIZATION_KEY, DEFAULT_CUSTOMIZATION);
  
  // Remove modules that no longer exist in defaults
  const defaultIds = new Set(DEFAULT_CUSTOMIZATION.modules.map(m => m.id));
  stored.modules = stored.modules.filter(m => defaultIds.has(m.id));
  
  // Ensure all default modules exist (handles new modules added after initial save)
  const storedIds = new Set(stored.modules.map(m => m.id));
  const missingModules = DEFAULT_CUSTOMIZATION.modules.filter(m => !storedIds.has(m.id));
  if (missingModules.length > 0) {
    const maxOrder = Math.max(...stored.modules.map(m => m.order), -1);
    stored.modules = [
      ...stored.modules,
      ...missingModules.map((m, i) => ({ ...m, order: maxOrder + 1 + i })),
    ];
  }
  
  setItem(CUSTOMIZATION_KEY, stored);
  
  return stored;
}

export function setCustomization(state: CustomizationState): void {
  setItem(CUSTOMIZATION_KEY, state);
}

export function resetCustomization(): void {
  setItem(CUSTOMIZATION_KEY, DEFAULT_CUSTOMIZATION);
}

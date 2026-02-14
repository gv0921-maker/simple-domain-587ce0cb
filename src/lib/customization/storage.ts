// Local storage for customization settings

import { getItem, setItem } from '@/lib/storage';
import { CustomizationState, DEFAULT_CUSTOMIZATION } from './types';

const CUSTOMIZATION_KEY = 'customization';

export function getCustomization(): CustomizationState {
  const stored = getItem<CustomizationState>(CUSTOMIZATION_KEY, DEFAULT_CUSTOMIZATION);
  
  // Ensure all default modules exist (handles new modules added after initial save)
  const storedIds = new Set(stored.modules.map(m => m.id));
  const missingModules = DEFAULT_CUSTOMIZATION.modules.filter(m => !storedIds.has(m.id));
  if (missingModules.length > 0) {
    const maxOrder = Math.max(...stored.modules.map(m => m.order), -1);
    stored.modules = [
      ...stored.modules,
      ...missingModules.map((m, i) => ({ ...m, order: maxOrder + 1 + i })),
    ];
    setItem(CUSTOMIZATION_KEY, stored);
  }
  
  return stored;
}

export function setCustomization(state: CustomizationState): void {
  setItem(CUSTOMIZATION_KEY, state);
}

export function resetCustomization(): void {
  setItem(CUSTOMIZATION_KEY, DEFAULT_CUSTOMIZATION);
}

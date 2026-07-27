import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Local class merger for the design system.
 *
 * Deliberately duplicated rather than imported from `@/lib/utils` so this
 * namespace has zero inbound edges from existing feature code — the design
 * system can be rebuilt, moved, or thrown away without touching anything else.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

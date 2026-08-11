/**
 * Składanie klas Tailwinda.
 *
 * `clsx` scala warunki, `tailwind-merge` usuwa konflikty — bez niego klasa
 * przekazana z zewnątrz („chcę tu inny odstęp") przegrywałaby z domyślną
 * w zależności od kolejności w arkuszu, czyli losowo. To ta sama funkcja
 * pomocnicza, którą zakłada shadcn/ui.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

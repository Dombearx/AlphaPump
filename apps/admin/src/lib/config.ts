/**
 * Konfiguracja panelu — czytana raz, z jednego miejsca.
 *
 * Adres API wchodzi zmienną `VITE_API_BASE`. Pusta wartość znaczy dwie różne
 * rzeczy, obie właściwe: w trybie deweloperskim żądania idą przez proxy Vite
 * (`/api-proxy`), a w zbudowanym panelu — pod to samo pochodzenie, bo panel i API
 * stoją za jednym Caddym. Dzięki temu ciasteczko sesji nie jest ciasteczkiem
 * między witrynami i nie potrzebuje flag, których po HTTP nie da się ustawić.
 */

const configured = (import.meta.env.VITE_API_BASE as string | undefined)?.trim() ?? '';

export const apiBase: string =
  configured.length > 0 ? configured : import.meta.env.DEV ? '/api-proxy' : '';

/** Adres, pod którym better-auth obsługuje logowanie i sesję. */
export const authBase = `${apiBase}/api/auth`;

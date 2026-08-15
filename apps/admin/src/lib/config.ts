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

/**
 * Adres, pod którym better-auth obsługuje logowanie i sesję.
 *
 * **Bezwzględny**, w odróżnieniu od `apiBase` wyżej. Zwykłe żądania panelu jadą
 * ścieżką względną i tak ma zostać — to ona daje jedno pochodzenie. Ale klient
 * better-autha waliduje swój `baseURL` konstruktorem `URL` i ścieżkę względną
 * odrzuca wyjątkiem („Invalid base URL"), rzucanym **przy tworzeniu klienta**,
 * czyli przy ładowaniu modułu. Efektem jest pusta strona, zanim cokolwiek się
 * wyrenderuje — awaria widoczna dopiero w przeglądarce, bo `vite build` nie
 * wykonuje kodu, a testy panelu nie renderują komponentów.
 *
 * Doklejenie `origin` nie zmienia pochodzenia żądań: `window.location.origin`
 * jest z definicji tym samym hostem, z którego panel się załadował.
 *
 * Wartość zapasowa dla środowiska bez `window` (testy w Node) nie jest nigdy
 * używana do wysłania żądania — moduł auth ładuje się wyłącznie w przeglądarce.
 */
const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;

export const authBase = `${origin}${apiBase}/api/auth`;

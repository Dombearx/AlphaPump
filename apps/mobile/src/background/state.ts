/**
 * Tapeta aplikacji — reguły wyboru zdjęcia i rejestr na dysku.
 *
 * Ten plik jest czysty: nie dotyka ani systemu plików, ani Expo. Warstwa
 * natywna siedzi w `expo.ts`, a ekran w `../ui/background.tsx`. Dzięki temu
 * jedyne decyzje, jakie tu zapadają — co wolno wgrać, jak nazwać plik i co
 * znaczy uszkodzony rejestr — mają testy chodzące w Node.
 *
 * Zgłoszenie nie ustaliło ani formatów, ani limitu rozmiaru, więc dobieramy je
 * tutaj: JPG i PNG, bo tyle oddaje aparat i zrzut ekranu, oraz 8 MiB, czyli
 * powyżej zdjęcia z telefonu, a poniżej pliku, którego rozpakowanie do rozmiaru
 * ekranu potrafi zjeść pamięć procesu.
 */

import { z } from 'zod';

export const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;

/** Typy MIME podsuwane systemowemu wyborowi pliku. */
export const BACKGROUND_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

/** Tyle wie warstwa reguł o wybranym zdjęciu: nazwa, typ i rozmiar. */
export interface PickedImage {
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

const stateSchema = z.object({
  /** Nazwa pliku tapety w katalogu aplikacji; `null` znaczy tło domyślne. */
  file: z.string().nullable(),
  /**
   * Numer kolejnej tapety. Nie jest ozdobą: gdyby każde zdjęcie lądowało pod tą
   * samą nazwą, drugie miałoby ten sam adres co pierwsze, a React Native
   * pokazałby obraz z pamięci podręcznej zamiast nowo wybranego.
   */
  revision: z.number().int().nonnegative(),
});

export type BackgroundState = z.infer<typeof stateSchema>;

export const EMPTY_BACKGROUND_STATE: BackgroundState = { file: null, revision: 0 };

/**
 * Nieczytelny rejestr znaczy tło domyślne, a nie błąd — inaczej niż przy
 * eksporcie do FitNotesa, gdzie zgadywanie kosztuje duplikat całej historii.
 * Tu najgorsze, co się stanie, to że użytkownik wskaże zdjęcie jeszcze raz.
 */
export function parseBackgroundState(raw: string): BackgroundState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_BACKGROUND_STATE;
  }

  const result = stateSchema.safeParse(parsed);
  return result.success ? result.data : EMPTY_BACKGROUND_STATE;
}

export function serializeBackgroundState(state: BackgroundState): string {
  return JSON.stringify(state);
}

/**
 * Rozszerzenie pliku tapety albo `null`, jeśli to nie jest obsługiwany obraz.
 *
 * Typ MIME rozstrzyga pierwszy, ale nie ostatni: dostawcy treści na Androidzie
 * potrafią oddać `application/octet-stream` albo nic, i wtedy jedyną informacją
 * o formacie jest nazwa pliku.
 */
function extensionOf(picked: PickedImage): string | null {
  const mimeType = picked.mimeType?.toLowerCase() ?? '';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';

  const name = picked.name.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpg';
  if (name.endsWith('.png')) return 'png';
  return null;
}

/** Powód odmowy do pokazania na ekranie albo `null`, gdy zdjęcie jest w porządku. */
export function backgroundProblem(picked: PickedImage): string | null {
  if (extensionOf(picked) === null) {
    return 'That file is not a JPG or PNG image — pick a photo.';
  }

  const size = picked.size ?? 0;
  if (size > MAX_BACKGROUND_BYTES) {
    return `That image is ${megabytes(size)} MB and the limit is ${megabytes(MAX_BACKGROUND_BYTES)} MB — pick a smaller one.`;
  }

  return null;
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Rejestr po wskazaniu zdjęcia. Woła się go **po** `backgroundProblem` — na
 * pliku, którego reguły nie przepuściły, rzuca, zamiast zapisać byle co.
 */
export function withPickedBackground(
  state: BackgroundState,
  picked: PickedImage,
): BackgroundState & { file: string } {
  const extension = extensionOf(picked);
  const problem = backgroundProblem(picked);
  if (problem !== null || extension === null) throw new Error(problem ?? 'Unsupported image.');

  const revision = state.revision + 1;
  return { file: `background-${String(revision)}.${extension}`, revision };
}

/** Rejestr po „Use the default background". Numer zostaje, żeby nazwy się nie powtarzały. */
export function withDefaultBackground(state: BackgroundState): BackgroundState {
  return { file: null, revision: state.revision };
}

/**
 * Wejście do warstwy natywnej widziane przez interfejs.
 *
 * Korzeń aplikacji wstrzykuje implementację z `expo.ts`, a testy — atrapę.
 * Dlatego `provider.tsx` nie importuje niczego z Expo i daje się wyrenderować
 * poza telefonem.
 */
export interface BackgroundStore {
  /** Adres zapisanej tapety albo `null`, gdy obowiązuje tło domyślne. */
  read: () => Promise<string | null>;
  /**
   * Prosi o zdjęcie i zapisuje je. `null` znaczy „użytkownik zrezygnował" —
   * to nie jest błąd i nie ma o czym mówić na ekranie. Odrzucony plik (zły
   * format, za duży) leci wyjątkiem z gotowym komunikatem.
   */
  pick: () => Promise<string | null>;
  /** Kasuje tapetę i wraca do tła domyślnego. */
  clear: () => Promise<void>;
}

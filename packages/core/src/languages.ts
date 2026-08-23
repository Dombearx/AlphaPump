/**
 * Języki interfejsu i wielojęzyczne nazwy tagów oraz ćwiczeń.
 *
 * Nazwa encji zostaje tam, gdzie była: kolumna `name` dalej jest **nazwą
 * kanoniczną** — to z niej liczy się slug i identyfikator, więc tłumaczenie nie
 * ma prawa jej ruszyć. Gdyby id zależało od języka, ten sam tag utworzony po
 * polsku i po angielsku byłby dwoma wierszami, a cała deduplikacja offline
 * przestałaby działać.
 *
 * Tłumaczenia leżą obok, w jednym polu `translations`: mapa „kod języka →
 * nazwa". Jedno pole, a nie kolumna na język, bo języków ma z czasem przybywać,
 * a każda kolumna to migracja w dwóch dialektach i dziewięć miejsc z listy
 * kontrolnej `packages/db/DODAWANIE-KOLUMNY.md`.
 *
 * Brak tłumaczenia nie jest błędem: `localizedName` cofa się wtedy do nazwy
 * kanonicznej. Dzięki temu wiersz sprzed tej zmiany, wiersz utworzony offline
 * i wiersz, którego automat nie zdążył przetłumaczyć, wyglądają na ekranie tak
 * samo jak wcześniej, zamiast pokazywać pustą pozycję.
 */

/** Języki obsługiwane na start. Kody dwuliterowe, bo tak wyglądają w ustawieniach. */
export const LANGUAGES = ['en', 'pl'] as const;

export type Language = (typeof LANGUAGES)[number];

/**
 * Język, w którym pisane są nazwy wbudowane i do którego cofa się interfejs bez
 * zapisanego wyboru. Angielski, bo w tym języku jest cała biblioteka startowa.
 */
export const DEFAULT_LANGUAGE: Language = 'en';

/** Nazwy encji w poszczególnych językach; komplet nie jest wymagany. */
export type Translations = Partial<Record<Language, string>>;

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Encja z nazwą kanoniczną i opcjonalnym zestawem tłumaczeń — tag albo ćwiczenie. */
export interface Translatable {
  name: string;
  translations: Translations | null;
}

/**
 * Nazwa do pokazania. Kolejność jest zamierzona: tłumaczenie na wybrany język,
 * a jak go nie ma — nazwa kanoniczna. Nie schodzimy po drodze na inny język,
 * bo „polski, a jak nie ma, to niemiecki" jest gorszym wynikiem niż nazwa
 * oryginalna, którą użytkownik sam wpisał.
 */
export function localizedName(entity: Translatable, language: Language): string {
  const translated = entity.translations?.[language];
  return translated !== undefined && translated.trim().length > 0 ? translated : entity.name;
}

/** Języki, dla których nazwy jeszcze nie ma — czyli te do uzupełnienia automatem. */
export function missingLanguages(translations: Translations | null): Language[] {
  return LANGUAGES.filter((language) => {
    const name = translations?.[language];
    return name === undefined || name.trim().length === 0;
  });
}

/**
 * Domknięcie zestawu tłumaczeń o te, które przyszły z automatu.
 *
 * Wpisane ręcznie ma pierwszeństwo: automat uzupełnia wyłącznie luki, więc
 * powtórne uruchomienie tłumaczenia nie nadpisze nazwy podanej przez
 * użytkownika. Puste i same białe znaki są odrzucane — model potrafi oddać
 * pusty napis, a ten na ekranie wygląda jak zgubiona nazwa.
 */
export function mergeTranslations(
  current: Translations | null,
  incoming: Translations | null,
): Translations | null {
  const merged: Translations = {};

  for (const language of LANGUAGES) {
    const name = current?.[language] ?? incoming?.[language];
    if (name !== undefined && name.trim().length > 0) merged[language] = name.trim();
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

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

import { z } from 'zod';
import { slug } from './slug.js';

/** Języki obsługiwane na start. Kody dwuliterowe, bo tak wyglądają w ustawieniach. */
export const LANGUAGES = ['en', 'pl'] as const;

export type Language = (typeof LANGUAGES)[number];

export const languageSchema = z.enum(LANGUAGES);

/**
 * Nazwy języków **w nich samych**, a nie po polsku ani po angielsku.
 *
 * Przełącznik w menu czyta ktoś, kto szuka swojego języka — „Polski" znajdzie
 * także wtedy, gdy aplikacja stoi akurat po angielsku, a „Polish" już nie.
 */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  pl: 'Polski',
};

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

/**
 * Czy dwa zestawy tłumaczeń niosą to samo.
 *
 * Potrzebne przy zapisie, a nie przy wyświetlaniu: zapis, który niczego nie
 * zmienia, podbiłby `updated_at` i wysłał wiersz na wszystkie urządzenia — a to
 * przy synchronizacji nie jest kosmetyką, tylko wygraną w rozstrzyganiu remisów
 * z wersją, którą telefon ma u siebie.
 *
 * Porównanie idzie po języku i po nazwie **przyciętej**, bo tak samo zapisuje je
 * `mergeTranslations`: „ klatka " i „klatka" to dla bazy ta sama nazwa.
 */
export function sameTranslations(left: Translations | null, right: Translations | null): boolean {
  return LANGUAGES.every((language) => {
    const a = left?.[language]?.trim() ?? '';
    const b = right?.[language]?.trim() ?? '';
    return a === b;
  });
}

/* ------------------------------------------------- tłumaczenie automatyczne */

/**
 * Odpowiedź modelu tłumaczącego nazwę — structured output.
 *
 * Lista par „język → nazwa", a nie obiekt z polami `en` i `pl`, i jest to
 * decyzja: obiekt trzeba by rozszerzać w schemacie przy każdym nowym języku,
 * a lista opisuje dokładnie to, o co pytamy — komplet brakujących języków
 * podany w prompcie.
 *
 * Schemat celowo **nie** wymusza niepustych nazw ani kompletu języków. Wymuszony
 * komplet zamieniałby model, który nie zna jednej nazwy, w błąd całego
 * wywołania; puste i nadmiarowe odsiewa `translationsFromModel`, bo to jest
 * czyszczenie danych, a nie walidacja protokołu.
 */
export const translationResultSchema = z.object({
  names: z.array(z.object({ language: languageSchema, name: z.string() })),
});

export type TranslationResult = z.infer<typeof translationResultSchema>;

/**
 * Odpowiedź modelu sprowadzona do zestawu tłumaczeń.
 *
 * Funkcja jest czysta i **odporna na model** — z tego samego powodu, dla
 * którego odporne jest nakładanie werdyktów re-rankera: odpowiedź LLM-a jest
 * danymi z zewnątrz także wtedy, gdy przeszła schemat. Model potrafi oddać
 * pusty napis, powtórzyć język albo dołożyć taki, o który nie pytaliśmy.
 *
 * - puste, same białe znaki i sama interpunkcja (bez jednej litery lub cyfry)
 *   lecą do kosza — na ekranie wyglądają jak zgubiona nazwa, a `localizedName`
 *   i tak cofnąłby się wtedy do nazwy kanonicznej. Ta sama reguła co
 *   `displayNameSchema`: `translations` wchodzi do `syncPullResponseSchema`
 *   bez dodatkowej walidacji przy zapisie, więc nazwa, której slug jest pusty,
 *   nie zepsuje pullu tylko dlatego, że nie przeszła tędy.
 * - przy powtórzonym języku wygrywa **pierwsza** nazwa: druga jest poprawką
 *   modelu do samego siebie, a nie nową informacją,
 * - `wanted` przycina odpowiedź do języków, o które pytaliśmy — inaczej model
 *   dopisałby tłumaczenie tam, gdzie stoi nazwa wpisana ręcznie.
 */
export function translationsFromModel(
  result: TranslationResult,
  wanted: readonly Language[],
): Translations {
  const allowed = new Set(wanted);
  const translations: Translations = {};

  for (const entry of result.names) {
    if (!allowed.has(entry.language)) continue;
    if (translations[entry.language] !== undefined) continue;

    const name = entry.name.trim();
    if (name.length === 0) continue;
    if (slug(name).length === 0) continue;

    translations[entry.language] = name;
  }

  return translations;
}

/**
 * Animacja zwycięstwa — reguła odpalenia i choreografia wybuchu.
 *
 * Zgłoszenie prosi o jedno: przy zapisie serii ma być pole „więcej niż mason",
 * a po zaznaczeniu go i zapisaniu serii — przerysowana, hałaśliwa animacja
 * triumfu. Tutaj siedzi ta część, w której da się popełnić błąd niewidoczny na
 * ekranie: **kiedy** animacja leci i z czego składa się wybuch. Sam overlay jest
 * w `src/ui/victory.tsx` i nic już nie rozstrzyga.
 *
 * Nazwa pola została przepisana ze zgłoszenia znak w znak i dlatego jest po
 * polsku, choć reszta interfejsu jest po angielsku: „więcej niż mason" to żart
 * z rozmowy, który po przetłumaczeniu przestaje być czymkolwiek. Z tego samego
 * powodu po polsku są okrzyki.
 *
 * Czego tu nie ma: dźwięku. Fanfary są narysowane, a nie zagrane — animacja leci
 * na siłowni, gdzie telefon prawie zawsze jest wyciszony, a dodanie pliku audio
 * znaczyłoby pakowanie zasobu do aplikacji dla efektu, którego nikt nie usłyszy.
 */

import type { SetFormAction } from './set-form';

/** Etykieta pola przy formularzu serii. Przepisana ze zgłoszenia. */
export const VICTORY_LABEL = 'więcej niż mason';

/** Nagłówek overlayu — to samo zdanie, krzyczane. */
export const VICTORY_HEADLINE = 'WIĘCEJ NIŻ MASON!';

/**
 * Ile overlay stoi na ekranie, zanim zejdzie sam.
 *
 * Schodzi sam, bo cały ten ekran stoi na wymaganiu „możliwie najmniejsza liczba
 * kroków do zapisania serii" — animacja zamykana tapnięciem dokładałaby krok do
 * każdej udanej serii. Tapnięcie i tak zamyka ją od razu, dla kogoś, kto jest
 * w połowie następnego podejścia.
 */
export const VICTORY_MS = 2600;

/** Przez ile pierwszych milisekund dosypują się kolejne glify wybuchu. */
export const VICTORY_BURST_MS = 900;

/** Ile glifów leci z wybuchu. Tyle, żeby okrąg był pełny, a nie zatłoczony. */
export const VICTORY_SPARK_COUNT = 12;

/** Fajerwerki, fanfary i resztę triumfu nosi ten zestaw glifów. */
const SPARK_GLYPHS = ['🎆', '🎺', '💥', '🔥', '💪', '🏆', '🎇', '⚡'] as const;

/**
 * Okrzyki. Lecą po kolei, a nie losowo: dwa takie same pod rząd zdradzają, że
 * to jeden napis na sztywno, a losowanie i tak je od czasu do czasu powtórzy.
 */
const SHOUTS = [
  'Mason zmiażdżony. Sztanga płacze.',
  'Grawitacja złożyła wniosek o urlop.',
  'To nie było powtórzenie. To był wyrok.',
  'Hantle drżą na twój widok.',
  'Mason właśnie zmienił siłownię.',
  'Ławka pękła, rekord padł, legenda rośnie.',
] as const;

/**
 * Czy po tym zapisie leci animacja.
 *
 * Dwa warunki i oba są wymaganiem ze zgłoszenia: pole musi być zaznaczone, a
 * zapis musi być **dopisaniem** serii. Poprawianie zapisanej wcześniej serii
 * nie jest zwycięstwem, a usuwanie tym bardziej — stąd `SetFormAction`, a nie
 * samo „udało się zapisać". Reszta warunku („po pomyślnym zapisie") jest
 * w miejscu wywołania: funkcja jest pytana na ścieżce sukcesu, po tym, jak
 * seria już leży w bazie.
 */
export function victoryFires(action: SetFormAction, claimed: boolean): boolean {
  return claimed && action === 'create';
}

/** Kolejny okrzyk. `round` rośnie z każdą animacją i może iść w nieskończoność. */
export function victoryShout(round: number): string {
  const index = Math.abs(Math.trunc(round)) % SHOUTS.length;
  return SHOUTS[index] ?? SHOUTS[0];
}

export interface VictorySpark {
  glyph: string;
  /** Kąt na okręgu w stopniach: 0 to w górę, rośnie zgodnie z ruchem zegara. */
  angle: number;
  /** Jak daleko od środka, w ułamku promienia wybuchu. */
  radiusRatio: number;
  /** Opóźnienie wejścia tego glifu, w milisekundach od początku animacji. */
  delayMs: number;
}

/**
 * Glify wybuchu: równo po okręgu, co drugi bliżej środka i każdy o chwilę
 * później od poprzedniego.
 *
 * Opóźnienia zaczynają się **powyżej** zera, bo overlay przelicza je na okna
 * w jednej pętli animacji, a okno zaczynające się dokładnie w zerze nie dałoby
 * rosnącego zakresu wejściowego interpolacji.
 */
export function victorySparks(count: number = VICTORY_SPARK_COUNT): VictorySpark[] {
  const step = VICTORY_BURST_MS / (count + 1);

  return Array.from({ length: count }, (_, index) => ({
    glyph: SPARK_GLYPHS[index % SPARK_GLYPHS.length] ?? SPARK_GLYPHS[0],
    angle: Math.round((index * 360) / count),
    radiusRatio: index % 2 === 0 ? 1 : 0.66,
    delayMs: Math.round((index + 1) * step),
  }));
}

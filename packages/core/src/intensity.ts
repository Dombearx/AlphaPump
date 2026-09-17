/**
 * Intensywność wysiłku — niska, umiarkowana, wysoka.
 *
 * ## Dlaczego pole ćwiczenia, a nie tag
 *
 * Intensywność jest cechą **ćwiczenia**, tak samo jak typ logowania i tag
 * główny: marsz jest lekki, a interwały są ciężkie niezależnie od tego, w którym
 * dniu zostały zapisane. Tag dodatkowy tej roli nie udźwignie, bo tagi dodatkowe
 * są z założenia etykietami do przeglądania biblioteki i **nie zaliczają serii
 * do cykli** (patrz `cycles.ts`) — cel oparty o taki tag liczyłby zero. Tag
 * główny też odpada: jest jeden i decyduje o partii mięśniowej, więc „biceps"
 * musiałby ustąpić miejsca „wysokiej intensywności".
 *
 * Klasyfikacji z samych pomiarów serii zrobić się nie da: aplikacja nie zbiera
 * tętna ani mocy, a czas i dystans mówią o objętości, nie o wysiłku — te same
 * pięć kilometrów bywa spacerem i biegiem.
 *
 * `null` znaczy „nieokreślona" i jest stanem domyślnym: biblioteka istniała
 * przed tym polem, a większość ćwiczeń siłowych nie ma sensownej odpowiedzi.
 * Ćwiczenie nieokreślone nie zasila żadnego celu intensywnościowego.
 *
 * ## Równoważność WHO
 *
 * Wytyczne WHO liczą minutę wysiłku wysokiej intensywności za **dwie** minuty
 * umiarkowanego — stąd „150 minut umiarkowanego **albo** 75 minut wysokiego
 * **albo** równoważna kombinacja". `intensityWeight` jest zapisem dokładnie tej
 * reguły, dzięki czemu cały warunek WHO mieści się w jednej pozycji celu,
 * zamiast rozpadać się na dwa progi wymagane naraz.
 */

export const INTENSITIES = ['low', 'moderate', 'high'] as const;

export type Intensity = (typeof INTENSITIES)[number];

export function isIntensity(value: unknown): value is Intensity {
  return typeof value === 'string' && (INTENSITIES as readonly string[]).includes(value);
}

/**
 * Ile wysiłek o intensywności `exercise` wnosi do celu o intensywności `goal`.
 *
 * Wiersz „umiarkowana" niesie równoważność WHO: wysiłek wysokiej intensywności
 * liczy się podwójnie. Pozostałe wiersze celowo nie kumulują niczego z dołu ani
 * z góry — cel „wysoka" ma pokazywać wyłącznie wysiłek wysoki, a cel „niska"
 * wyłącznie niski, bo inaczej trzy poziomy przestałyby być rozróżnialne.
 *
 * Aktywność lekka nie ma w wytycznych WHO żadnego przelicznika na umiarkowaną
 * (i żadnego progu tygodniowego) — dlatego zeruje się w obu wyższych celach,
 * zamiast dostać wagę wymyśloną na potrzeby tej tabeli.
 */
const INTENSITY_WEIGHTS: Readonly<Record<Intensity, Readonly<Record<Intensity, number>>>> = {
  low: { low: 1, moderate: 0, high: 0 },
  moderate: { low: 0, moderate: 1, high: 2 },
  high: { low: 0, moderate: 0, high: 1 },
};

export function intensityWeight(goal: Intensity, exercise: Intensity | null): number {
  return exercise === null ? 0 : INTENSITY_WEIGHTS[goal][exercise];
}

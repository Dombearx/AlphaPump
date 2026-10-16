/**
 * Dane wykresu frontu Pareto rekordów jednego ćwiczenia.
 *
 * Wykres słupkowy obok (`chart-data.ts`) odpowiada na pytanie „czy idzie
 * w górę" — jedna metryka w czasie. Rekordy nie są jedną metryką: front Pareto
 * sprawia, że 15 kg × 10 i 10 kg × 20 są rekordami równocześnie, a lista
 * rekordów na ekranie serii pokazuje to jako wiersze bez żadnego kształtu.
 * Ten moduł układa je w dwóch wymiarach — oś rekordu na oś wykresu — więc
 * widać od razu, gdzie front jest wysoki, gdzie szeroki i których kombinacji
 * jeszcze nie było.
 *
 * O tym, co jest rekordem, rozstrzyga `computeRecords` z `@alphapump/core`,
 * czyli dokładnie ten sam front Pareto, który liczy rekordy po zapisaniu serii.
 * Drugiej definicji tu nie ma i być nie może: wykres pokazujący inny front niż
 * komunikat „rekord!" byłby gorszy niż brak wykresu.
 *
 * Moduł jest czysty — dostaje serie z bazy lokalnej i oddaje gotowe punkty,
 * więc wykres jest odczytem działającym bez sieci.
 */

import {
  compareSetsChronologically,
  computeRecords,
  projectSet,
  recordAxes,
  type ChronologicalSet,
  type LoggingType,
  type SetMeasurements,
} from '@alphapump/core';
import { axisMetric, type ChartMetric } from './chart-data';

/**
 * Osie wykresu. Pierwsza oś rekordu idzie w pionie, druga w poziomie — czyli
 * ciężar do góry, powtórzenia albo czas w prawo, bo tak czyta się serię
 * („80 kg × 8"). Metryki są te same, co na wykresie słupkowym, żeby etykieta
 * i jednostka znaczyły w obu miejscach to samo.
 */
export interface ParetoScatterAxes {
  y: ChartMetric;
  x: ChartMetric;
}

/** Zakres osi — tym jest podpisany wykres i według tego skalują się punkty. */
export interface ParetoScatterRange {
  min: number;
  max: number;
}

export interface ParetoScatterPoint<T> {
  /** Najstarsza seria z tym wynikiem — remis przypisujemy tej, która padła pierwsza. */
  set: T;
  /** Wartość osi poziomej (druga oś rekordu). */
  x: number;
  /** Wartość osi pionowej (pierwsza oś rekordu). */
  y: number;
  /** Położenie w prostokącie wykresu: 0–1 od lewej i od dołu. */
  xRatio: number;
  yRatio: number;
  /** Czy punkt leży na froncie Pareto, czyli czy ten wynik jest rekordem. */
  isRecord: boolean;
  /** Ile serii wypadło dokładnie w tym punkcie. */
  sets: number;
}

export interface ParetoScatter<T> {
  axes: ParetoScatterAxes;
  /** Wszystkie wyniki, po jednym punkcie na niepowtarzający się wynik. */
  points: ParetoScatterPoint<T>[];
  /**
   * Sam front, od lewej do prawej. Jest schodkiem: dwa punkty o tej samej
   * wartości na jednej osi nie mogą być oba rekordami, więc wraz z `x` rosnącym
   * `y` maleje — i dlatego front da się narysować jedną łamaną.
   */
  front: ParetoScatterPoint<T>[];
  xRange: ParetoScatterRange;
  yRange: ParetoScatterRange;
}

/**
 * Osie dla typu logowania albo `null`, gdy rekordy tego ćwiczenia mają tylko
 * jedną oś (ćwiczenia z własną masą ciała). Tam front Pareto jest jednym
 * punktem — najlepszym wynikiem — i wykres dwuwymiarowy nie pokazywałby niczego
 * poza nim.
 */
export function paretoScatterAxes(loggingType: LoggingType): ParetoScatterAxes | null {
  const [vertical, horizontal] = recordAxes(loggingType);
  if (vertical === undefined || horizontal === undefined) return null;
  return { y: axisMetric(vertical), x: axisMetric(horizontal) };
}

/** Klucz wyniku — dwie serie o równych osiach rekordu to jeden punkt wykresu. */
function resultKey(point: readonly number[]): string {
  return point.join('|');
}

function rangeOf(values: readonly number[]): ParetoScatterRange {
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Położenie wartości w zakresie osi. Skala zaczyna się od najmniejszego wyniku,
 * a nie od zera: przy 60–100 kg i 1–12 powtórzeniach zero zdusiłoby wszystkie
 * punkty w jednym narożniku. Zakres zerowej szerokości (jeden wynik albo jedna
 * wartość na osi) idzie na środek.
 */
function ratioIn(range: ParetoScatterRange, value: number): number {
  const span = range.max - range.min;
  return span === 0 ? 0.5 : (value - range.min) / span;
}

/**
 * Punkty wykresu frontu Pareto. `null` znaczy „nie ma czego rysować": albo
 * ćwiczenie ma jednoosiowe rekordy, albo nie ma ani jednej serii z kompletem
 * pomiarów — takie serie nie biorą udziału w rekordach, więc nie ma ich też
 * na wykresie.
 */
export function paretoScatter<T extends SetMeasurements & ChronologicalSet>(
  loggingType: LoggingType,
  sets: readonly T[],
): ParetoScatter<T> | null {
  const axes = paretoScatterAxes(loggingType);
  if (axes === null) return null;

  const chronological = [...sets].sort(compareSetsChronologically);

  const recordKeys = new Set(
    computeRecords(loggingType, chronological).map((set) =>
      resultKey(projectSet(loggingType, set) ?? []),
    ),
  );

  /** Wyniki bez powtórzeń, z serią, która ten wynik osiągnęła najwcześniej. */
  const results = new Map<string, { set: T; point: readonly number[]; sets: number }>();
  for (const set of chronological) {
    const point = projectSet(loggingType, set);
    if (point === null) continue;

    const existing = results.get(resultKey(point));
    if (existing === undefined) results.set(resultKey(point), { set, point, sets: 1 });
    else existing.sets += 1;
  }
  if (results.size === 0) return null;

  const results2d = [...results.values()].map((result) => ({
    set: result.set,
    sets: result.sets,
    y: result.point[0] as number,
    x: result.point[1] as number,
    isRecord: recordKeys.has(resultKey(result.point)),
  }));

  const xRange = rangeOf(results2d.map((result) => result.x));
  const yRange = rangeOf(results2d.map((result) => result.y));

  const points = results2d
    .map((result) => ({
      ...result,
      xRatio: ratioIn(xRange, result.x),
      yRatio: ratioIn(yRange, result.y),
    }))
    .sort((a, b) => a.x - b.x || a.y - b.y);

  return { axes, points, front: points.filter((point) => point.isRecord), xRange, yRange };
}

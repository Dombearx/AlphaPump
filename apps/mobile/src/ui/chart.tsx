/**
 * Wykresy — słupkowy i front Pareto rekordów.
 *
 * Narysowane zwykłymi `View`, bez biblioteki wykresów i bez SVG. To nie jest
 * oszczędność: każda z tych bibliotek dokłada moduł natywny, czyli kolejną
 * rzecz do zbudowania przy każdej kompilacji na obie platformy — a specyfikacja
 * mówi o „prostych, minimalistycznych wykresach", nie o dashboardzie. Słupek
 * o wysokości proporcjonalnej do wartości oddaje dokładnie to, po co się na ten
 * ekran wchodzi: czy z tygodnia na tydzień idzie w górę.
 *
 * Komponenty nic nie liczą poza położeniem w ramce — punkty przygotowują
 * `chart-data.ts` i `pareto-chart.ts`, czyste i przetestowane osobno.
 */

import { Text, View, type ViewStyle } from 'react-native';
import type { ChartPoint } from '../chart-data';
import type { ParetoScatter, ParetoScatterPoint } from '../pareto-chart';
import { COLORS } from '../theme';

/** Wysokość rysunku; słupki skalują się do najwyższej wartości w zestawie. */
const CHART_HEIGHT = 160;

/** Miejsce nad najwyższym słupkiem na liczbę — inaczej etykieta by się ucinała. */
const VALUE_LABEL_SPACE = 18;

/** Najniższy widoczny słupek — zero pikseli wyglądałoby jak brak danych. */
const MINIMUM_BAR = 0.04;

export interface BarChartProps {
  points: readonly ChartPoint[];
  /** Największa wartość w zestawie; przekazana z zewnątrz, bo widać ją też w podpisie. */
  max: number;
  /** Wartość w postaci gotowej do pokazania — zależy od metryki, nie od wykresu. */
  format: (value: number) => string;
  /** Krótka etykieta dnia pod słupkiem. */
  labelOf: (point: ChartPoint) => string;
}

export function BarChart({ points, max, format, labelOf }: BarChartProps) {
  if (points.length === 0 || max <= 0) return null;

  return (
    <View className="gap-2">
      <View className="flex-row items-end gap-1" style={{ height: CHART_HEIGHT }}>
        {points.map((point) => {
          const ratio = Math.max(point.value / max, MINIMUM_BAR);
          const highest = point.value === max;

          return (
            <View key={point.day} className="flex-1 items-center justify-end gap-1">
              <Text
                numberOfLines={1}
                className={`text-[10px] font-semibold ${highest ? 'text-success' : 'text-text'}`}
              >
                {format(point.value)}
              </Text>
              <View
                accessibilityLabel={`${point.day}: ${format(point.value)}`}
                className={`w-full rounded-t-md ${highest ? 'bg-success' : 'bg-accent'}`}
                style={{ height: Math.round(ratio * (CHART_HEIGHT - VALUE_LABEL_SPACE)) }}
              />
            </View>
          );
        })}
      </View>

      {/* Podpisy stoją poza rzędem słupków, żeby nie zmieniały ich wysokości. */}
      <View className="flex-row gap-1">
        {points.map((point) => (
          <Text
            key={point.day}
            numberOfLines={1}
            className="flex-1 text-center text-[9px] text-muted"
          >
            {labelOf(point)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/* ----------------------------------------------------------- front Pareto */

/** Wysokość ramki wykresu rekordów — kwadratowa na telefonie i bez przewijania. */
const SCATTER_HEIGHT = 200;

/** Rekord jest kropką większą i w kolorze, wynik zbity — mniejszą i szarą. */
const RECORD_DOT = 12;
const BEATEN_DOT = 7;

/** Grubość łamanej frontu. */
const FRONT_LINE = 1;

export interface ParetoChartProps<T> {
  scatter: ParetoScatter<T>;
  /** Wynik punktu po ludzku — ten sam napis, co na liście rekordów. */
  labelOf: (point: ParetoScatterPoint<T>) => string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
}

/**
 * Front Pareto rekordów: każdy wynik jako kropka w dwóch osiach rekordu, front
 * wyróżniony kolorem i spięty łamaną.
 *
 * Łamana jest schodkiem, a nie odcinkami między kropkami, bo front Pareto
 * schodkiem **jest**: między 100 kg × 5 a 80 kg × 12 nie ma żadnego wyniku,
 * który byłby rekordem, i ukośna kreska obiecywałaby coś, czego nie ma.
 */
export function ParetoChart<T extends { id: string }>({
  scatter,
  labelOf,
  formatX,
  formatY,
}: ParetoChartProps<T>) {
  const { axes, points, front, xRange, yRange } = scatter;

  return (
    <View className="gap-2">
      <Text className="text-xs text-muted">
        {axes.y.label} ↑ · {axes.x.label} →
      </Text>

      <View className="flex-row gap-2">
        {/* Skala zaczyna się od najmniejszego wyniku, nie od zera — bez tych
            dwóch liczb nie wiadomo, co znaczy dół ramki. */}
        <View className="justify-between" style={{ height: SCATTER_HEIGHT }}>
          <Text className="text-[9px] text-muted">{formatY(yRange.max)}</Text>
          {yRange.min !== yRange.max && (
            <Text className="text-[9px] text-muted">{formatY(yRange.min)}</Text>
          )}
        </View>

        <View className="flex-1 gap-1">
          <View
            className="rounded-md border border-border"
            style={{ height: SCATTER_HEIGHT, padding: RECORD_DOT / 2 }}
          >
            <View className="flex-1">
              {stairs(front).map((segment) => (
                <View
                  key={segment.key}
                  className="absolute"
                  style={{ ...segment.style, backgroundColor: COLORS.success, opacity: 0.5 }}
                />
              ))}

              {/* Rekordy na końcu, czyli na wierzchu: przy gęstej historii
                  kropka zbitego wyniku stoi tuż obok rekordowej. */}
              {[...points.filter((point) => !point.isRecord), ...front].map((point) => {
                const size = point.isRecord ? RECORD_DOT : BEATEN_DOT;

                return (
                  <View
                    key={point.set.id}
                    accessibilityLabel={describePoint(point, labelOf(point))}
                    className={`absolute ${point.isRecord ? 'bg-success' : 'bg-border'}`}
                    style={{
                      left: percent(point.xRatio),
                      bottom: percent(point.yRatio),
                      width: size,
                      height: size,
                      borderRadius: size / 2,
                      transform: [{ translateX: -size / 2 }, { translateY: size / 2 }],
                    }}
                  />
                );
              })}
            </View>
          </View>

          <View className="flex-row justify-between">
            <Text className="text-[9px] text-muted">{formatX(xRange.min)}</Text>
            {xRange.min !== xRange.max && (
              <Text className="text-[9px] text-muted">{formatX(xRange.max)}</Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

/** Opis kropki dla czytnika ekranu — na wykresie bez napisów to cała jej treść. */
function describePoint<T>(point: ParetoScatterPoint<T>, result: string): string {
  const sets = point.sets === 1 ? '1 set' : `${String(point.sets)} sets`;
  return `${result} — ${point.isRecord ? 'record' : 'beaten'}, ${sets}`;
}

/** Procent jako napis — tego oczekuje `left`/`bottom` przy pozycji względnej ramki. */
function percent(ratio: number): `${number}%` {
  return `${Math.round(ratio * 1000) / 10}%`;
}

/**
 * Schodek frontu: od punktu wyżej w prawo, na jego wysokości, a potem w dół do
 * następnego. Front przychodzi posortowany po osi X rosnąco, a więc po osi Y
 * malejąco — dlatego wystarczy jedno przejście parami.
 */
function stairs<T>(front: readonly ParetoScatterPoint<T>[]): { key: string; style: ViewStyle }[] {
  const segments: { key: string; style: ViewStyle }[] = [];

  for (let index = 0; index + 1 < front.length; index += 1) {
    const higher = front[index] as ParetoScatterPoint<T>;
    const further = front[index + 1] as ParetoScatterPoint<T>;

    segments.push({
      key: `across-${String(index)}`,
      style: {
        left: percent(higher.xRatio),
        width: percent(further.xRatio - higher.xRatio),
        bottom: percent(higher.yRatio),
        height: FRONT_LINE,
      },
    });
    segments.push({
      key: `down-${String(index)}`,
      style: {
        left: percent(further.xRatio),
        width: FRONT_LINE,
        bottom: percent(further.yRatio),
        height: percent(higher.yRatio - further.yRatio),
      },
    });
  }

  return segments;
}

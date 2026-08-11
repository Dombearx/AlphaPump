/**
 * Wykres słupkowy — jedyny wykres w aplikacji.
 *
 * Narysowany zwykłymi `View`, bez biblioteki wykresów i bez SVG. To nie jest
 * oszczędność: każda z tych bibliotek dokłada moduł natywny, czyli kolejną
 * rzecz do zbudowania przy każdej kompilacji na obie platformy — a specyfikacja
 * mówi o „prostych, minimalistycznych wykresach", nie o dashboardzie. Słupek
 * o wysokości proporcjonalnej do wartości oddaje dokładnie to, po co się na ten
 * ekran wchodzi: czy z tygodnia na tydzień idzie w górę.
 *
 * Komponent nic nie liczy poza skalą — punkty przygotowuje `chart-data.ts`,
 * który jest czysty i przetestowany osobno.
 */

import { Text, View } from 'react-native';
import type { ChartPoint } from '../chart-data';

/** Wysokość rysunku; słupki skalują się do najwyższej wartości w zestawie. */
const CHART_HEIGHT = 160;

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
              <View
                accessibilityLabel={`${point.day}: ${format(point.value)}`}
                className={`w-full rounded-t-md ${highest ? 'bg-success' : 'bg-accent'}`}
                style={{ height: Math.round(ratio * (CHART_HEIGHT - 16)) }}
              />
            </View>
          );
        })}
      </View>

      {/* Podpisy stoją poza rzędem słupków, żeby nie zmieniały ich wysokości. */}
      <View className="flex-row gap-1">
        {points.map((point) => (
          <Text key={point.day} className="flex-1 text-center text-[10px] text-muted">
            {labelOf(point)}
          </Text>
        ))}
      </View>
    </View>
  );
}

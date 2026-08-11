/**
 * Wspólne klocki interfejsu.
 *
 * Specyfikacja stawia to wprost: podobne akcje mają wyglądać i działać tak samo
 * w całej aplikacji, a formularze i listy mają być reużywalne. Trzy przyciski
 * napisane trzy razy rozjeżdżają się przy pierwszej zmianie odstępu — dlatego
 * są tu raz.
 *
 * Komponenty są celowo ubogie. Nie przyjmują dowolnych stylów, tylko wariant:
 * ekran ma być spójny, a nie konfigurowalny.
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { COLORS } from '../theme';

/* ------------------------------------------------------------------ przyciski */

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, { container: string; label: string }> = {
  primary: { container: 'bg-accent', label: 'text-base' },
  secondary: { container: 'border border-border bg-surface', label: 'text-text' },
  danger: { container: 'border border-danger bg-surface', label: 'text-danger' },
};

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  /** Przycisk zajmuje całą dostępną szerokość rzędu. */
  grow?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  grow = false,
}: ButtonProps) {
  const style = BUTTON_STYLES[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      className={`${grow ? 'flex-1 ' : ''}${style.container} rounded-2xl px-4 py-4 active:opacity-70 ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? COLORS.base : COLORS.text} />
      ) : (
        <Text className={`text-center text-base font-semibold ${style.label}`}>{label}</Text>
      )}
    </Pressable>
  );
}

/* --------------------------------------------------------------------- karty */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <View className={`rounded-2xl border border-border bg-surface p-4 ${className}`}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text className="text-sm uppercase tracking-wide text-muted">{children}</Text>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View className="items-center gap-2 py-10">
      <Text className="text-center text-lg font-semibold text-text">{title}</Text>
      {hint !== undefined && <Text className="text-center text-muted">{hint}</Text>}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-base">
      <ActivityIndicator size="large" color={COLORS.accent} />
      {label !== undefined && <Text className="text-muted">{label}</Text>}
    </View>
  );
}

/* ------------------------------------------------------------------ formularz */

export type FieldProps = {
  label: string;
  /** Jednostka pokazana po prawej stronie pola — „kg", „×", „m". */
  unit?: string;
  hint?: string;
} & React.ComponentProps<typeof TextInput>;

export function Field({ label, unit, hint, ...input }: FieldProps) {
  return (
    <View className="flex-1 gap-1">
      <SectionTitle>{label}</SectionTitle>
      <View className="flex-row items-center rounded-2xl border border-border bg-surface px-4">
        <TextInput
          className="flex-1 py-4 text-lg text-text"
          placeholderTextColor={COLORS.muted}
          selectionColor={COLORS.accent}
          {...input}
        />
        {unit !== undefined && unit.length > 0 && <Text className="pl-2 text-muted">{unit}</Text>}
      </View>
      {hint !== undefined && <Text className="text-xs text-muted">{hint}</Text>}
    </View>
  );
}

/* ---------------------------------------------------------------------- listy */

export interface RowProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
}

/** Wiersz listy — ten sam kształt dla serii, ćwiczeń i pozycji cyklu. */
export function Row({ children, onPress, onLongPress, selected = false }: RowProps) {
  const className = `flex-row items-center gap-3 rounded-2xl border px-4 py-3 ${
    selected ? 'border-accent bg-surface' : 'border-border bg-surface'
  }`;

  if (onPress === undefined) return <View className={className}>{children}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      className={`${className} active:opacity-70`}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      {children}
    </Pressable>
  );
}

/**
 * Chips — filtr i wybór jednej wartości z krótkiej listy.
 *
 * Ten sam klocek obsługuje filtr tagów w bibliotece, wybór metryki celu i wybór
 * typu logowania. Rozwijana lista byłaby na to za ciężka: wszystkie te zbiory
 * mają po kilka pozycji, a chips pokazuje je bez ani jednego dodatkowego
 * naciśnięcia.
 */
export function Chip({
  label,
  selected = false,
  color,
  onPress,
}: {
  label: string;
  selected?: boolean;
  /** Kropka w kolorze tagu; pomijana tam, gdzie chips nie dotyczy tagu. */
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`flex-row items-center gap-2 rounded-full border px-3 py-2 active:opacity-70 ${
        selected ? 'border-accent bg-surface' : 'border-border bg-base'
      }`}
    >
      {color !== undefined && <TagDot color={color} />}
      <Text className={selected ? 'text-text' : 'text-muted'}>{label}</Text>
    </Pressable>
  );
}

/** Rząd chipsów przewijany w poziomie — filtrów bywa więcej niż szerokości. */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row gap-2 pr-4"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/**
 * Pasek postępu pozycji cyklu. Udział jest już przycięty do jedynki przez
 * rdzeń — nadmiar nie ma jak wyjechać poza pasek.
 */
export function ProgressBar({ ratio, done = false }: { ratio: number; done?: boolean }) {
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);

  return (
    <View className="h-2 overflow-hidden rounded-full bg-border">
      <View
        className={`h-2 rounded-full ${done ? 'bg-success' : 'bg-accent'}`}
        style={{ width: `${percent}%` }}
      />
    </View>
  );
}

/** Kropka w kolorze tagu — jedyny nośnik koloru na listach ćwiczeń. */
export function TagDot({ color }: { color: string }) {
  return <View className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />;
}

/** Mały przycisk ikonowy — strzałki zmiany kolejności, zamknięcie. */
export function IconButton({
  label,
  glyph,
  onPress,
  disabled = false,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`h-10 w-10 items-center justify-center rounded-xl border border-border ${
        disabled ? 'opacity-30' : 'active:opacity-70'
      }`}
    >
      <Text className="text-lg text-text">{glyph}</Text>
    </Pressable>
  );
}

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
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
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
    <View className="flex-1 items-center justify-center gap-3">
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
  /**
   * Pole dzieli szerokość wiersza z sąsiadem (`flex-row`) i ma się z nim
   * równo rozciągnąć. **Tylko** do tego kontekstu — w kolumnie `flex-1` na
   * elemencie bez rodzica o ustalonej wysokości zapada się w Yodze do ~0 px
   * (flexBasis 0%, a nie ma przestrzeni do wzrostu), co dawało niewidoczne,
   * jednopikselowe pole szukania.
   */
  grow?: boolean;
} & React.ComponentProps<typeof TextInput>;

export function Field({ label, unit, hint, grow = false, ...input }: FieldProps) {
  return (
    <View className={`gap-1 ${grow ? 'flex-1' : ''}`}>
      <SectionTitle>{label}</SectionTitle>
      <View className="flex-row items-center rounded-2xl border border-border bg-surface px-4">
        <TextInput
          // Podpis jest nad polem, a nie w nim, więc bez tego czytnik ekranu
          // czyta „pole tekstowe" i nic więcej. Wywołujący może go nadpisać,
          // podając własny `accessibilityLabel`.
          accessibilityLabel={label}
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
  progress,
  onPress,
}: {
  label: string;
  selected?: boolean;
  /** Kropka w kolorze tagu; pomijana tam, gdzie chips nie dotyczy tagu. */
  color?: string;
  /**
   * Udział wykonania roboty z cyklu (0–1) dla tagu tego chipsa: tło wypełnia się
   * od lewej w tylu procentach, ile z roboty jest zrobione, a kropka zamienia
   * się w gwiazdkę „tu coś jeszcze zostało" — po dokończeniu w ptaszka, przy
   * tle wypełnionym do końca. Znak stoi **w miejscu kropki**, a nie obok niej,
   * i wypełnienie idzie tłem, bo rząd chipsów ma po nich zajmować dokładnie tyle
   * samo miejsca, co przedtem.
   */
  progress?: number;
  /**
   * Bez `onPress` chips jest samą etykietą: nie reaguje na dotyk i nie
   * przedstawia się czytnikowi ekranu jako przycisk. Tak wyglądają tagi
   * ćwiczenia na ekranie zapisu serii — informują, a nie filtrują.
   */
  onPress?: () => void;
}) {
  // Wyściółka siedzi na wewnętrznym rzędzie, a nie na obramowanym pudełku, bo
  // wypełnienie tła ma się rozciągać na **całą** szerokość chipsa. Procenty
  // i krawędzie elementu ustawionego bezwzględnie liczą się względem pudełka
  // rodzica, a to z wyściółką jest węższe od widocznego chipsa: przy `px-3`
  // połowa roboty wychodziła na krótkim chipsie mniej więcej jedną trzecią jego
  // szerokości. Bez wyściółki na zewnętrznym pudełku nie ma się co rozjechać.
  // `justify-center` trzyma treść pośrodku wysokości chipsa: w łamanym rzędzie
  // chipsy rozciągają się do najwyższego w linii, a wcześniej centrowanie
  // załatwiał `items-center` stojący na tym samym pudełku, co treść.
  const shape = `justify-center overflow-hidden rounded-full border ${
    selected ? 'border-accent bg-surface' : 'border-border bg-base'
  }`;

  const dot = color === undefined ? null : <TagDot color={color} />;
  const mark = color ?? COLORS.accent;

  const content = (
    <>
      {progress === undefined ? null : <ChipFill ratio={progress} color={mark} />}
      <View className="flex-row items-center gap-2 px-3 py-2">
        {progress === undefined ? dot : <TagStar color={mark} ratio={progress} />}
        <Text className={selected ? 'text-text' : 'text-muted'}>{label}</Text>
      </View>
    </>
  );

  if (onPress === undefined) return <View className={shape}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`${shape} active:opacity-70`}
    >
      {content}
    </Pressable>
  );
}

/**
 * Rząd chipsów.
 *
 * Domyślnie przewijany w poziomie — dobre dla krótkich, stałych zbiorów
 * (metryka celu, typ logowania), które mieszczą się w jednej linii albo
 * blisko niej. Dla list, które potrafią urosnąć do kilkunastu-kilkudziesięciu
 * pozycji (tagi), jedna przewijana linia jest niewygodna — `wrap` łamie
 * chipsy do siatki, żeby wszystkie były widoczne bez przewijania w bok.
 */
export function ChipRow({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  if (wrap) {
    return <View className="flex-row flex-wrap gap-2">{children}</View>;
  }

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

/** Procent z udziału 0–1, przycięty do zakresu — wspólny dla paska i chipsa. */
function percentOf(ratio: number): number {
  return Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
}

/**
 * Pasek postępu pozycji cyklu. Udział jest już przycięty do jedynki przez
 * rdzeń — nadmiar nie ma jak wyjechać poza pasek.
 */
export function ProgressBar({ ratio, done = false }: { ratio: number; done?: boolean }) {
  const percent = percentOf(ratio);

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

/**
 * Znak cyklu w kolorze tagu, wielkości kropki: gwiazdka „tu coś zostało",
 * a po dokończeniu roboty ptaszek.
 *
 * Zrobiony tag zostaje oznaczony, zamiast wracać do wyglądu tagu spoza cyklu —
 * inaczej ostatnia seria wygląda jak cofnięcie postępu, a nie jak jego domknięcie.
 *
 * Rozmiar jest podany wprost, a nie klasą, bo ma być związany z kropką: znak
 * wchodzi na jej miejsce i rząd chipsów nie może przez niego urosnąć. Wysokość
 * linii trzyma go poniżej wysokości etykiety, więc przycisk zostaje ten sam.
 * Czytnikowi ekranu podajemy słowa, bo sam znak przeczytałby jako „czarna
 * gwiazdka" — a to nie jest informacja, którą tu przekazujemy. Udział wykonania
 * dopisujemy do tych samych słów: wypełnienie tła chipsa widać wyłącznie okiem,
 * więc bez tego czytnik ekranu nie miałby skąd wziąć procentu.
 */
export function TagStar({ color, ratio }: { color: string; ratio?: number }) {
  const done = ratio !== undefined && ratio >= 1;
  const label =
    ratio === undefined
      ? 'left to do'
      : done
        ? 'cycle work done'
        : `left to do, ${percentOf(ratio)}% done`;

  return (
    <Text accessibilityLabel={label} style={{ color, fontSize: 13, lineHeight: 14 }}>
      {done ? '✓' : '★'}
    </Text>
  );
}

/**
 * Wypełnienie tła chipsa w proporcji wykonanej roboty z cyklu.
 *
 * Stoi pod treścią i jest wyjęte z układu (pozycja bezwzględna), żeby chips
 * został dokładnie tej samej wielkości, co bez wypełnienia — pasek pod nim
 * kosztowałby wysokość rzędu tagów, a ten rząd stoi na ekranie, przez który
 * przechodzi się do każdej serii. Kolor jest kolorem tagu, przygaszony: tło ma
 * być tłem, a nie drugą etykietą. Przycięcie do zaokrąglenia załatwia
 * `overflow-hidden` na samym chipsie.
 *
 * Szerokość wychodzi z podziału rzędu rozpiętego na całym chipsie (`left` i
 * `right` naraz), a nie z procentu szerokości: procent w elemencie ustawionym
 * bezwzględnie liczy się względem pudełka rodzica i różni się między wersjami
 * silnika układu, a tu ma być dokładnie tyle, ile zrobionej roboty. Podział
 * dwoma udziałami wzrostu daje tę proporcję wprost, bez zgadywania, od czego
 * liczy się sto procent.
 */
function ChipFill({ ratio, color }: { ratio: number; color: string }) {
  const done = Math.min(Math.max(ratio, 0), 1);

  return (
    <View className="absolute bottom-0 left-0 right-0 top-0 flex-row" pointerEvents="none">
      <View style={{ flexGrow: done, flexBasis: 0, backgroundColor: color, opacity: 0.3 }} />
      <View style={{ flexGrow: 1 - done, flexBasis: 0 }} />
    </View>
  );
}

/**
 * Awatar użytkownika. Bez zdjęcia (konto bez Google albo brak `image` w sesji)
 * pokazuje domyślny krążek z pierwszą literą nicku — nigdy pusty placeholder.
 */
export function Avatar({
  uri,
  label,
  size = 32,
}: {
  uri?: string | null;
  /** Nick albo e-mail — z niego bierze się litera domyślnego awatara. */
  label: string;
  size?: number;
}) {
  if (uri !== undefined && uri !== null && uri.length > 0) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }

  const initial = label.trim().charAt(0).toUpperCase() || '?';

  return (
    <View
      className="items-center justify-center rounded-full bg-accent"
      style={{ width: size, height: size }}
    >
      <Text className="font-semibold" style={{ color: COLORS.base, fontSize: size * 0.45 }}>
        {initial}
      </Text>
    </View>
  );
}

/** Mały przycisk ikonowy — strzałki zmiany kolejności, zamknięcie. */
export function IconButton({
  label,
  glyph,
  onPress,
  disabled = false,
  size = 40,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
  /** Bok kwadratu w px — domyślnie 40 (`h-10 w-10`). Większy dla łatwiejszego trafienia. */
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{ width: size, height: size }}
      className={`items-center justify-center rounded-xl border border-border ${
        disabled ? 'opacity-30' : 'active:opacity-70'
      }`}
    >
      <Text className="text-lg text-text">{glyph}</Text>
    </Pressable>
  );
}

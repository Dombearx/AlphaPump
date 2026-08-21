/**
 * Co w tej chwili chodzi na telefonie — opis dla ekranu konta.
 *
 * Powstało z pytania, na które nie dało się odpowiedzieć z wnętrza aplikacji:
 * „zrestartowałem po aktualizacji, ale nie widzę zmiany — wgrała się w ogóle?".
 * Wydania OTA nie ruszają `versionName` ani `versionCode` (te opisują pakiet,
 * a pakiet zostaje ten sam), więc numer wersji sam z siebie **niczego tu nie
 * rozstrzyga**. Rozstrzyga dopiero data paczki: porównuje się ją z godziną
 * wydania w CI i wiadomo, czy telefon chodzi na tym, co wyszło.
 *
 * Moduł jest czysty i nie importuje niczego z Expo — wartości wchodzą gotowe
 * z `ota.ts` i `expo.ts`, tak samo jak w `manifest.ts` obok. Formatowanie dat
 * idzie przez `day-labels`, czyli bez `Intl`: Hermes bywa budowany bez pełnych
 * danych ICU i wtedy cicho oddaje coś innego, niż widać na maszynie
 * dewelopera.
 */

import { toIsoDate, type IsoDate } from '@alphapump/core';
import { formatDate } from '../day-labels';

export interface RunningBundle {
  /** Wersja pakietu dla człowieka — „0.2.0". `null`, gdy nie da się odczytać. */
  versionName: string | null;
  /** `versionCode` pakietu; `null` poza Androidem i iOS. */
  versionCode: number | null;
  /** Czy chodzi paczka wbudowana w `.apk`, a nie pobrana przez `expo-updates`. */
  embedded: boolean;
  /** Kiedy powstała pobrana paczka; `null` dla wbudowanej. */
  createdAt: Date | null;
  /** Identyfikator pobranej paczki; `null` dla wbudowanej. */
  updateId: string | null;
  /** Odcisk warstwy natywnej — to on decyduje, które paczki tu dojadą. */
  runtimeVersion: string | null;
  /**
   * Start awaryjny: `expo-updates` sięgnął po paczkę wbudowaną, bo pobrana nie
   * wstała. To jedyny stan, w którym „zrestartowałem, a zmiany nie ma" jest
   * awarią, a nie nieporozumieniem — i jedyny, o którym trzeba powiedzieć
   * wprost, bo poza tym wygląda dokładnie jak zwykły start.
   */
  emergency: boolean;
  /**
   * Co dokładnie nie wstało — `expo-updates` podaje to tylko przy starcie
   * awaryjnym. Zdanie jest po angielsku i przychodzi z biblioteki, więc
   * wchodzi na ekran takie, jakie jest: przepisane własnymi słowami byłoby
   * tłumaczeniem błędu, którego nie widzieliśmy.
   */
  emergencyReason: string | null;
}

export interface RunningBundleDescription {
  /** „0.2.0 (57)" — wersja pakietu, ta z ustawień systemu. */
  version: string;
  /** Skąd pochodzi kod, który w tej chwili chodzi. */
  source: string;
  /** Identyfikator paczki i odcisk warstwy natywnej; puste, gdy nieznane. */
  detail: string;
  /** Zdanie o starcie awaryjnym albo `null`, gdy start był zwykły. */
  warning: string | null;
}

/**
 * Identyfikatory paczek i odciski są długie i szesnastkowe. Do odróżnienia
 * dwóch kolejnych wydań wystarczy początek, a całość i tak nie mieści się
 * w wierszu telefonu.
 */
const SHORT_ID_LENGTH = 12;

function shorten(value: string): string {
  return value.length <= SHORT_ID_LENGTH ? value : `${value.slice(0, SHORT_ID_LENGTH)}…`;
}

/** „20 August, 20:53" — data z `day-labels`, godzina dopisana ręcznie. */
export function formatBundleTime(createdAt: Date, today: IsoDate): string {
  const hours = String(createdAt.getHours()).padStart(2, '0');
  const minutes = String(createdAt.getMinutes()).padStart(2, '0');
  return `${formatDate(toIsoDate(createdAt), today)}, ${hours}:${minutes}`;
}

export function describeRunningBundle(
  bundle: RunningBundle,
  today: IsoDate,
): RunningBundleDescription {
  return {
    version: formatVersion(bundle),
    source: formatSource(bundle, today),
    detail: formatDetail(bundle),
    warning: formatWarning(bundle),
  };
}

/**
 * Start awaryjny jest jedynym stanem, w którym „zrestartowałem, a zmiany nie
 * ma" znaczy awarię — i wygląda przy tym dokładnie jak zwykły start, więc musi
 * powiedzieć o sobie sam.
 */
function formatWarning(bundle: RunningBundle): string | null {
  if (!bundle.emergency) return null;
  const base =
    'The downloaded bundle failed to start, so the app fell back to the one built into the package. ' +
    'It will not be tried again — only a newer release replaces it.';
  return bundle.emergencyReason === null ? base : `${base} (${bundle.emergencyReason})`;
}

function formatVersion(bundle: RunningBundle): string {
  if (bundle.versionName === null) return 'Version unknown';
  if (bundle.versionCode === null) return bundle.versionName;
  return `${bundle.versionName} (${String(bundle.versionCode)})`;
}

/**
 * Zdanie o pochodzeniu kodu. Paczka bez daty jest możliwa — `expo-updates`
 * podaje `createdAt` z manifestu, a ten w wydaniu ręcznym bywa pusty — i lepiej
 * powiedzieć „pobrana paczka" bez daty niż udawać, że jej nie ma.
 */
function formatSource(bundle: RunningBundle, today: IsoDate): string {
  if (bundle.embedded) return 'Running the bundle built into the installed package.';
  if (bundle.createdAt === null) return 'Running a downloaded bundle.';
  return `Running a downloaded bundle from ${formatBundleTime(bundle.createdAt, today)}.`;
}

function formatDetail(bundle: RunningBundle): string {
  const parts: string[] = [];
  if (bundle.updateId !== null) parts.push(`bundle ${shorten(bundle.updateId)}`);
  if (bundle.runtimeVersion !== null) parts.push(`native layer ${shorten(bundle.runtimeVersion)}`);
  return parts.join(' · ');
}

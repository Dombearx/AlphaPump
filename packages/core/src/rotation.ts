/**
 * Kolejność podpowiadanych ćwiczeń — co robić teraz, żeby mieścić się w cyklu
 * i nie męczyć dwa razy pod rząd tych samych partii.
 *
 * Ekran wyboru ćwiczenia układał listę po liczbie własnych serii malejąco:
 * najczęściej wykonywane na górze. Jest to kolejność stabilna i przewidywalna,
 * ale nie odpowiada na pytanie, z którym użytkownik wchodzi na ten ekran —
 * **co wykonać teraz**. Ta odpowiedź ma dwa składniki i oba są tu policzone:
 *
 * 1. **Braki w cyklu.** Ćwiczenie, które domyka pozycję celu aktywnego cyklu,
 *    idzie wyżej, i tym wyżej, im więcej w tej pozycji zostało.
 * 2. **Rozdzielność partii.** Ćwiczenie dzielące tagi z tym, co przed chwilą
 *    wykonano, idzie niżej. Typowy trening to dwa ćwiczenia robione na zmianę,
 *    seria za serią, i ma sens tylko wtedy, gdy jedno daje odpocząć partiom
 *    drugiego. Seria na triceps zaraz po serii na plecy, która mocno bierze
 *    triceps, to seria wykonana w słabości.
 *
 * Oba składniki dają jeden wynik: `potrzeba − waga × zmęczenie`. Lista jest
 * potem sortowana po nim malejąco, **stabilnie** — czyli ćwiczenia o równym
 * wyniku zostają w kolejności, w jakiej przyszły z biblioteki. Dzięki temu
 * dotychczasowa kolejność (najczęściej wykonywane na górze) nie znika, tylko
 * zostaje rozstrzyganiem remisów.
 *
 * ## Skąd bierze się naprzemienność
 *
 * Zmęczenie liczy się **z ostatniego ćwiczenia najmocniej**, a z wcześniejszych
 * coraz słabiej. To wystarcza, żeby wyszła z tego zamiana A–B–A–B, i to bez
 * pamiętania czegokolwiek między wejściami na ekran:
 *
 * - po serii A ćwiczenie A jest świeżo zmęczone, więc wygrywa B (jego pozycja
 *   w cyklu też została niedokończona, a tagów wspólnych nie ma),
 * - po serii B najmocniej zmęczone jest B, a A leży już o jedno wstecz
 *   i waży połowę — więc na górę wraca A.
 *
 * Kolejne serie **tego samego** ćwiczenia pod rząd liczą się jako jedno wejście:
 * cztery serie ławki to jedno ćwiczenie w historii dnia, a nie cztery, bo
 * inaczej wypełniłyby całe okno i wypchnęły z niego to, z czym ławka miała się
 * wymieniać.
 *
 * ## Czego tu nie ma
 *
 * Cardio. Ćwiczenia oznaczone tagiem wyłączonym (`excludedTagIds`, w aplikacji
 * jest to tag o slugu `cardio`) dostają wynik **neutralny**: nie są podpowiadane
 * i nie są też spychane na dół, czyli zostają dokładnie tam, gdzie postawiła je
 * biblioteka. Bieganie i rower to osobna kategoria treningu i dobieranie ich po
 * partiach mięśniowych nie ma sensu — a zakopanie ich pod listą siłową
 * zabierałoby drogę do zapisania serii komuś, kto właśnie wrócił z biegu.
 *
 * Moduł jest czysty i nie wie nic o bazie ani o ekranie: dostaje ćwiczenia,
 * historię dnia i braki cyklu, oddaje kolejność.
 */

/** Minimum, jakiego algorytm potrzebuje od ćwiczenia. `Exercise` to spełnia. */
export interface RotatedExercise {
  id: string;
  primaryTagId: string;
  /** Tagi dodatkowe — partie angażowane pomocniczo. */
  additionalTagIds: readonly string[];
}

/**
 * Co algorytm wie o chwili, w której podpowiada.
 *
 * `tagNeed` i `exerciseNeed` to udział pozycji celu, który **został do
 * zrobienia** (0–1): jedynka znaczy „ani jednej serii", zero — „zrobione" albo
 * „nie ma takiej pozycji w żadnym aktywnym cyklu".
 */
export interface RotationContext {
  /**
   * Ćwiczenia dzisiejszych serii w kolejności wykonania, od najstarszej do
   * najświeższej. Powtórzenia pod rząd są zwijane w jedno wejście, więc można
   * tu podać wprost ćwiczenia kolejnych serii.
   */
  performed: readonly RotatedExercise[];
  /** Ile zostało w pozycjach celu wskazujących tag. */
  tagNeed: ReadonlyMap<string, number>;
  /** Ile zostało w pozycjach celu wskazujących wprost ćwiczenie. */
  exerciseNeed: ReadonlyMap<string, number>;
  /** Tagi wyłączone z podpowiadania — w aplikacji cardio. */
  excludedTagIds: ReadonlySet<string>;
}

/** Slug tagu, którego ćwiczeń nie podpowiadamy tą drogą. */
export const CARDIO_TAG_SLUG = 'cardio';

/**
 * Udział tagu w ćwiczeniu. Tag główny liczy się w całości, dodatkowy w połowie:
 * ćwiczenie **na** biceps męczy go mocniej niż ćwiczenie, które go przy okazji
 * angażuje, a cykle i tak zaliczają wyłącznie tag główny.
 */
const PRIMARY_TAG_WEIGHT = 1;
const ADDITIONAL_TAG_WEIGHT = 0.5;

/**
 * Ile waży ćwiczenie o jedno wstecz w historii dnia. Połowa, więc ostatnie waży
 * 1, przedostatnie 0.5, trzecie od końca 0.25 — po czterech ćwiczeniach wpływ
 * najstarszego jest już śladowy. To jest ta stała, z której bierze się zamiana
 * A–B–A–B: gdyby wszystkie ćwiczenia dnia ważyły tyle samo, po serii B zarówno
 * A, jak i B byłyby ukarane tak samo i na górę weszłoby coś trzeciego.
 */
const RECENCY_DECAY = 0.5;

/**
 * Ile zmęczenie waży wobec braku w cyklu.
 *
 * Dobrane tak, żeby powtórzenie tego samego ćwiczenia (zmęczenie równe jedynce)
 * przegrywało z inną **niedokończoną** pozycją cyklu, ale wygrywało z
 * ćwiczeniem spoza cyklu (wynik zero). Przy 0.7 ćwiczenie z pozycją zrobioną
 * w jednej dwunastej (potrzeba 0.92) spada po swojej serii do 0.22 — czyli pod
 * każdą inną niedokończoną pozycję, a wciąż nad ćwiczenia, o które cykl nie
 * prosi. Gdyby waga była większa od jedynki, ćwiczenie właśnie wykonane
 * spadałoby pod ćwiczenia spoza cyklu i cykl, w którym została **tylko jedna**
 * partia, przestałby być podpowiadany w ogóle.
 */
const FATIGUE_WEIGHT = 0.7;

/** Tagi ćwiczenia wraz z udziałem; tag wpisany dwa razy liczy się raz. */
function tagWeights(exercise: RotatedExercise): Map<string, number> {
  const weights = new Map<string, number>([[exercise.primaryTagId, PRIMARY_TAG_WEIGHT]]);
  for (const tagId of exercise.additionalTagIds) {
    if (!weights.has(tagId)) weights.set(tagId, ADDITIONAL_TAG_WEIGHT);
  }
  return weights;
}

/**
 * Część wspólna dwóch ćwiczeń, 0–1. Iloczyn udziałów po każdym wspólnym tagu,
 * więc dwa ćwiczenia o tym samym tagu głównym dają jedynkę, a ćwiczenie
 * angażujące pomocniczo cudzy tag główny — ćwierć albo połowę. Suma jest
 * przycięta do jedynki: „to samo, co przed chwilą" jest najgorszym przypadkiem
 * i nic nie ma prawa być gorsze.
 */
function tagOverlap(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let shared = 0;
  for (const [tagId, weight] of a) {
    const other = b.get(tagId);
    if (other !== undefined) shared += weight * other;
  }
  return Math.min(shared, 1);
}

/** Historia dnia bez powtórzeń pod rząd — patrz nagłówek modułu. */
function exerciseBlocks(performed: readonly RotatedExercise[]): RotatedExercise[] {
  const blocks: RotatedExercise[] = [];
  for (const exercise of performed) {
    if (blocks.at(-1)?.id !== exercise.id) blocks.push(exercise);
  }
  return blocks;
}

/**
 * Jak bardzo ćwiczenie koliduje z tym, co już dziś wykonano — 0 (nic wspólnego
 * albo pusty dzień) do 1 (dokładnie to, co przed chwilą).
 *
 * Średnia ważona części wspólnych, a nie suma: inaczej sam przyrost liczby
 * ćwiczeń w ciągu dnia spychałby wszystko na dół i po piątej serii kolejność
 * przestawałaby się różnić od przypadkowej.
 */
export function rotationFatigue(
  exercise: RotatedExercise,
  performed: readonly RotatedExercise[],
): number {
  const blocks = exerciseBlocks(performed);
  if (blocks.length === 0) return 0;

  const candidate = tagWeights(exercise);
  let sum = 0;
  let total = 0;

  for (const [step, previous] of blocks.reverse().entries()) {
    const weight = RECENCY_DECAY ** step;
    total += weight;
    sum += weight * tagOverlap(candidate, tagWeights(previous));
  }

  return sum / total;
}

/**
 * Wynik ćwiczenia: im wyższy, tym lepiej wykonać je teraz.
 *
 * Braku w cyklu nie sumujemy po tagach — liczy się **największy** z dwóch:
 * pozycji wskazującej wprost to ćwiczenie i pozycji wskazującej jego tag
 * główny. Tagi dodatkowe nie zaliczają serii do cyklu (patrz `cycles.ts`), więc
 * nie mają też prawa podbijać ćwiczenia w podpowiedzi.
 */
export function rotationScore(exercise: RotatedExercise, context: RotationContext): number {
  if (isExcluded(exercise, context.excludedTagIds)) return 0;

  const need = Math.max(
    context.exerciseNeed.get(exercise.id) ?? 0,
    context.tagNeed.get(exercise.primaryTagId) ?? 0,
  );

  return need - FATIGUE_WEIGHT * rotationFatigue(exercise, context.performed);
}

function isExcluded(exercise: RotatedExercise, excludedTagIds: ReadonlySet<string>): boolean {
  if (excludedTagIds.size === 0) return false;
  if (excludedTagIds.has(exercise.primaryTagId)) return true;
  return exercise.additionalTagIds.some((tagId) => excludedTagIds.has(tagId));
}

/**
 * Biblioteka ułożona pod „co wykonać teraz".
 *
 * Sortowanie jest **stabilne** (gwarantuje to specyfikacja języka), więc
 * kolejność wejściowa zostaje rozstrzyganiem remisów — a remisów jest tu dużo,
 * bo ćwiczenia spoza cyklu i bez części wspólnej z dniem mają wynik zero.
 * Wchodzi więc lista w dotychczasowej kolejności, wychodzi ta sama lista
 * z podpowiedziami wyciągniętymi na górę.
 */
export function orderByRotation<T extends RotatedExercise>(
  exercises: readonly T[],
  context: RotationContext,
): T[] {
  const scores = new Map(
    exercises.map((exercise) => [exercise.id, rotationScore(exercise, context)]),
  );
  return [...exercises].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
}

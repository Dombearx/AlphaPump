/**
 * Podobieństwo nazw ćwiczeń — warstwa lokalna wykrywania duplikatów.
 *
 * Specyfikacja wymaga, żeby przy dodawaniu ćwiczenia system **ostrzegał**
 * o podobnych wpisach i żeby ostrzeżenie działało bez sieci. Stąd ta funkcja
 * jest tutaj, a nie w aplikacji: liczy się z samych nazw, deterministycznie,
 * więc telefon offline i serwer dostaną ten sam wynik.
 *
 * Ostrzeżenie **nigdy nie blokuje zapisu**. Biblioteka jest wspólna, a granica
 * między „to samo ćwiczenie" a „wariant, który chcę mieć osobno" należy do
 * użytkownika, nie do algorytmu.
 *
 * ## Jak liczymy
 *
 * Nazwy sprowadzamy do sluga (tego samego, z którego liczy się identyfikator)
 * i dzielimy na słowa. Porównanie idzie **po słowach**, ale dopasowanie słów
 * jest miękkie — para słów zalicza się do siebie, gdy ich podobieństwo
 * trigramowe przekracza próg. Dzięki temu „przysiad" znajduje „przysiady",
 * a odmiana i literówka nie gubią duplikatu.
 *
 * Samo porównanie trigramowe całych nazw byłoby krótsze i gorsze: „wiosłowanie
 * sztangą" i „wyciskanie sztangi" dzielą długi ogon znaków, więc wychodziłyby
 * podobne, choć nie mają ze sobą nic wspólnego. Praca na słowach to odsiewa.
 *
 * ## Fragment nazwy
 *
 * Sam wynik nie wystarczy, bo jest **ułamkiem**: rozcieńcza go każdy człon,
 * którego druga nazwa nie ma. „Przysiady" wobec „Przysiady bułgarskie ze
 * sztangielkami" daje `2 × 1 / 4 = 0,5`, czyli poniżej progu — a to jest
 * dokładnie ten duplikat, o którym trzeba powiedzieć. Serwer go łapie, bo jego
 * warstwa leksykalna to **alternatywa**: trigramy **albo** `tsvector`, w którym
 * wszystkie słowa wpisywanej nazwy mają trafić w kandydata, niezależnie od tego,
 * ile słów kandydat ma poza nimi.
 *
 * Ta sama reguła jest tutaj jako `nameContains`: jedna nazwa jest fragmentem
 * drugiej, gdy **każde** jej słowo znajdzie sobie partnera w tej drugiej. Bez
 * niej ostrzeżenie znikało po wyjściu telefonu z zasięgu — a wtedy właśnie
 * powstają duplikaty, bo nie ma czego scalić przy najbliższej synchronizacji.
 *
 * Zakres tej warstwy kończy się na pisowni. „Martwy ciąg" i „deadlift" to dla
 * niej dwie różne nazwy — dopasowanie po znaczeniu wchodzi dopiero z etapem 12
 * (embeddingi i re-ranker) i tylko jako uzupełnienie tego, co jest tutaj.
 */

import { slug } from './slug.js';

/** Od tego podobieństwa dwa słowa uznajemy za to samo słowo w innej formie. */
const TOKEN_MATCH_THRESHOLD = 0.7;

/**
 * Domyślny próg ostrzeżenia o duplikacie.
 *
 * Wartość jest dobrana **powyżej** wyniku, jaki dają dwie dwuczłonowe nazwy
 * dzielące jedno słowo (`2 × 1 / 4 = 0,5`). Inaczej „wiosłowanie sztangą"
 * ostrzegałoby przy „wyciskaniu sztangi", a ostrzeżenie, które zapala się
 * zawsze, przestaje cokolwiek znaczyć. Nazwa dłuższa o jeden człon od
 * istniejącej — czyli typowy duplikat — daje `2 × 2 / 5 = 0,8` i przechodzi.
 */
export const SIMILARITY_THRESHOLD = 0.6;

/** Ile podobnych wpisów pokazujemy — ostrzeżenie ma być krótkie. */
export const SIMILARITY_LIMIT = 3;

/**
 * Słowa krótsze niż to są pomijane („na", „z", „w"). Nie niosą znaczenia,
 * a rozcieńczałyby wynik: „wyciskanie sztangi na ławce" wyglądałoby przez nie
 * na mniej podobne do „wyciskanie sztangi", niż jest.
 */
const MIN_TOKEN_LENGTH = 3;

/** Słowa nazwy — slug rozbity na człony, bez członów nieznaczących. */
export function nameTokens(name: string): string[] {
  const all = slug(name).split('-').filter(Boolean);
  const meaningful = all.filter((token) => token.length >= MIN_TOKEN_LENGTH);
  // Nazwa złożona z samych krótkich członów („bok do boku") nie może zostać
  // bez słów — wtedy liczą się wszystkie.
  return meaningful.length > 0 ? meaningful : all;
}

function trigrams(value: string): Set<string> {
  if (value.length < 3) return new Set([value]);

  const result = new Set<string>();
  for (let index = 0; index + 3 <= value.length; index += 1) {
    result.add(value.slice(index, index + 3));
  }
  return result;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** Podobieństwo dwóch słów, 0–1. Odmiana tego samego słowa daje bliskie jedynki. */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  return diceCoefficient(trigrams(a), trigrams(b));
}

/** Odległość edycyjna Levenshteina — ile znaków trzeba zmienić, dodać albo usunąć. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Jeden wiersz macierzy naraz: słowa są krótkie, a druga tablica byłaby tu
  // wyłącznie pamięcią zajętą na nic.
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] ?? 0) + 1;
      const deletion = (previous[j] ?? 0) + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    previous = current;
  }

  return previous[b.length] ?? 0;
}

/**
 * Próg, od którego dwa słowa uznajemy za to samo słowo z literówką.
 *
 * Wyżej niż `TOKEN_MATCH_THRESHOLD`, bo `tokenCloseness` jest łagodniejsza:
 * gdyby próg został ten sam, „deska" i „ławka" (jedna trzecia znaków różna)
 * zaczęłyby być dla siebie literówką.
 */
export const TOKEN_CLOSENESS_THRESHOLD = 0.72;

/**
 * Podobieństwo dwóch słów **odporne na literówkę w krótkim słowie**, 0–1.
 *
 * Same trigramy tu nie wystarczą: „bench" i „bensh" różnią się jednym znakiem,
 * a trigramowo dzielą jedną trójkę z trzech, czyli wychodzą na 0,33 — mniej niż
 * dwa słowa, które nie mają ze sobą nic wspólnego poza długością. Dla nazw
 * ćwiczeń ma to znaczenie, bo połowa z nich jest jednosylabowa („Bieg",
 * „Deska", „Row"), a dyktowanie na zegarku przekręca dokładnie po jednym znaku.
 *
 * Stąd maksimum z dwóch miar: trigramy łapią odmianę i przestawienie końcówki
 * („przysiad" ↔ „przysiady"), odległość edycyjna — literówkę w słowie krótkim.
 * Osobno od `tokenSimilarity`, bo tamta stoi pod ostrzeżeniem o duplikatach,
 * gdzie łagodniejsza miara znaczyłaby więcej ostrzeżeń fałszywych.
 */
export function tokenCloseness(a: string, b: string): number {
  if (a === b) return 1;

  const longest = Math.max(a.length, b.length);
  const edit = longest === 0 ? 0 : 1 - editDistance(a, b) / longest;

  return Math.max(tokenSimilarity(a, b), edit);
}

/**
 * Ile słów z lewej znalazło sobie partnera po prawej.
 *
 * Każde słowo z lewej szuka sobie **jednego** partnera z prawej. Zajęte słowa
 * odpadają, żeby „przysiad przysiad" nie zaliczyło dwa razy tego samego.
 */
function countMatched(
  left: readonly string[],
  right: readonly string[],
  score: (a: string, b: string) => number,
  threshold: number,
): number {
  const taken = new Set<number>();
  let matched = 0;

  for (const token of left) {
    let bestIndex = -1;
    let bestScore = threshold;

    for (const [index, candidate] of right.entries()) {
      if (taken.has(index)) continue;
      const current = score(token, candidate);
      if (current >= bestScore) {
        bestScore = current;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      taken.add(bestIndex);
      matched += 1;
    }
  }

  return matched;
}

function countMatchedTokens(left: readonly string[], right: readonly string[]): number {
  return countMatched(left, right, tokenSimilarity, TOKEN_MATCH_THRESHOLD);
}

/**
 * Ile słów z `needle` znajduje sobie partnera w `haystack`, licząc po
 * `tokenCloseness` — czyli wybaczając literówkę także w słowie krótkim.
 *
 * Używa tego dopasowanie nazwy usłyszanej przy dyktowaniu (`matchSpokenExercise`
 * w `voice.ts`), gdzie wejściem jest tekst z rozpoznawania mowy, a nie coś, co
 * ktoś przeczytał przed wysłaniem.
 */
export function countCloseTokens(needle: readonly string[], haystack: readonly string[]): number {
  return countMatched(needle, haystack, tokenCloseness, TOKEN_CLOSENESS_THRESHOLD);
}

/**
 * Podobieństwo dwóch nazw, 0–1. Jedynka znaczy „ten sam slug", czyli w praktyce
 * ten sam identyfikator ćwiczenia u tego samego autora.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.length === 0 || right.length === 0) return 0;

  return (2 * countMatchedTokens(left, right)) / (left.length + right.length);
}

/**
 * Czy `inner` jest fragmentem `outer` — czyli czy **każde** słowo `inner`
 * znajduje sobie partnera w `outer`. Dopasowanie słów jest to samo, miękkie,
 * więc „przysiady" są fragmentem „przysiad bułgarski".
 *
 * Nazwa dłuższa nigdy nie jest fragmentem krótszej, więc wołający sprawdza obie
 * strony: duplikat powstaje zarówno przez dopisanie członu do istniejącej nazwy,
 * jak i przez wpisanie samego rdzenia nazwy już istniejącej.
 */
export function nameContains(outer: string, inner: string): boolean {
  const needle = nameTokens(inner);
  const haystack = nameTokens(outer);
  if (needle.length === 0 || haystack.length === 0) return false;

  return countMatchedTokens(needle, haystack) === needle.length;
}

/** Minimum, jakiego potrzebuje wyszukiwanie podobnych. `Exercise` to spełnia. */
export interface SimilarityCandidate {
  id: string;
  name: string;
}

export interface SimilarityMatch<T extends SimilarityCandidate> {
  exercise: T;
  score: number;
  /** Slug jest identyczny — dodanie tej nazwy trafi w istniejący wiersz autora. */
  identical: boolean;
}

export interface SimilarityOptions {
  threshold?: number;
  limit?: number;
  /** Ćwiczenie pomijane w wynikach — przy edycji jest nim edytowany wiersz. */
  excludeId?: string | null;
}

/**
 * Podobne ćwiczenia, od najbardziej podobnego. Wynik jest **podpowiedzią**:
 * wołający ma go pokazać, a nie użyć do zablokowania zapisu.
 */
export function findSimilarExercises<T extends SimilarityCandidate>(
  name: string,
  candidates: readonly T[],
  options: SimilarityOptions = {},
): SimilarityMatch<T>[] {
  const { threshold = SIMILARITY_THRESHOLD, limit = SIMILARITY_LIMIT, excludeId = null } = options;

  const needle = slug(name);
  if (needle.length === 0) return [];

  return (
    candidates
      .filter((candidate) => candidate.id !== excludeId)
      .map((exercise) => ({
        exercise,
        score: nameSimilarity(name, exercise.name),
        identical: slug(exercise.name) === needle,
      }))
      // Alternatywa, nie koniunkcja — tak samo jak w warstwie leksykalnej serwera.
      // Wynik zostaje wynikiem: fragment przechodzi przez próg, ale nie udaje, że
      // jest podobny bardziej, niż jest, i na liście stoi niżej.
      .filter(
        (match) =>
          match.score >= threshold ||
          nameContains(match.exercise.name, name) ||
          nameContains(name, match.exercise.name),
      )
      .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
      .slice(0, limit)
  );
}

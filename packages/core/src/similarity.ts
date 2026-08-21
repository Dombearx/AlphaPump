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

/**
 * Ile słów z lewej znalazło sobie partnera po prawej.
 *
 * Każde słowo z lewej szuka sobie **jednego** partnera z prawej. Zajęte słowa
 * odpadają, żeby „przysiad przysiad" nie zaliczyło dwa razy tego samego.
 */
function countMatchedTokens(left: readonly string[], right: readonly string[]): number {
  const taken = new Set<number>();
  let matched = 0;

  for (const token of left) {
    let bestIndex = -1;
    let bestScore = TOKEN_MATCH_THRESHOLD;

    for (const [index, candidate] of right.entries()) {
      if (taken.has(index)) continue;
      const score = tokenSimilarity(token, candidate);
      if (score >= bestScore) {
        bestScore = score;
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

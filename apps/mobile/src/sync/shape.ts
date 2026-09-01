/**
 * Opis odpowiedzi, która nie przeszła schematu.
 *
 * Odpowiedzi serwera walidujemy schematami z `@alphapump/core` i jest to
 * walidacja **wszystko albo nic**: jeden wiersz niezgodny ze schematem
 * unieważnia całą paczkę, a przy pullu — zatrzymuje kursor, więc urządzenie
 * pobiera ten sam zakres w kółko i nie zsynchronizuje się już nigdy (patrz
 * historia: #85, #89). Wyjście z tego jest jedno: poprawić wiersz w bazie.
 *
 * Żeby dało się go poprawić, trzeba wiedzieć **który to wiersz** — a dokładnie
 * to ginęło. `safeParse` zwraca komplet informacji (ścieżkę do pola i powód),
 * a kod rzucał gołe „response has an unknown shape". Zgłoszenie zwrotne
 * przyjeżdżało wtedy z komunikatem, z którego nie wynikało nic poza tym, że
 * *coś* jest nie tak, i diagnoza zaczynała się od przeglądania całej bazy.
 *
 * Stąd ten moduł. Do komunikatu wchodzi ścieżka pola, powód z Zoda oraz
 * `id` i `server_seq` najgłębszego wiersza na tej ścieżce — czyli dokładnie to,
 * czym wiersz da się wskazać w zapytaniu SQL. Komunikat trafia i do bufora
 * logów (zgłoszenie zwrotne), i na ekran po tapnięciu w pigułkę stanu, więc
 * jest **krótki** i nie niesie wartości pól: ścieżka i identyfikator wystarczą,
 * a nazwy, notatki i adresy nie mają czego szukać w logu wysyłanym na serwer.
 */

import type { ZodError } from 'zod';

/** Ile znaków komunikatu ma sens — dalej i tak nikt nie czyta, a log ma limit. */
const MAX_LENGTH = 240;

/**
 * Jedno zdanie o tym, co w odpowiedzi nie pasuje do schematu.
 *
 * Pierwsze znalezisko z kompletu, bo pozostałe są zwykle jego powtórzeniem
 * w kolejnych wierszach — ich liczba zostaje jako doklejka, żeby było widać
 * różnicę między „jeden zepsuty wiersz" a „paczka nie tego kształtu".
 */
export function describeShapeMismatch(body: unknown, error: ZodError): string {
  const [issue, ...rest] = error.issues;
  if (issue === undefined) return 'no details';

  const location = formatPath(issue.path);
  const row = locateRow(body, issue.path);
  const more = rest.length === 0 ? '' : ` (+${String(rest.length)} more)`;

  return truncate(`${location}: ${issue.message}${row === null ? '' : ` [${row}]`}${more}`);
}

/** `changes.exercises[3].name` — tak, jak wygląda dostęp do tego pola w kodzie. */
function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'response root';

  return path.reduce<string>((rendered, segment) => {
    if (typeof segment === 'number') return `${rendered}[${String(segment)}]`;
    const name = String(segment);
    return rendered === '' ? name : `${rendered}.${name}`;
  }, '');
}

/**
 * Wiersz, w którym siedzi niezgodne pole — po `id` i `server_seq`.
 *
 * Schodzimy ścieżką w dół i zapamiętujemy **najgłębsze** napotkane wartości:
 * przy błędzie w pozycji celu cyklu daje to `id` samej pozycji (jest osobnym
 * wierszem w bazie) i `server_seq` cyklu, który ją niesie. Obie wartości są
 * identyfikatorami technicznymi, nie danymi użytkownika.
 */
function locateRow(body: unknown, path: readonly PropertyKey[]): string | null {
  let node: unknown = body;
  let id: string | null = null;
  let serverSeq: number | null = null;

  const inspect = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') id = record.id;
    if (typeof record.serverSeq === 'number') serverSeq = record.serverSeq;
  };

  inspect(node);
  for (const segment of path) {
    if (node === null || typeof node !== 'object') break;
    node = (node as Record<PropertyKey, unknown>)[segment];
    inspect(node);
  }

  const parts: string[] = [];
  if (id !== null) parts.push(`id ${String(id)}`);
  if (serverSeq !== null) parts.push(`server_seq ${String(serverSeq)}`);
  return parts.length === 0 ? null : parts.join(', ');
}

function truncate(message: string): string {
  return message.length <= MAX_LENGTH ? message : `${message.slice(0, MAX_LENGTH - 1)}…`;
}

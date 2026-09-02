/**
 * Konflikty w danych: kształt zgłoszenia i jedyna reguła, która czyści je
 * w locie.
 *
 * Powód istnienia tego pliku jest jeden i widać go w historii repozytorium.
 * Schematy z `schemas.ts` są **kontraktem** — opisują wiersz, który wolno
 * wystawić — ale baza żyje dłużej niż każda reguła, którą do niej dopisujemy.
 * Wiersz zapisany zanim reguła powstała, wiersz zmieniony ręcznie w psql,
 * wiersz, który wyszedł spod ścieżki zapisu naprawionej dopiero w następnym
 * wydaniu — każdy z nich ma prawo leżeć w bazie w kształcie, którego schemat
 * nie przyjmie. A ponieważ ćwiczenia i tagi są **globalne**, jeden taki wiersz
 * nie psuje jednego ekranu: wywala parsowanie całej odpowiedzi i zabiera panel
 * administratorowi oraz synchronizację wszystkim naraz.
 *
 * Stąd podział na dwie rzeczy, które łatwo pomylić:
 *
 * 1. **Serializacja czyści.** `sanitizeAdditionalTagIds` — jak
 *    `sanitizeTranslations` w `languages.ts` — sprowadza zestaw tagów do
 *    kształtu, który przechodzi przez schemat. Dzięki temu zepsuty wiersz
 *    wygląda źle wyłącznie w tym jednym miejscu, w którym jest zepsuty, zamiast
 *    blokować odczyt wszystkiego dookoła.
 * 2. **Panel zgłasza.** Czyszczenie przy odczycie **nie naprawia bazy** —
 *    ono ją maskuje, a zamaskowany konflikt wróci przy najbliższym zapisie tego
 *    wiersza. Dlatego to samo, co serializacja przemilcza, panel wypisuje
 *    wprost: co jest nie tak, na którym wierszu i co zrobi naprawa. Decyzja
 *    zostaje po stronie człowieka, bo część konfliktów da się rozstrzygnąć
 *    tylko wiedząc, co ten wiersz miał znaczyć.
 */

import { z } from 'zod';

/**
 * Zestaw tagów dodatkowych w kształcie, który przejdzie przez `exerciseSchema`.
 *
 * Dwie reguły schematu, obie odtworzone tutaj: tag główny nie powtarza się
 * wśród dodatkowych i dodatkowe nie powtarzają się między sobą. Kolejność
 * zostaje — o niej decyduje `position` w bazie i widać ją w aplikacji.
 *
 * Odsianie tagu, a nie odrzucenie całego ćwiczenia, jest tu wyborem świadomym:
 * zestaw tagów jest zbiorem, więc powtórzony wpis nie niesie żadnej informacji,
 * której zdjęcie by nie zachowało. Ćwiczenie bez jednego tagu dodatkowego
 * dalej jest tym samym ćwiczeniem; ćwiczenie, którego nie da się wczytać, nie
 * jest niczym.
 */
export function sanitizeAdditionalTagIds(
  primaryTagId: string,
  additionalTagIds: readonly string[],
): string[] {
  const seen = new Set<string>([primaryTagId]);
  const clean: string[] = [];
  for (const tagId of additionalTagIds) {
    if (seen.has(tagId)) continue;
    seen.add(tagId);
    clean.push(tagId);
  }
  return clean;
}

/* ------------------------------------------------------------- zgłoszenia */

/**
 * Rodzaje konfliktów, które przegląd potrafi rozpoznać.
 *
 * Lista jest **zamknięta** i to jest sedno tego mechanizmu: panel nie dostaje
 * konsoli do bazy, tylko skończony zestaw sytuacji, które ktoś opisał i którym
 * przypisał naprawę. Nowy rodzaj konfliktu dochodzi tu razem z zapytaniem, które
 * go znajduje, i z naprawą albo z jawnym „tego nie da się naprawić automatem".
 */
export const INTEGRITY_ISSUE_KINDS = [
  /** Tag główny ćwiczenia leży też wśród jego tagów dodatkowych. */
  'exercise_tag_repeats_primary',
  /** Żywe ćwiczenie wskazuje jako główny tag, który ma tombstone. */
  'exercise_primary_tag_deleted',
  /** Ćwiczenie ma dodatkowy tag, który ma tombstone. */
  'exercise_additional_tag_deleted',
  /** Tłumaczenia ćwiczenia, których nie przyjmie `displayNameSchema`. */
  'exercise_translations_invalid',
  /** Tłumaczenia tagu, których nie przyjmie `displayNameSchema`. */
  'tag_translations_invalid',
  /** Kanoniczna nazwa ćwiczenia nie przechodzi przez `displayNameSchema`. */
  'exercise_name_invalid',
  /** Kanoniczna nazwa tagu nie przechodzi przez `displayNameSchema`. */
  'tag_name_invalid',
  /** Kolor tagu nie jest w formacie `#rrggbb`. */
  'tag_color_invalid',
] as const;

export type IntegrityIssueKind = (typeof INTEGRITY_ISSUE_KINDS)[number];

export const integrityIssueKindSchema = z.enum(INTEGRITY_ISSUE_KINDS);

/**
 * Jedno zgłoszenie z przeglądu bazy.
 *
 * `id` jest **wyliczalne z treści konfliktu**, a nie losowe, i dlatego naprawa
 * może iść osobnym żądaniem: panel odsyła identyfikatory, serwer robi przegląd
 * jeszcze raz i naprawia wyłącznie te zgłoszenia, które dalej istnieją. Gdyby
 * identyfikator był losowy, trzeba by trzymać wynik przeglądu w pamięci między
 * żądaniami — i naprawiać na podstawie stanu, którego już może nie być.
 */
export const integrityIssueSchema = z.object({
  /** `kind:encjaId[:tagId]` — stabilne między przeglądami. */
  id: z.string().min(1),
  kind: integrityIssueKindSchema,
  entity: z.enum(['exercise', 'tag']),
  entityId: z.string().min(1),
  /**
   * Nazwa wiersza do pokazania na liście. Surowa z bazy — konflikt bywa właśnie
   * w niej, a podmiana jej na „(bez nazwy)" ukryłaby to, co trzeba zobaczyć.
   */
  entityName: z.string(),
  /** Czy wiersz ma tombstone — usunięte ćwiczenie to inny stopień pilności. */
  entityDeleted: z.boolean(),
  /** Co dokładnie jest nie tak, po ludzku i z nazwami, a nie z samymi id. */
  detail: z.string().min(1),
  /**
   * Co zrobi przycisk „Napraw", albo `null`, gdy naprawy automatycznej nie ma.
   * Bez naprawy zgłoszenie dalej ma sens: mówi, czego szukać w panelu ręcznie.
   */
  repair: z.string().min(1).nullable(),
  /**
   * Czy odczyt już to obchodzi. `true` znaczy „aplikacja działa, ale baza jest
   * krzywa"; `false` — „to widać na ekranie i psuje odczyt tego wiersza".
   */
  maskedOnRead: z.boolean(),
});

export type IntegrityIssue = z.infer<typeof integrityIssueSchema>;

/**
 * Wynik przeglądu.
 *
 * `checkedAt` jest tu, bo przegląd czyta całą bibliotekę i panel pokazuje go
 * jako stan z konkretnej chwili, a nie jako liczbę odświeżaną w tle.
 */
export const integrityReportSchema = z.object({
  checkedAt: z.iso.datetime({ offset: true }),
  issues: z.array(integrityIssueSchema),
});

export type IntegrityReport = z.infer<typeof integrityReportSchema>;

/** Naprawa: które zgłoszenia. Pusta lista nie ma sensu i nie przechodzi. */
export const integrityRepairInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

export type IntegrityRepairInput = z.infer<typeof integrityRepairInputSchema>;

/**
 * Raport naprawy.
 *
 * `repaired` i `skipped` są rozdzielone, bo pominięcie nie jest błędem: między
 * przeglądem a kliknięciem konflikt mógł zniknąć — ktoś poprawił ten wiersz
 * z drugiej strony albo naprawił go inny administrator. `issues` to stan **po**
 * naprawie, żeby panel nie musiał pytać drugi raz.
 */
export const integrityRepairReportSchema = z.object({
  repaired: z.array(z.string().min(1)),
  skipped: z.array(z.string().min(1)),
  checkedAt: z.iso.datetime({ offset: true }),
  issues: z.array(integrityIssueSchema),
});

export type IntegrityRepairReport = z.infer<typeof integrityRepairReportSchema>;

/* --------------------------------------------------- odrzucone wiersze API */

/**
 * Wiersz odpowiedzi, którego panel nie umiał wczytać.
 *
 * To jest druga połowa reguły „nie ma błędu, jest do ogarnięcia" i dotyczy
 * przypadków, których nie przewidzieliśmy: przegląd zna skończoną listę
 * konfliktów, a ta struktura łapie **każdy** wiersz, który nie przeszedł przez
 * schemat — łącznie z tymi, dla których czeku jeszcze nie napisano. Panel
 * pokazuje wtedy resztę listy i osobno mówi, ilu wierszy nie umiał wczytać
 * i dlaczego.
 */
export interface RejectedRow {
  /** Pozycja w tablicy odpowiedzi — jedyne, co jest pewne przy dowolnym śmieciu. */
  index: number;
  /** Identyfikator wyłuskany z surowego wiersza, o ile w ogóle tam był. */
  id: string | null;
  /** Nazwa wyłuskana z surowego wiersza — do rozpoznania wiersza po ludzku. */
  name: string | null;
  /** Pierwszy komunikat ze schematu razem ze ścieżką pola. */
  message: string;
}

/** Ścieżka i komunikat pierwszego problemu — `additionalTagIds: …`. */
export function describeIssue(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map((part) => String(part)).join('.');
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}

const identityShape = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  exercise: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
  tag: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
});

/**
 * Identyfikator i nazwa wyłuskane z wiersza, który schematu nie przeszedł.
 *
 * Best effort i tak ma być: wiersz jest z definicji nie tego kształtu, więc
 * czytamy z niego wyłącznie to, co akurat jest, i nie zakładamy niczego.
 * Wiersze list panelu opakowują encję (`{ exercise, usage }`), więc zaglądamy
 * o jeden poziom głębiej — inaczej najczęstszy przypadek zostałby bez nazwy.
 */
export function identifyRow(row: unknown): { id: string | null; name: string | null } {
  const parsed = identityShape.safeParse(row);
  if (!parsed.success) return { id: null, name: null };
  const { id, name, exercise, tag } = parsed.data;
  const inner = exercise ?? tag;
  return {
    id: id ?? inner?.id ?? null,
    name: name ?? inner?.name ?? null,
  };
}

/**
 * Rozbiór tablicy wiersz po wierszu.
 *
 * Różnica względem `z.array(schema).safeParse` jest cała w tym, co zostaje po
 * niepowodzeniu: tam **nic** — jeden zły wiersz unieważnia całą listę — tutaj
 * reszta wierszy plus opis tych, które odpadły. Dla list globalnych to jest
 * różnica między „panel się nie otwiera" a „panel się otwiera i mówi, co
 * naprawić".
 */
export function parseRows<T>(
  rows: readonly unknown[],
  schema: z.ZodType<T>,
): { items: T[]; rejected: RejectedRow[] } {
  const items: T[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, index) => {
    const parsed = schema.safeParse(row);
    if (parsed.success) {
      items.push(parsed.data);
      return;
    }
    const issue = parsed.error.issues[0];
    rejected.push({
      index,
      ...identifyRow(row),
      message: issue === undefined ? 'wiersz nie pasuje do schematu' : describeIssue(issue),
    });
  });

  return { items, rejected };
}

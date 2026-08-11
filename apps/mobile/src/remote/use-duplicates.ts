/**
 * Pytanie serwera o podobne ćwiczenia w trakcie pisania nazwy.
 *
 * Hak celowo **nie** korzysta z `useRemote`. Tamten opisuje ekran, który czeka na
 * sieć i ma stan „offline" do pokazania; tutaj jest odwrotnie: warstwa serwerowa
 * jest dodatkiem do ostrzeżenia liczonego lokalnie, więc brak odpowiedzi nie ma
 * prawa niczego pokazać ani niczego zablokować. Awaria kończy się `null`, czyli
 * dokładnie tym samym, co jeszcze niewpisana nazwa.
 *
 * Dwie rzeczy ograniczają liczbę żądań:
 *
 * - **Zwłoka po ostatnim naciśnięciu klawisza.** Bez niej każda litera byłaby
 *   jednym żądaniem, a przy włączonym re-rankerze — jednym pytaniem do modelu.
 * - **Minimalna długość nazwy.** Dla dwóch znaków każda odpowiedź jest szumem,
 *   a każde pytanie kosztuje.
 *
 * Odpowiedź, która przyjdzie po zmianie nazwy, jest odrzucana: bez tego wynik
 * dla „mart" mógłby wyprzedzić wynik dla „martwy ciąg" i ekran pokazałby
 * kandydatów do nazwy, której już nie ma w polu.
 */

import type { DuplicateCheckResponse } from '@alphapump/core';
import { useEffect, useState } from 'react';
import type { RemoteReader } from './read-only';

/** Zwłoka po ostatnim naciśnięciu klawisza. */
export const DUPLICATE_QUERY_DELAY_MS = 450;

/** Krótsza nazwa nie ma czego szukać — pytanie byłoby samym szumem. */
export const DUPLICATE_QUERY_MIN_LENGTH = 3;

export function useServerDuplicates(
  reader: RemoteReader,
  name: string,
  excludeId: string | null = null,
): DuplicateCheckResponse | null {
  const [response, setResponse] = useState<DuplicateCheckResponse | null>(null);
  const trimmed = name.trim();

  useEffect(() => {
    if (trimmed.length < DUPLICATE_QUERY_MIN_LENGTH) {
      setResponse(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await reader.similarExercises(trimmed, excludeId);
          if (!cancelled) setResponse(result);
        } catch {
          // Poza VPN-em, przy wyłączonej warstwie albo przy awarii dostawcy
          // modeli zostaje ostrzeżenie lokalne. Cicho, bo to nie jest awaria
          // z punktu widzenia użytkownika, tylko brak dodatku.
          if (!cancelled) setResponse(null);
        }
      })();
    }, DUPLICATE_QUERY_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reader, trimmed, excludeId]);

  return response;
}

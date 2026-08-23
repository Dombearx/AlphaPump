/**
 * Wybrany język w cyklu życia aplikacji.
 *
 * Stan trzyma korzeń, a nie ekran konta — z tego samego powodu co przy tapecie:
 * język decyduje o nazwach na **każdym** ekranie, więc zmiana w ustawieniach ma
 * przerysować całą aplikację od razu, bez wychodzenia i wracania.
 *
 * Implementację magazynu dostajemy z zewnątrz (`store`), a nie importujemy jej
 * tutaj. Dzięki temu plik nie ciągnie za sobą Expo i daje się wyrenderować poza
 * telefonem.
 *
 * ## `useLocalizedName` zamiast tłumaczenia w zapytaniach
 *
 * Nazwa do pokazania powstaje **przy renderowaniu**, a nie w zapytaniu do bazy.
 * Zapytania zwracają nazwę kanoniczną i zestaw tłumaczeń, a wybór jednego z nich
 * należy do ekranu. Gdyby wybierało zapytanie, każda zmiana języka wymagałaby
 * przeliczenia wszystkich zapytań na żywo, a `useLiveQuery` subskrybuje tabele,
 * nie ustawienia — więc lista po prostu nie odświeżałaby się aż do następnego
 * zapisu w bazie.
 */

import { DEFAULT_LANGUAGE, localizedName, type Language, type Translatable } from '@alphapump/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LanguageStore } from './state';

export interface AppLanguage {
  /** Język wybrany na tym urządzeniu; domyślny, dopóki nikt nie wybrał inaczej. */
  language: Language;
  /** Trwa zapis wyboru — przyciski pokazują wtedy kręciołek. */
  busy: boolean;
  choose: (language: Language) => Promise<void>;
}

const LanguageContext = createContext<AppLanguage | null>(null);

export function LanguageProvider({
  store,
  children,
}: {
  store: LanguageStore;
  children: ReactNode;
}) {
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Wybór doczytuje się po pierwszym renderze: dysk jest wolniejszy niż
    // pierwszy ekran, a przez tę jedną klatkę widać nazwy kanoniczne — czyli to
    // samo, co widać przy wierszu bez tłumaczenia.
    void store
      .read()
      .then((stored) => {
        // `setLanguage` z tą samą wartością nie przerysowuje drzewa (React
        // porównuje stan przez `Object.is`), więc start w języku domyślnym —
        // czyli najczęstszy — nie kosztuje ani jednego dodatkowego renderu.
        if (!cancelled) setLanguage(stored);
      })
      .catch(() => {
        if (!cancelled) setLanguage(DEFAULT_LANGUAGE);
      });

    return () => {
      cancelled = true;
    };
  }, [store]);

  const choose = useCallback(
    async (next: Language) => {
      setBusy(true);
      // Ekran przestawia się od razu, a zapis idzie w tle. Nieudany zapis znaczy
      // tyle, że po restarcie wróci poprzedni język — a to jest mniejsza szkoda
      // niż przycisk, który przez sekundę nie robi nic.
      setLanguage(next);
      try {
        await store.write(next);
      } catch {
        // Celowo bez komunikatu: patrz wyżej.
      } finally {
        setBusy(false);
      }
    },
    [store],
  );

  const value = useMemo<AppLanguage>(() => ({ language, busy, choose }), [language, busy, choose]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useAppLanguage(): AppLanguage {
  const value = useContext(LanguageContext);
  if (value === null) throw new Error('useAppLanguage outside LanguageProvider');
  return value;
}

/**
 * Nazwa encji w wybranym języku — jedna funkcja na ekran, zamiast wyciągania
 * języka i wołania `localizedName` w każdym wierszu.
 *
 * Brak tłumaczenia nie jest błędem: funkcja cofa się wtedy do nazwy kanonicznej
 * (patrz `localizedName` w rdzeniu), więc ekran wygląda dokładnie tak, jak
 * wyglądał przed dodaniem języków.
 */
export function useLocalizedName(): (entity: Translatable) => string {
  const { language } = useAppLanguage();
  return useCallback((entity: Translatable) => localizedName(entity, language), [language]);
}

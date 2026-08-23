/**
 * Montowanie ekranu na prawdziwej bazie lokalnej.
 *
 * Baza powstaje z tego samego bundle'a migracji i tego samego seeda, co na
 * telefonie (`createLocalDatabase`), więc ekran widzi bibliotekę wbudowaną
 * dokładnie taką, jaką zobaczy po pierwszym uruchomieniu aplikacji.
 */

import { DEFAULT_LANGUAGE, type Language } from '@alphapump/core';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { LanguageProvider } from '../../src/language/provider';
import type { LanguageStore } from '../../src/language/state';
import { createLocalDatabase, insertTestUser } from '../local-database';
import { setLiveDatabase } from './live-database';
import type { SqliteDatabase } from '@alphapump/db/sqlite';

export interface MountedScreen {
  db: SqliteDatabase;
  close: () => void;
}

/** Czysta baza z kontem testowym, podpięta pod atrapę `src/db/client`. */
export async function openLocalDatabase(): Promise<MountedScreen> {
  const local = await createLocalDatabase();
  await insertTestUser(local.db);
  setLiveDatabase(local.db);

  return {
    db: local.db,
    close: () => {
      setLiveDatabase(null);
      local.close();
    },
  };
}

/** Magazyn języka w pamięci — telefon trzyma go w pliku, test w zmiennej. */
function memoryLanguageStore(language: Language): LanguageStore {
  let current = language;
  return {
    read: () => Promise.resolve(current),
    write: (next) => {
      current = next;
      return Promise.resolve();
    },
  };
}

/**
 * Renderuje ekran w takim opakowaniu, w jakim stoi on w aplikacji.
 *
 * `LanguageProvider` jest tu, a nie w każdym teście z osobna, bo w aplikacji
 * jest w korzeniu — ekran bez niego nie renderuje się w ogóle, więc pominięcie
 * go w teście znaczyłoby, że test sprawdza inne drzewo niż telefon.
 */
export async function mount(
  element: ReactElement,
  language: Language = DEFAULT_LANGUAGE,
): Promise<void> {
  render(<LanguageProvider store={memoryLanguageStore(language)}>{element}</LanguageProvider>);
  // Zapisany wybór doczytuje się z magazynu **po** pierwszym renderze — tak samo
  // na telefonie, gdzie jest to odczyt z dysku. Bez przepuszczenia tej jednej
  // kolejki mikrozadań test oglądałby ekran sprzed wczytania ustawienia, czyli
  // zawsze w języku domyślnym.
  await act(async () => undefined);
}

/**
 * Wejście użytkownika bez odstępu między klawiszami.
 *
 * Domyślnie `user-event` czeka jedno makrozadanie po **każdym** znaku, a każdy
 * znak przerysowuje ekran i przelicza wszystkie jego zapytania do bazy. Przy
 * dłuższej nazwie i obciążonym runnerze wychodziło z tego kilka sekund i test
 * wywracał się na limicie czasu — nie z powodu błędu, tylko z powodu odstępu,
 * którego nikt tu nie sprawdza.
 */
export function user() {
  return userEvent.setup({ delay: null });
}

/**
 * Cała treść ekranu jednym napisem.
 *
 * Asercje na tekście, a nie na strukturze: to tekst jest tym, co użytkownik
 * czyta, a struktura zmienia się przy każdym przestawieniu kart i wtedy test
 * pada bez powodu.
 */
export function screenText(): string {
  return document.body.textContent ?? '';
}

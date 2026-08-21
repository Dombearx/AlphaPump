/**
 * Montowanie ekranu na prawdziwej bazie lokalnej.
 *
 * Baza powstaje z tego samego bundle'a migracji i tego samego seeda, co na
 * telefonie (`createLocalDatabase`), więc ekran widzi bibliotekę wbudowaną
 * dokładnie taką, jaką zobaczy po pierwszym uruchomieniu aplikacji.
 */

import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
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

/** Renderuje ekran i zwraca tekst, który widzi użytkownik — bez znaczników. */
export function mount(element: ReactElement): void {
  render(element);
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

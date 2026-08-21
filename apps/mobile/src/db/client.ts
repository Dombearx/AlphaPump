/**
 * Baza lokalna — źródło prawdy dla interfejsu.
 *
 * Specyfikacja stawia sprawę jasno: lokalna baza jest głównym źródłem odczytu
 * i zapisu, a synchronizacja tylko wymienia dane w tle. Ekran nigdy nie czeka
 * na sieć, bo nigdy jej nie pyta.
 *
 * Dwie rzeczy są tu ustawione świadomie:
 *
 * - **`enableChangeListener: true`.** Domyślnie wyłączone, a bez niego
 *   `useLiveQuery` nie dostaje powiadomień o zapisie i ekran nie przerysowuje
 *   się sam. Efekt jest podstępny: wszystko działa, tylko dane „nie odświeżają
 *   się", dopóki nie wejdzie się w widok ponownie.
 * - **`PRAGMA foreign_keys = ON`.** SQLite ma więzy domyślnie wyłączone.
 *   Schemat lokalny ma komplet kluczy obcych i to jest celowe — pull odracza
 *   ich sprawdzanie do `COMMIT`, zamiast je zdejmować.
 * - **`PRAGMA journal_mode = WAL`.** Domyślny dziennik (`delete`) blokuje odczyty
 *   na czas zapisu, a aplikacja zapisuje serię dokładnie wtedy, gdy
 *   `useLiveQuery` czyta historię, żeby przeliczyć rekordy. Przy zapisie paczki
 *   pullu — do pięciuset wierszy w jednej transakcji — widać to jako zacięcie
 *   interfejsu. WAL puszcza czytających obok piszącego.
 * - **`PRAGMA synchronous = NORMAL`.** Razem z WAL to zalecane ustawienie
 *   SQLite: `FULL` wymusza `fsync` przy każdym zatwierdzeniu, a przy WAL grozi
 *   to wyłącznie utratą ostatnich transakcji przy nagłym padzie systemu — nie
 *   uszkodzeniem bazy. Zapis serii ma być natychmiastowy.
 */

import {
  cycleGoals,
  cycles,
  exerciseTags,
  exercises,
  tags,
  users,
  workoutSets,
} from '@alphapump/db/sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

export const DATABASE_NAME = 'alphapump.db';

export const schema = {
  users,
  tags,
  exercises,
  exerciseTags,
  workoutSets,
  cycles,
  cycleGoals,
} as const;

export const sqlite = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });

sqlite.execSync('PRAGMA journal_mode = WAL;');
sqlite.execSync('PRAGMA synchronous = NORMAL;');
sqlite.execSync('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });

export type LocalDatabase = typeof db;

/**
 * Strona natywna eksportu do FitNotesa: wybór pliku, otwarcie go jako bazy
 * SQLite, oddanie z powrotem i rejestr na dysku.
 *
 * Wszystko, co dotyka Expo, jest **tutaj i tylko tutaj** — plan (`@alphapump/core`),
 * zapis (`file.ts`) i rejestr (`state.ts`) są czyste i przetestowane w Node.
 * Ten plik jest cienki celowo: to jedyna warstwa, której testy nie obejmują,
 * więc ma nie zawierać decyzji.
 *
 * ## Dlaczego kopia, a nie plik użytkownika w miejscu
 *
 * Android oddaje wybrany plik jako `content://`, a nie jako ścieżkę — pod tym
 * adresem SQLite nie ma czego otworzyć i nie ma gdzie zapisać. Bierzemy więc
 * kopię do pamięci podręcznej, dopisujemy do niej i oddajemy gotowy plik
 * systemowym udostępnianiem, żeby użytkownik odłożył go tam, skąd czyta go
 * FitNotes. Oryginał zostaje nietknięty, dopóki tego nie zrobi — co przy
 * operacji na czyjejś jedynej kopii treningów jest zaletą, a nie ustępstwem.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as SQLite from 'expo-sqlite';
import * as Sharing from 'expo-sharing';
import type { FitNotesDatabase, FitNotesValue } from './file';
import {
  EMPTY_FITNOTES_STATE,
  parseFitNotesState,
  serializeFitNotesState,
  type FitNotesState,
} from './state';

/** Kopie robocze plików FitNotesa — do wyrzucenia po udostępnieniu. */
const WORKING_DIRECTORY = 'fitnotes';

/** Rejestr przeżywa restart aplikacji, więc nie może leżeć w pamięci podręcznej. */
const REGISTRY_FILE = 'fitnotes-export.json';

/** SQLite dostaje ścieżkę w systemie plików, a `expo-file-system` mówi adresami. */
function nativePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function workingDirectory(): Directory {
  const directory = new Directory(Paths.cache, WORKING_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

/** Otwarty plik kopii razem z tym, co można z nim zrobić po zapisie. */
export interface OpenFitNotesBackup {
  name: string;
  database: FitNotesDatabase;
  /** Oddaje gotowy plik systemowemu udostępnianiu. */
  share: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Prosi o plik kopii i otwiera jego kopię roboczą. `null` znaczy „użytkownik
 * zrezygnował" — nie jest to błąd i nie ma o czym mówić na ekranie.
 */
export async function pickFitNotesBackup(): Promise<OpenFitNotesBackup | null> {
  // Rozszerzenie `.fitnotes` nie ma zarejestrowanego typu MIME, więc zawężenie
  // listy do czegokolwiek ukryłoby przed użytkownikiem plik, po który przyszedł.
  const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (picked.canceled) return null;

  const asset = picked.assets[0];
  if (!asset) return null;

  const directory = workingDirectory();
  for (const entry of directory.list()) entry.delete();

  const working = new File(directory, asset.name);
  await new File(asset.uri).copy(working);

  const database = await SQLite.openDatabaseAsync(working.name, {}, nativePath(directory.uri));

  return {
    name: asset.name,
    database: {
      all: <T>(sql: string, params: readonly FitNotesValue[] = []) =>
        database.getAllAsync<T>(sql, [...params]),
      run: async (sql: string, params: readonly FitNotesValue[] = []) =>
        (await database.runAsync(sql, [...params])).lastInsertRowId,
    },
    share: async () => {
      if (!(await Sharing.isAvailableAsync())) return;
      await Sharing.shareAsync(working.uri, {
        mimeType: 'application/octet-stream',
        dialogTitle: 'FitNotes backup with your AlphaPump sets',
      });
    },
    close: () => database.closeAsync(),
  };
}

/* ------------------------------------------------------------------ rejestr */

export async function readFitNotesState(): Promise<FitNotesState> {
  const file = new File(Paths.document, REGISTRY_FILE);
  if (!file.exists) return EMPTY_FITNOTES_STATE;
  return parseFitNotesState(await file.text());
}

export async function writeFitNotesState(state: FitNotesState): Promise<void> {
  const file = new File(Paths.document, REGISTRY_FILE);
  if (!file.exists) file.create();
  file.write(serializeFitNotesState(state));
}

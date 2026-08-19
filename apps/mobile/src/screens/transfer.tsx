/**
 * Eksport i import danych z telefonu.
 *
 * Ekran jest cienki nad `src/transfer/`, bo cała logika siedzi tam i jest
 * testowana bez renderowania. Tutaj zostają trzy rzeczy, których nie da się
 * zrobić poza urządzeniem: zapis pliku, otwarcie okna udostępniania i wybór pliku
 * do wgrania.
 *
 * ## Dlaczego to działa offline
 *
 * Telefon ma u siebie całą historię właściciela, więc eksport nie potrzebuje ani
 * sieci, ani VPN-a — a to jest ta ścieżka, z której ludzie korzystają realnie
 * (`GET /export` jest dla panelu i dla kopii systemowej). Import też wchodzi do
 * bazy lokalnej od razu: dane widać na ekranie natychmiast, a na serwer jadą
 * outboxem, gdy łączność wróci.
 *
 * ## Co ekran mówi wprost
 *
 * Że w pliku nie ma haseł ani kluczy API i że dane wrócą na serwer dopiero po
 * synchronizacji. Jedno i drugie jest nieoczywiste, a błędne założenie w którymś
 * z tych miejsc kończy się utratą zaufania do kopii.
 *
 * ## Trzecia sekcja: FitNotes
 *
 * Eksport do kopii FitNotesa jest tutaj, a nie na osobnym ekranie, bo to ta sama
 * sprawa: wyjęcie własnych treningów do pliku. Różni się jedną rzeczą, która
 * wymaga rozmowy z użytkownikiem — kategorią, której w jego pliku nie ma i
 * której darmowy FitNotes nie pozwala utworzyć. Dlatego ta sekcja ma dwa kroki:
 * najpierw pokazuje, co się stanie, i dopiero potwierdzenie pisze do pliku.
 *
 * ## Czwarta sekcja: import z FitNotesa
 *
 * Import idzie jednym krokiem, bo nie ma o co pytać: tagi i ćwiczenia, których
 * u nas nie ma, po prostu zakładamy, a duplikaty rozpoznaje sam plik zestawiony
 * z bazą. Wynik pokazujemy tak jak przy imporcie archiwum — liczbami.
 */

import {
  archiveSummary,
  parseArchive,
  planFitNotesExport,
  planFitNotesImport,
  type Archive,
  type FitNotesSourceSet,
  type FitNotesTarget,
} from '@alphapump/core';
import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../db/client';
import {
  pickFitNotesBackup,
  readFitNotesState,
  writeFitNotesState,
  type OpenFitNotesBackup,
} from '../fitnotes/expo';
import {
  applyFitNotesPlan,
  readFitNotesLog,
  readFitNotesTarget,
  type FitNotesWriteReport,
} from '../fitnotes/file';
import { applyFitNotesImport, type FitNotesImportReport } from '../fitnotes/import';
import { fitNotesLibrary, fitNotesSourceSets } from '../fitnotes/source';
import { withCategoryChoices, withExportedKeys, type FitNotesState } from '../fitnotes/state';
import { useLocalAuthor } from '../hooks';
import { useRequestSync } from '../sync/provider';
import { archiveFileName, exportLocalArchive } from '../transfer/export';
import { importLocalArchive, type LocalImportReport } from '../transfer/import';
import { Button, Card, Chip, ChipRow, Loading, SectionTitle } from '../ui/primitives';

/** Wybrany plik kopii razem ze wszystkim, z czego liczy się plan zapisu. */
interface FitNotesSession {
  backup: OpenFitNotesBackup;
  target: FitNotesTarget;
  registry: FitNotesState;
  sets: FitNotesSourceSet[];
  /** Wybory z tego podejścia: kategoria AlphaPump → kategoria z pliku. */
  choices: Record<string, string>;
}

export function TransferScreen() {
  const author = useLocalAuthor();
  const requestSync = useRequestSync();

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [exported, setExported] = useState<Archive | null>(null);
  const [report, setReport] = useState<LocalImportReport | null>(null);
  const [session, setSession] = useState<FitNotesSession | null>(null);
  const [written, setWritten] = useState<FitNotesWriteReport | null>(null);
  const [pulled, setPulled] = useState<FitNotesImportReport | null>(null);

  if (author === null) return <Loading />;

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);

    void (async () => {
      try {
        await action();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'The operation failed');
      } finally {
        setBusy(false);
      }
    })();
  };

  const exportData = () =>
    run(async () => {
      setReport(null);
      const archive = await exportLocalArchive(db, author.userId);

      // Katalog pamięci podręcznej, nie dokumentów: plik jest tylko po to, żeby
      // przekazać go dalej systemowym udostępnianiem. Trzymanie kopii historii
      // treningowej w pamięci aplikacji bez powodu byłoby gromadzeniem danych.
      const file = new File(new Directory(Paths.cache), archiveFileName());
      if (file.exists) file.delete();
      file.create();
      file.write(JSON.stringify(archive));

      setExported(archive);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'AlphaPump data export',
        });
      }
    });

  const importData = () =>
    run(async () => {
      setExported(null);
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;

      const asset = picked.assets[0];
      if (!asset) return;

      const archive = parseArchive(JSON.parse(await new File(asset.uri).text()));
      const outcome = await importLocalArchive(db, archive, {
        userId: author.userId,
        email: author.email,
        deviceId: author.deviceId,
      });

      setReport(outcome);
      // Import kolejkuje mutacje; synchronizacja wypchnie je, gdy będzie łączność.
      requestSync();
    });

  /**
   * Plan liczy się przy każdym rysowaniu. Jest czysty i tani, a dzięki temu
   * podgląd nadąża za wyborem kategorii bez drugiego stanu, który mógłby się
   * rozjechać z tym, co za chwilę pojedzie do pliku.
   */
  const plan =
    session === null
      ? null
      : planFitNotesExport({
          sets: session.sets,
          target: session.target,
          categoryMapping: { ...session.registry.categories, ...session.choices },
          exportedKeys: session.registry.exported,
        });

  const pickBackup = () =>
    run(async () => {
      setWritten(null);
      setPulled(null);
      await session?.backup.close();
      setSession(null);

      // Rejestr przed plikiem: gdy jest nieczytelny, lepiej odmówić od razu, niż
      // po wyborze pliku zaproponować dopisanie całej historii po raz drugi.
      const registry = await readFitNotesState();
      const backup = await pickFitNotesBackup();
      if (backup === null) return;

      setSession({
        backup,
        target: await readFitNotesTarget(backup.database),
        registry,
        sets: await fitNotesSourceSets(db, author.userId),
        choices: {},
      });
    });

  const chooseCategory = (from: string, to: string) =>
    setSession((current) =>
      current === null ? null : { ...current, choices: { ...current.choices, [from]: to } },
    );

  const writeBackup = () =>
    run(async () => {
      if (session === null || plan === null) return;

      const outcome = await applyFitNotesPlan(session.backup.database, session.target, plan);
      // Rejestr dopiero po udanym zapisie — odhaczenie wcześniej zgubiłoby serie
      // przy błędzie w transakcji, a tego już nic by nie naprawiło.
      await writeFitNotesState(
        withExportedKeys(withCategoryChoices(session.registry, session.choices), plan.keys),
      );
      await session.backup.share();
      await session.backup.close();

      setSession(null);
      setWritten(outcome);
    });

  const importFitNotes = () =>
    run(async () => {
      setWritten(null);
      setPulled(null);
      // Wybór pliku czyści katalog roboczy, więc otwarta sesja eksportu straciłaby
      // spod siebie plik. Zamykamy ją, zamiast zostawiać podgląd, który nie ma
      // już pokrycia.
      await session?.backup.close();
      setSession(null);

      const backup = await pickFitNotesBackup();
      if (backup === null) return;

      try {
        const library = await fitNotesLibrary(db, author.userId);
        const plan = planFitNotesImport({
          entries: await readFitNotesLog(backup.database),
          known: library,
          existing: await fitNotesSourceSets(db, author.userId),
        });

        setPulled(await applyFitNotesImport(db, plan, library, author));
      } finally {
        await backup.close();
      }

      // Tak jak przy imporcie archiwum: dane są już na ekranie, na serwer jadą
      // outboxem przy najbliższej synchronizacji.
      requestSync();
    });

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Export and import' }} />

      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="gap-2">
          <SectionTitle>Export</SectionTitle>
          <Text className="text-muted">
            A JSON file with your sets, cycles, and the exercises and tags they reference. No
            passwords, no API keys. Works offline — the data lives on this device.
          </Text>
          <View className="mt-1">
            <Button label="Export data" busy={busy} onPress={exportData} />
          </View>
          {exported !== null && (
            <Text className="text-success">
              {(() => {
                const summary = archiveSummary(exported);
                return (
                  `Done: ${String(summary.sets)} sets, ` +
                  `${String(summary.exercises)} exercises, ${String(summary.cycles)} cycles.`
                );
              })()}
            </Text>
          )}
        </Card>

        <Card className="gap-2">
          <SectionTitle>Import</SectionTitle>
          <Text className="text-muted">
            Loads the file into this device's database. Data older than what's already here won't
            undo changes — the same rule as sync applies. It reaches the server on the next sync.
          </Text>
          <View className="mt-1">
            <Button variant="secondary" label="Load file" busy={busy} onPress={importData} />
          </View>

          {report !== null && (
            <View className="gap-1">
              <Text className="text-success">
                Imported: {String(report.imported.sets)} sets, {String(report.imported.exercises)}{' '}
                exercises, {String(report.imported.cycles)} cycles.
              </Text>
              {report.remappedExercises > 0 && (
                <Text className="text-xs text-muted">
                  Reassigned {String(report.remappedExercises)} exercises — the file was created
                  under an account with a different ID.
                </Text>
              )}
              {report.notes.map((note) => (
                <Text key={note} className="text-xs text-muted">
                  {note}
                </Text>
              ))}
            </View>
          )}
        </Card>

        <Card className="gap-2">
          <SectionTitle>Export to FitNotes</SectionTitle>
          <Text className="text-muted">
            Adds your sets to a FitNotes backup file — pick the file, see what will be written, then
            share the result back to the folder FitNotes restores from. Sets that already went there
            are skipped, so you can repeat it after every workout.
          </Text>
          <View className="mt-1">
            <Button
              variant="secondary"
              label="Pick FitNotes backup"
              busy={busy}
              onPress={pickBackup}
            />
          </View>

          {session !== null && plan !== null && (
            <View className="gap-2">
              <Text className="text-xs text-muted">{session.backup.name}</Text>
              <Text className="text-text">
                {String(plan.rows.length)} sets to add, {String(plan.alreadyExported)} already
                there, {String(plan.exercisesToCreate.length)} exercises to create.
              </Text>

              {plan.missingCategories.length > 0 && (
                <View className="gap-2">
                  <Text className="text-muted">
                    FitNotes can&apos;t create categories, so {String(plan.blocked)} sets are
                    waiting. Pick an existing category to use instead — the choice is remembered.
                  </Text>
                  {plan.missingCategories.map((name) => (
                    <View key={name} className="gap-1">
                      <Text className="text-text">{name}</Text>
                      <ChipRow wrap>
                        {session.target.categories.map((category) => (
                          <Chip
                            key={category.id}
                            label={category.name}
                            selected={session.choices[name] === category.name}
                            onPress={() => {
                              chooseCategory(name, category.name);
                            }}
                          />
                        ))}
                      </ChipRow>
                    </View>
                  ))}
                </View>
              )}

              <Button
                label="Write to file"
                busy={busy}
                disabled={plan.missingCategories.length > 0 || plan.rows.length === 0}
                onPress={writeBackup}
              />
            </View>
          )}

          {written !== null && (
            <Text className="text-success">
              Wrote {String(written.sets)} sets and {String(written.exercises)} new exercises.
              Restore the shared file in FitNotes.
            </Text>
          )}
        </Card>

        <Card className="gap-2">
          <SectionTitle>Import from FitNotes</SectionTitle>
          <Text className="text-muted">
            Reads a FitNotes backup file and adds its training log here. Your data stays — only what
            isn&apos;t already on this device is added, so you can repeat it safely. Missing
            exercises and tags are created from the file. It reaches the server on the next sync.
          </Text>
          <View className="mt-1">
            <Button
              variant="secondary"
              label="Import FitNotes backup"
              busy={busy}
              onPress={importFitNotes}
            />
          </View>

          {pulled !== null && (
            <View className="gap-1">
              <Text className="text-success">
                Imported: {String(pulled.sets)} sets, {String(pulled.exercises)} new exercises.
              </Text>
              <Text className="text-xs text-muted">
                {String(pulled.duplicates)} entries were already here
                {pulled.skipped > 0 && `, ${String(pulled.skipped)} couldn't be read`}.
              </Text>
            </View>
          )}
        </Card>

        {problem !== null && <Text className="text-danger">{problem}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

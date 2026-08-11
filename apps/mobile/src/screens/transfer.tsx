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
 */

import { archiveSummary, parseArchive, type Archive } from '@alphapump/core';
import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../db/client';
import { useLocalAuthor } from '../hooks';
import { useRequestSync } from '../sync/provider';
import { archiveFileName, exportLocalArchive } from '../transfer/export';
import { importLocalArchive, type LocalImportReport } from '../transfer/import';
import { Button, Card, Loading, SectionTitle } from '../ui/primitives';

export function TransferScreen() {
  const author = useLocalAuthor();
  const requestSync = useRequestSync();

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [exported, setExported] = useState<Archive | null>(null);
  const [report, setReport] = useState<LocalImportReport | null>(null);

  if (author === null) return <Loading />;

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);

    void (async () => {
      try {
        await action();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Operacja się nie udała');
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
          dialogTitle: 'Eksport danych AlphaPump',
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

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Eksport i import' }} />

      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="gap-2">
          <SectionTitle>Eksport</SectionTitle>
          <Text className="text-muted">
            Plik JSON z Twoimi seriami, cyklami oraz ćwiczeniami i tagami, których dotyczą. Bez
            haseł i bez kluczy API. Działa bez internetu — dane są na tym urządzeniu.
          </Text>
          <View className="mt-1">
            <Button label="Wyeksportuj dane" busy={busy} onPress={exportData} />
          </View>
          {exported !== null && (
            <Text className="text-success">
              {(() => {
                const summary = archiveSummary(exported);
                return (
                  `Gotowe: ${String(summary.sets)} serii, ` +
                  `${String(summary.exercises)} ćwiczeń, ${String(summary.cycles)} cykli.`
                );
              })()}
            </Text>
          )}
        </Card>

        <Card className="gap-2">
          <SectionTitle>Import</SectionTitle>
          <Text className="text-muted">
            Wgrywa plik do bazy na tym urządzeniu. Dane starsze niż to, co już tu jest, nie cofną
            zmian — rozstrzyga ta sama reguła co przy synchronizacji. Na serwer pojadą przy
            najbliższej wymianie danych.
          </Text>
          <View className="mt-1">
            <Button variant="secondary" label="Wgraj plik" busy={busy} onPress={importData} />
          </View>

          {report !== null && (
            <View className="gap-1">
              <Text className="text-success">
                Zaimportowano: {String(report.imported.sets)} serii,{' '}
                {String(report.imported.exercises)} ćwiczeń, {String(report.imported.cycles)} cykli.
              </Text>
              {report.remappedExercises > 0 && (
                <Text className="text-xs text-muted">
                  Przypisano na nowo {String(report.remappedExercises)} ćwiczeń — plik powstał na
                  koncie o innym identyfikatorze.
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

        {problem !== null && <Text className="text-danger">{problem}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

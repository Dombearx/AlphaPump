/**
 * Okno „jest nowa wersja".
 *
 * Pokazuje się nad całą aplikacją, bo dotyczy aplikacji, a nie ekranu — i przy
 * starcie, zanim ktokolwiek się zaloguje. Da się je zamknąć: aktualizacja
 * wewnątrz VPN-u nie jest pilna na tyle, żeby blokować wejście do treningu,
 * a okno bez wyjścia jest dokładnie tym, co uczy ludzi klikać na oślep.
 *
 * Dwa warianty, bo są to dwie różne prośby do użytkownika: „uruchom ponownie",
 * gdy paczka JavaScriptu już się pobrała, i „pobierz nowy pakiet", gdy ruszyła
 * warstwa natywna. Pierwsze jest jednym kliknięciem, drugie — pobraniem
 * kilkudziesięciu megabajtów i rozmową z instalatorem systemu, i dlatego mówi
 * wprost, ile to waży.
 *
 * Oba dzieją się **w aplikacji**. Przeglądarka została jako droga zapasowa,
 * pokazywana dopiero wtedy, gdy pobranie albo instalacja się nie udadzą — bo
 * wtedy naprawdę jest lepsza niż powtórzenie tego samego kliknięcia.
 *
 * Komponent nie zna ani sieci, ani systemu — całość siedzi w `useUpdateCheck`,
 * a napisy o postępie w `update/install.ts`. Tutaj jest wyłącznie układ.
 */

import { Modal, Text, View } from 'react-native';
import { formatBytes } from '../update/manifest';
import type { InstallStage } from '../update/install';
import { downloadFraction, downloadLabel } from '../update/install';
import { useUpdateCheck } from '../update/use-update';
import { Button, SectionTitle } from './primitives';

export function UpdatePrompt() {
  const { stage, confirm, dismiss, install, openInBrowser } = useUpdateCheck();
  if (stage.kind === 'none') return null;

  const busy = install.kind === 'downloading' || install.kind === 'installing';

  return (
    <Modal animationType="fade" transparent visible onRequestClose={dismiss}>
      <View className="flex-1 justify-end bg-black/60 p-4">
        <View className="gap-4 rounded-2xl border border-border bg-surface p-5">
          {stage.kind === 'restart' ? (
            <RestartContents />
          ) : (
            <NativeContents manifest={stage.manifest} install={install} />
          )}

          <View className="flex-row gap-2">
            <Button
              label={install.kind === 'failed' ? 'Open in browser' : 'Not now'}
              variant="secondary"
              onPress={install.kind === 'failed' ? openInBrowser : dismiss}
              disabled={busy}
              grow
            />
            <Button label={confirmLabel(stage.kind, install)} onPress={confirm} busy={busy} grow />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function confirmLabel(stage: 'restart' | 'native', install: InstallStage): string {
  if (stage === 'restart') return 'Restart';
  return install.kind === 'failed' ? 'Try again' : 'Download';
}

/** Paczka JavaScriptu jest już na telefonie — zostało ją uruchomić. */
function RestartContents() {
  return (
    <View className="gap-1">
      <SectionTitle>Update ready</SectionTitle>
      <Text className="text-xl font-semibold text-text">Restart to apply it</Text>
      <Text className="text-muted">
        It is already downloaded. Restarting takes a moment — or it will start on its own next time
        you open the app.
      </Text>
    </View>
  );
}

/**
 * Wydanie natywne. Numer w nawiasie to `versionCode` — poza wydaniem z tagu
 * jest jedynym, co odróżnia dwa kolejne wydania, bo `versionName` zmienia się
 * dopiero przy tagu.
 */
function NativeContents({
  manifest,
  install,
}: {
  manifest: { versionName: string; versionCode: number; size: number; notes: string };
  install: InstallStage;
}) {
  return (
    <View className="gap-1">
      <SectionTitle>New version to install</SectionTitle>
      <Text className="text-xl font-semibold text-text">
        Version {manifest.versionName} ({manifest.versionCode})
      </Text>
      <InstallStatus manifest={manifest} install={install} />
      {manifest.notes.length > 0 && install.kind === 'idle' && (
        <Text className="mt-2 text-text">{manifest.notes}</Text>
      )}
    </View>
  );
}

/**
 * Pasek pobierania. Bez znanego rozmiaru nie ma czego rysować — zostaje sam
 * napis wyżej, bo pasek, który stoi w miejscu, mówi mniej niż jego brak.
 */
function DownloadBar({ fraction }: { fraction: number | null }) {
  if (fraction === null) return null;

  return (
    <View className="h-1.5 overflow-hidden rounded-full bg-border">
      <View className="h-full rounded-full bg-accent" style={{ width: `${fraction * 100}%` }} />
    </View>
  );
}

/**
 * Zdanie pod numerem wersji — zmienia się razem z tym, co się właśnie dzieje.
 * Jedno miejsce zamiast czterech gałęzi w układzie wyżej.
 */
function InstallStatus({
  manifest,
  install,
}: {
  manifest: { size: number };
  install: InstallStage;
}) {
  if (install.kind === 'downloading') {
    return (
      <View className="gap-2">
        <Text className="text-muted">{downloadLabel(install.received, install.total)}</Text>
        <DownloadBar fraction={downloadFraction(install.received, install.total)} />
      </View>
    );
  }

  if (install.kind === 'installing') {
    return <Text className="text-muted">Downloaded. Your phone takes over from here.</Text>;
  }

  if (install.kind === 'failed') {
    return <Text className="text-text">{install.reason}</Text>;
  }

  return (
    <Text className="text-muted">
      {formatBytes(manifest.size)} — this one changes the app itself, so it downloads here and your
      phone installs it. Make sure you are on the VPN.
    </Text>
  );
}

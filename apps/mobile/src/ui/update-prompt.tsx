/**
 * Okno „jest nowa wersja".
 *
 * Pokazuje się nad całą aplikacją, bo dotyczy aplikacji, a nie ekranu — i przy
 * starcie, zanim ktokolwiek się zaloguje. Da się je zamknąć: aktualizacja
 * wewnątrz VPN-u nie jest pilna na tyle, żeby blokować wejście do treningu,
 * a okno bez wyjścia jest dokładnie tym, co uczy ludzi klikać na oślep.
 *
 * Komponent nie zna ani sieci, ani systemu plików — całość siedzi w
 * `useUpdateCheck`. Tutaj są wyłącznie napisy i układ.
 */

import { Modal, Text, View } from 'react-native';
import { formatBytes } from '../update/manifest';
import { useUpdateCheck } from '../update/use-update';
import { Button, ProgressBar, SectionTitle } from './primitives';

export function UpdatePrompt() {
  const { stage, install, dismiss, openSettings } = useUpdateCheck();
  if (stage.kind === 'none') return null;

  const downloading = stage.kind === 'downloading';
  const failed = stage.kind === 'failed';

  return (
    <Modal
      animationType="fade"
      transparent
      visible
      // Systemowy „wstecz" ma zamykać okno tak samo jak „Nie teraz" — inaczej
      // wygląda na zawieszone. Podczas pobierania nie, bo plik jest w drodze.
      onRequestClose={downloading ? undefined : dismiss}
    >
      <View className="flex-1 justify-end bg-black/60 p-4">
        <View className="gap-4 rounded-2xl border border-border bg-surface p-5">
          <View className="gap-1">
            <SectionTitle>Aktualizacja</SectionTitle>
            {/* Numer w nawiasie to `versionCode` — poza wydaniem z tagu jest
                jedynym, co odróżnia dwa kolejne wydania, bo `versionName`
                zmienia się dopiero przy tagu. */}
            <Text className="text-xl font-semibold text-text">
              Wersja {stage.manifest.versionName} ({stage.manifest.versionCode})
            </Text>
            <Text className="text-muted">
              {formatBytes(stage.manifest.size)} — pobierze się z serwera w VPN-ie.
            </Text>
          </View>

          {stage.manifest.notes.length > 0 && !downloading && (
            <Text className="text-text">{stage.manifest.notes}</Text>
          )}

          {downloading && <DownloadProgressView {...stage.progress} />}

          {failed && <Text className="text-danger">{stage.message}</Text>}

          {downloading ? (
            <Text className="text-center text-xs text-muted">
              Po pobraniu system zapyta o zgodę na instalację.
            </Text>
          ) : (
            <View className="gap-2">
              <View className="flex-row gap-2">
                <Button label="Nie teraz" variant="secondary" onPress={dismiss} grow />
                <Button label={failed ? 'Spróbuj ponownie' : 'Zainstaluj'} onPress={install} grow />
              </View>
              {failed && (
                <Button label="Ustawienia instalacji" variant="secondary" onPress={openSettings} />
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * Pasek pobierania. `totalBytes` bywa `-1`, gdy serwer nie podał
 * `Content-Length` — wtedy nie ma z czego liczyć udziału i pokazujemy same
 * megabajty, zamiast paska udającego, że wie, ile zostało.
 */
function DownloadProgressView({
  bytesWritten,
  totalBytes,
}: {
  bytesWritten: number;
  totalBytes: number;
}) {
  const known = totalBytes > 0;

  return (
    <View className="gap-2">
      {known && <ProgressBar ratio={bytesWritten / totalBytes} />}
      <Text className="text-center text-muted">
        {known
          ? `${formatBytes(bytesWritten)} z ${formatBytes(totalBytes)}`
          : `Pobrano ${formatBytes(bytesWritten)}`}
      </Text>
    </View>
  );
}

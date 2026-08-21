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
 * warstwa natywna. Pierwsze jest jednym kliknięciem, drugie wyprowadza do
 * przeglądarki i instalatora systemu — i dlatego mówi wprost, ile to waży.
 *
 * Komponent nie zna ani sieci, ani systemu — całość siedzi w `useUpdateCheck`.
 * Tutaj są wyłącznie napisy i układ.
 */

import { Modal, Text, View } from 'react-native';
import { formatBytes } from '../update/manifest';
import { useUpdateCheck } from '../update/use-update';
import { Button, SectionTitle } from './primitives';

export function UpdatePrompt() {
  const { stage, confirm, dismiss } = useUpdateCheck();
  if (stage.kind === 'none') return null;

  return (
    <Modal animationType="fade" transparent visible onRequestClose={dismiss}>
      <View className="flex-1 justify-end bg-black/60 p-4">
        <View className="gap-4 rounded-2xl border border-border bg-surface p-5">
          {stage.kind === 'restart' ? <RestartContents /> : <NativeContents {...stage} />}

          <View className="flex-row gap-2">
            <Button label="Not now" variant="secondary" onPress={dismiss} grow />
            <Button
              label={stage.kind === 'restart' ? 'Restart' : 'Download'}
              onPress={confirm}
              grow
            />
          </View>
        </View>
      </View>
    </Modal>
  );
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
}: {
  manifest: { versionName: string; versionCode: number; size: number; notes: string };
}) {
  return (
    <View className="gap-1">
      <SectionTitle>New version to install</SectionTitle>
      <Text className="text-xl font-semibold text-text">
        Version {manifest.versionName} ({manifest.versionCode})
      </Text>
      <Text className="text-muted">
        {formatBytes(manifest.size)} — this one changes the app itself, so your browser downloads it
        and your phone installs it. Make sure you are on the VPN.
      </Text>
      {manifest.notes.length > 0 && <Text className="mt-2 text-text">{manifest.notes}</Text>}
    </View>
  );
}

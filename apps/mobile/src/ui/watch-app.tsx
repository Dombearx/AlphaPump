/**
 * Karta „Watch app" na ekranie konta — instalacja aplikacji na Pebble.
 *
 * Cały sens tej karty: instalacja na zegarku ma kosztować tyle samo co
 * instalacja aktualizacji telefonu, czyli jedno naciśnięcie. Bez SDK, bez
 * przerzucania plików, bez wiedzy o tym, że `.pbw` w ogóle istnieje.
 *
 * Wersję pokazujemy, ale **nie porównujemy** z zainstalowaną: telefon nie ma
 * jak zapytać zegarka, co na nim leży, a zgadywanie tego z pamięci aplikacji
 * kłamałoby po każdej instalacji zrobionej inaczej. Napis mówi więc, co jest
 * do wzięcia, a nie „masz starą wersję" — i to jest cała różnica względem
 * okna aktualizacji telefonu, które o swojej wersji wie na pewno.
 */

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { appConfig } from '../config/index';
import { downloadRelease } from '../update/apk';
import { installWatchApp, NoPebbleAppError } from '../watch/install';
import { fetchWatchRelease, watchPackageUrl, type WatchRelease } from '../watch/release';
import { Button, Card, SectionTitle } from './primitives';

type State =
  | { kind: 'loading' }
  /** Nikt jeszcze nie wydał aplikacji na zegarek — nie ma czego instalować. */
  | { kind: 'none' }
  | { kind: 'ready'; release: WatchRelease }
  | { kind: 'problem'; message: string };

export function WatchAppSettings() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchWatchRelease(appConfig.updateBaseUrl)
      .then((release) => {
        if (cancelled) return;
        setState(release === null ? { kind: 'none' } : { kind: 'ready', release });
      })
      .catch(() => {
        // Brak łączności z minipc jest tu normalnym stanem, a nie awarią —
        // ta karta stoi na ekranie, na który wchodzi się także poza VPN-em.
        if (!cancelled)
          setState({ kind: 'problem', message: 'The release server is out of reach.' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const install = (release: WatchRelease) => {
    setBusy(true);
    setProblem(null);
    setProgress(0);

    void (async () => {
      try {
        const uri = await downloadRelease(
          watchPackageUrl(appConfig.updateBaseUrl, release),
          ({ received, total }) => setProgress(total === null ? null : received / total),
        );
        await installWatchApp(uri);
      } catch (error) {
        setProblem(
          error instanceof NoPebbleAppError
            ? error.message
            : "The watch app couldn't be downloaded — is the phone on the VPN?",
        );
      } finally {
        setBusy(false);
        setProgress(null);
      }
    })();
  };

  return (
    <Card className="gap-2">
      <SectionTitle>Watch app</SectionTitle>
      <Text className="text-muted">
        Dictate a set from a Pebble. Installing hands the file to the Pebble app, which puts it on
        the watch.
      </Text>

      {state.kind === 'loading' && <Text className="text-muted">Checking for a release…</Text>}
      {state.kind === 'none' && (
        <Text className="text-muted">Nothing has been released for the watch yet.</Text>
      )}
      {state.kind === 'problem' && <Text className="text-muted">{state.message}</Text>}

      {state.kind === 'ready' && (
        <View className="mt-1 gap-2">
          <Text className="text-text">
            Version {state.release.version}
            {progress === null ? '' : ` · ${String(Math.round(progress * 100))}%`}
          </Text>
          <Button
            variant="secondary"
            label="Install on the watch"
            busy={busy}
            onPress={() => install(state.release)}
          />
        </View>
      )}

      {problem !== null && <Text className="text-danger">{problem}</Text>}
    </Card>
  );
}

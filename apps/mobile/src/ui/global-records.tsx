/**
 * Rekordy globalne ćwiczenia — karta doklejana do ekranu ćwiczenia.
 *
 * Jedyne miejsce poza rankingami, w którym aplikacja czeka na sieć. Rekord
 * globalny liczy się z serii **wszystkich** użytkowników, a cudze serie są
 * prywatne i nigdy nie zjadą na telefon — nie ma z czego policzyć go lokalnie.
 * Rekordy indywidualne pokazywane przy zapisie serii to zupełnie inna ścieżka:
 * te liczą się offline, z bazy lokalnej, i tak ma zostać.
 *
 * Karta pokazuje dokładnie to, co dopuszcza specyfikacja: wartość, nick, datę
 * i notatkę serii.
 */

import type { GlobalRecord, LoggingType } from '@alphapump/core';
import { Text, View } from 'react-native';
import { formatSet } from '../measurements';
import { remoteReader } from '../remote/reader';
import { useRemote } from '../remote/use-remote';
import { Button, Card } from './primitives';

export function GlobalRecordsCard({
  exerciseId,
  loggingType,
}: {
  exerciseId: string;
  loggingType: LoggingType;
}) {
  const { state, reload } = useRemote(() => remoteReader.globalRecords(exerciseId), [exerciseId]);

  return (
    <Card className="gap-2">
      <Text className="text-sm uppercase tracking-wide text-muted">Global records</Text>

      {state.status === 'loading' && <Text className="text-muted">Loading…</Text>}

      {state.status === 'offline' && (
        <>
          <Text className="text-muted">
            Offline — global records are computed from every user's sets.
          </Text>
          <Button variant="secondary" label="Try again" onPress={reload} />
        </>
      )}

      {state.status === 'error' && (
        <>
          <Text className="text-danger">{state.message}</Text>
          <Button variant="secondary" label="Try again" onPress={reload} />
        </>
      )}

      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <Text className="text-muted">Nobody has logged a set of this exercise yet.</Text>
        ) : (
          state.data.map((record) => (
            <RecordRow key={recordKey(record)} record={record} loggingType={loggingType} />
          ))
        ))}
    </Card>
  );
}

function RecordRow({ record, loggingType }: { record: GlobalRecord; loggingType: LoggingType }) {
  return (
    <View className="gap-0.5">
      <View className="flex-row items-baseline gap-3">
        <Text className="flex-1 text-text">{formatSet(loggingType, record)}</Text>
        <Text className="text-muted">{record.nickname}</Text>
        <Text className="text-xs text-muted">{record.performedOn}</Text>
      </View>
      {record.note !== null && record.note.length > 0 && (
        <Text className="text-xs text-muted">{record.note}</Text>
      )}
    </View>
  );
}

/**
 * Klucz listy. Rekord nie ma identyfikatora i mieć nie może — byłby wskazaniem
 * na cudzą serię. Para „kto + kiedy + jaka wartość" jest w obrębie jednego
 * frontu Pareto jednoznaczna: dwa punkty o tych samych współrzędnych zostają
 * zredukowane do jednego już przy liczeniu.
 */
function recordKey(record: GlobalRecord): string {
  return [
    record.nickname,
    record.performedOn,
    record.weightG,
    record.reps,
    record.durationS,
    record.distanceM,
  ].join('|');
}

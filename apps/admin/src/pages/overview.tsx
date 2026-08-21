/**
 * Wgląd w dane systemowe i dwa zadania porządkowe.
 *
 * Ekran odpowiada na jedno pytanie: „czy system żyje i czy nie narosło w nim
 * czegoś, co trzeba sprzątnąć". Dlatego liczby są podzielone na dane **własne**
 * (konta, biblioteka, treningi) i **odtwarzalne** (front Pareto, embeddingi,
 * cache werdyktów) — pierwsze da się odzyskać wyłącznie z kopii zapasowej, drugie
 * przelicza się w każdej chwili. To rozróżnienie decyduje o tym, czy usunięcie
 * czegoś jest bezpieczne.
 *
 * Zadania porządkowe są tutaj, a nie w osobnym ekranie, bo jedno i drugie ma sens
 * wyłącznie w odniesieniu do liczby, która stoi obok.
 */

import type { SystemStats } from '@alphapump/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, CardTitle, Loading, Problem, Stat } from '../components/ui';
import { getStats, pruneDuplicateCache, pruneTombstones } from '../lib/api';

/**
 * Wiek najnowszej kopii, po ludzku.
 *
 * `null` to **nie** „nie ma kopii", tylko „nie mam jak zajrzeć": katalog nie
 * jest podmontowany do kontenera API, bo kopie z założenia stoją poza stosem
 * (`BACKUP_DIR` w `deploy/.env`, albo `RCLONE_REMOTE` i wtedy w ogóle poza
 * maszyną). Rozróżnienie jest tu całym sensem kafelka: „nie wiem" i „nie ma ani
 * jednej kopii" prowadzą do dwóch zupełnie różnych reakcji.
 */
export function describeBackupAge(backups: SystemStats['backups']): string {
  if (backups === null) return 'nie wiem';
  if (backups.latestAt === null) return 'brak';

  const hours = Math.floor((Date.now() - Date.parse(backups.latestAt)) / 3_600_000);
  if (hours < 1) return 'przed chwilą';
  if (hours < 48) return `${String(hours)} godz. temu`;
  return `${String(Math.floor(hours / 24))} dni temu`;
}

/** Podpis pod wiekiem: rozmiar, ostrzeżenie albo powód, dla którego nie wiemy. */
export function backupHint(backups: SystemStats['backups']): string {
  if (backups === null) return 'ustaw BACKUP_DIR w deploy/.env, żeby to widzieć';
  if (backups.latestAt === null) return 'katalog jest pusty — sprawdź cron';

  const stale = Date.now() - Date.parse(backups.latestAt) > 48 * 3_600_000;
  const size =
    backups.latestBytes === null ? '' : `${String(Math.round(backups.latestBytes / 1024))} KB`;
  return stale ? `${size} · starsza niż dwie doby` : size;
}

export function OverviewPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => getStats() });
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const cache = useMutation({
    mutationFn: () => pruneDuplicateCache(90),
    onSuccess: (result) => {
      setMessage(`Zdjęto ${String(result.removed)} wpisów cache’u re-rankera.`);
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const tombstones = useMutation({
    mutationFn: () => pruneTombstones(),
    onSuccess: (result) => {
      const total = Object.values(result.removed).reduce((sum, value) => sum + value, 0);
      setMessage(`Zdjęto ${String(total)} wierszy usuniętych trwale.`);
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  if (stats.isPending) return <Loading label="Wczytywanie danych systemowych…" />;
  if (stats.error) return <Problem error={stats.error} />;

  const data = stats.data;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <CardTitle>Dane nieodtwarzalne</CardTitle>
        <p className="text-sm text-muted">
          Tego nie da się przeliczyć — wyłącznie odtworzyć z kopii zapasowej.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Konta"
            value={data.users.total}
            hint={`${String(data.users.admins)} adm. · ${String(data.users.banned)} zablokowanych`}
          />
          <Stat
            label="Ćwiczenia"
            value={data.library.exercises}
            hint={`${String(data.library.builtInExercises)} wbudowanych`}
          />
          <Stat label="Tagi" value={data.library.tags} />
          <Stat
            label="Serie"
            value={data.training.sets}
            hint={
              data.training.lastPerformedOn === null
                ? 'brak zapisów'
                : `ostatnia: ${data.training.lastPerformedOn}`
            }
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <CardTitle>Kopie zapasowe</CardTitle>
        <p className="text-sm text-muted">
          Odczyt z katalogu, do którego pisze cron. Cron instaluje się z ręki i nic poza tym
          kafelkiem nie mówi, czy działa — a „kopie nie chodzą od trzech tygodni” to zdanie, które
          ma się usłyszeć dzisiaj, a nie przy odtwarzaniu.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Ostatnia kopia"
            value={describeBackupAge(data.backups)}
            hint={backupHint(data.backups)}
          />
          <Stat
            label="Kopii w katalogu"
            value={data.backups === null ? '—' : data.backups.count}
            hint={data.backups === null ? 'katalog niepodmontowany' : undefined}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <CardTitle>Dane odtwarzalne</CardTitle>
        <p className="text-sm text-muted">
          Cache. Można je usunąć w każdej chwili — policzą się od nowa z serii i nazw ćwiczeń.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Rekordy globalne" value={data.derived.globalRecords} hint="front Pareto" />
          <Stat
            label="Embeddingi"
            value={data.duplicates.embeddings}
            hint={data.duplicates.semanticEnabled ? 'warstwa włączona' : 'warstwa wyłączona'}
          />
          <Stat
            label="Werdykty w cache’u"
            value={data.duplicates.cachedVerdicts}
            hint={data.duplicates.rerankerEnabled ? 're-ranker włączony' : 're-ranker wyłączony'}
          />
          <Stat label="Cykle" value={data.training.cycles} />
        </div>
      </section>

      <Card className="flex flex-col gap-3">
        <CardTitle>Porządkowanie</CardTitle>
        <p className="text-sm text-muted">
          Tombstone’y to wiersze usunięte miękko: zostają, dopóki mogą być potrzebne urządzeniu,
          które przespało synchronizację. Obecnie czeka ich{' '}
          {String(
            data.library.deletedExercises + data.library.deletedTags + data.training.deletedSets,
          )}
          .
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={tombstones.isPending}
            onClick={() => tombstones.mutate()}
          >
            Zdejmij tombstone’y poza oknem retencji
          </Button>
          <Button variant="secondary" disabled={cache.isPending} onClick={() => cache.mutate()}>
            Wyczyść cache re-rankera starszy niż 90 dni
          </Button>
        </div>
        {message !== null && <p className="text-sm text-success">{message}</p>}
        {cache.error !== null && <Problem error={cache.error} />}
        {tombstones.error !== null && <Problem error={tombstones.error} />}
      </Card>
    </div>
  );
}

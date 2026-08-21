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
  if (backups === null) return 'unknown';
  if (backups.latestAt === null) return 'none';

  const hours = Math.floor((Date.now() - Date.parse(backups.latestAt)) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 48) return `${String(hours)} h ago`;
  return `${String(Math.floor(hours / 24))} days ago`;
}

/** Podpis pod wiekiem: rozmiar, ostrzeżenie albo powód, dla którego nie wiemy. */
export function backupHint(backups: SystemStats['backups']): string {
  if (backups === null) return 'set BACKUP_DIR in deploy/.env to see this';
  if (backups.latestAt === null) return 'the directory is empty — check the cron job';

  const stale = Date.now() - Date.parse(backups.latestAt) > 48 * 3_600_000;
  const size =
    backups.latestBytes === null ? '' : `${String(Math.round(backups.latestBytes / 1024))} KB`;
  return stale ? `${size} · older than two days` : size;
}

export function OverviewPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => getStats() });
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const cache = useMutation({
    mutationFn: () => pruneDuplicateCache(90),
    onSuccess: (result) => {
      setMessage(`Removed ${String(result.removed)} re-ranker cache entries.`);
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const tombstones = useMutation({
    mutationFn: () => pruneTombstones(),
    onSuccess: (result) => {
      const total = Object.values(result.removed).reduce((sum, value) => sum + value, 0);
      setMessage(`Removed ${String(total)} rows for good.`);
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  if (stats.isPending) return <Loading label="Loading system data…" />;
  if (stats.error) return <Problem error={stats.error} />;

  const data = stats.data;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <CardTitle>Data that cannot be recomputed</CardTitle>
        <p className="text-sm text-muted">
          Nothing here can be recomputed — only restored from a backup.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Accounts"
            value={data.users.total}
            hint={`${String(data.users.admins)} admins · ${String(data.users.banned)} banned`}
          />
          <Stat
            label="Exercises"
            value={data.library.exercises}
            hint={`${String(data.library.builtInExercises)} built in`}
          />
          <Stat label="Tags" value={data.library.tags} />
          <Stat
            label="Sets"
            value={data.training.sets}
            hint={
              data.training.lastPerformedOn === null
                ? 'nothing logged'
                : `latest: ${data.training.lastPerformedOn}`
            }
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <CardTitle>Backups</CardTitle>
        <p className="text-sm text-muted">
          Read from the directory the cron job writes to. That job is installed by hand and nothing
          but this tile says whether it runs — and „the backups have been dead for three weeks” is a
          sentence to hear today, not while restoring.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Latest backup"
            value={describeBackupAge(data.backups)}
            hint={backupHint(data.backups)}
          />
          <Stat
            label="Backups in the directory"
            value={data.backups === null ? '—' : data.backups.count}
            hint={data.backups === null ? 'directory not mounted' : undefined}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <CardTitle>Data that can be recomputed</CardTitle>
        <p className="text-sm text-muted">
          Caches. They can go at any moment — they are rebuilt from the sets and exercise names.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Global records" value={data.derived.globalRecords} hint="Pareto front" />
          <Stat
            label="Vectors"
            value={data.duplicates.embeddings}
            hint={data.duplicates.semanticEnabled ? 'layer on' : 'layer off'}
          />
          <Stat
            label="Cached verdicts"
            value={data.duplicates.cachedVerdicts}
            hint={data.duplicates.rerankerEnabled ? 're-ranker on' : 're-ranker off'}
          />
          <Stat label="Cycles" value={data.training.cycles} />
        </div>
      </section>

      <Card className="flex flex-col gap-3">
        <CardTitle>Housekeeping</CardTitle>
        <p className="text-sm text-muted">
          Tombstones are softly deleted rows: they stay for as long as a device that slept through a
          sync might still need them. Right now there are{' '}
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
            Drop tombstones past the retention window
          </Button>
          <Button variant="secondary" disabled={cache.isPending} onClick={() => cache.mutate()}>
            Clear re-ranker cache older than 90 days
          </Button>
        </div>
        {message !== null && <p className="text-sm text-success">{message}</p>}
        {cache.error !== null && <Problem error={cache.error} />}
        {tombstones.error !== null && <Problem error={tombstones.error} />}
      </Card>
    </div>
  );
}

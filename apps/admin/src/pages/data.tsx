/**
 * Eksport i import danych systemowych od strony panelu.
 *
 * To ten sam plik, którym operuje cron kopii zapasowych, i ta sama ścieżka kodu.
 * Panel jest tu wygodą, nie osobnym mechanizmem — dlatego ekran mówi wprost, co
 * jest w archiwum i czego w nim nie ma. Osoba, która pobiera kopię „na wszelki
 * wypadek", musi wiedzieć, że nie ma w niej haseł ani kluczy API, zanim będzie
 * z niej odtwarzać.
 *
 * Import pokazuje **cały** raport, w tym pominięcia. Import, który po cichu
 * pominął połowę serii, wyglądałby dokładnie jak import udany, a odtwarzanie
 * kopii jest tym momentem, w którym „prawdopodobnie się udało" nie wystarcza.
 */

import { useMutation } from '@tanstack/react-query';
import { archiveSummary, type ImportReport } from '@alphapump/core';
import { useState } from 'react';
import { Button, Card, CardTitle, Problem } from '../components/ui';
import { exportSystemArchive, importArchive } from '../lib/api';

/** Zapis pliku bez pośrednika: archiwum jest już w pamięci przeglądarki. */
function download(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function DataPage() {
  const [report, setReport] = useState<ImportReport | null>(null);

  const exportAll = useMutation({
    mutationFn: () => exportSystemArchive(),
    onSuccess: (archive) => {
      const day = archive.exportedAt.slice(0, 10);
      download(`alphapump-system-${day}.json`, JSON.stringify(archive, null, 2));
    },
  });

  const restore = useMutation({
    mutationFn: async (file: File) => importArchive(JSON.parse(await file.text())),
    onSuccess: setReport,
  });

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <CardTitle>Export</CardTitle>
        <p className="text-sm text-muted">
          The system archive: sets, exercises, tags, cycles and the minimum account data
          (identifier, e-mail, nickname, role, password hash).{' '}
          <strong className="text-text">No</strong> sessions, API keys, vectors, records or rankings
          — the first two are sensitive, the rest are recomputed from the sets.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={exportAll.isPending} onClick={() => exportAll.mutate()}>
            {exportAll.isPending ? 'Building the archive…' : 'Download the system archive'}
          </Button>
          {exportAll.data !== undefined && (
            <span className="text-sm text-success">
              {(() => {
                const summary = archiveSummary(exportAll.data);
                return `Downloaded: ${String(summary.sets)} sets, ${String(summary.exercises)} exercises, ${String(summary.cycles)} cycles.`;
              })()}
            </span>
          )}
        </div>
        {exportAll.error !== null && <Problem error={exportAll.error} />}
        <p className="text-xs text-muted">
          Kopia zapasowa na Dysku Google powstaje tym samym eksportem, tylko z crona:{' '}
          <code className="text-text">export → gzip → age → rclone</code>. This button is the same
          path, run by hand.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Import</CardTitle>
        <p className="text-sm text-muted">
          Konflikty rozstrzyga LWW po <code className="text-text">updated_at</code>, tak jak przy
          resolution — an import never rolls back data newer than the file. Accounts from the
          archive are matched by e-mail address, and when an author's identifier changed, the
          identifiers of their exercises are recomputed, because they follow from author + name.
        </p>

        <input
          type="file"
          accept="application/json"
          className="text-sm text-muted"
          disabled={restore.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) restore.mutate(file);
          }}
        />

        {restore.isPending && <p className="text-sm text-muted">Uploading the archive…</p>}
        {restore.error !== null && <Problem error={restore.error} />}

        {report !== null && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-elevated p-3 text-sm">
            <div className="font-medium text-text">Raport importu ({report.scope})</div>
            <ul className="text-muted">
              <li>Zapisane: {summaryLine(report.imported)}</li>
              <li>Skipped: {summaryLine(report.skipped)}</li>
              {report.remappedExercises > 0 && (
                <li>
                  Recomputed the identifiers of {report.remappedExercises} exercises — their authors
                  have different identifiers in this database than in the archive.
                </li>
              )}
            </ul>
            {report.notes.map((note) => (
              <p key={note} className="text-xs text-muted">
                {note}
              </p>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function summaryLine(counts: ImportReport['imported']): string {
  return (
    `${String(counts.users)} accounts, ${String(counts.tags)} tags, ` +
    `${String(counts.exercises)} exercises, ${String(counts.sets)} sets, ` +
    `${String(counts.cycles)} cykli`
  );
}

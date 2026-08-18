/**
 * Eksport i import danych systemowych (etap 14 od strony panelu).
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
import { download } from '../lib/download';

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
        <CardTitle>Eksport</CardTitle>
        <p className="text-sm text-muted">
          Archiwum systemowe: serie, ćwiczenia, tagi, cykle i minimalne dane kont (identyfikator,
          e-mail, nick, rola). <strong className="text-text">Bez</strong> haseł, sesji, kluczy API,
          embeddingów, rekordów i rankingów — pierwsze są wrażliwe, drugie przeliczalne z serii.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={exportAll.isPending} onClick={() => exportAll.mutate()}>
            {exportAll.isPending ? 'Składanie archiwum…' : 'Pobierz archiwum systemowe'}
          </Button>
          {exportAll.data !== undefined && (
            <span className="text-sm text-success">
              {(() => {
                const summary = archiveSummary(exportAll.data);
                return `Pobrano: ${String(summary.sets)} serii, ${String(summary.exercises)} ćwiczeń, ${String(summary.cycles)} cykli.`;
              })()}
            </span>
          )}
        </div>
        {exportAll.error !== null && <Problem error={exportAll.error} />}
        <p className="text-xs text-muted">
          Kopia zapasowa na Dysku Google powstaje tym samym eksportem, tylko z crona:{' '}
          <code className="text-text">export → gzip → age → rclone</code>. Ten przycisk jest tą samą
          ścieżką uruchomioną ręcznie.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Import</CardTitle>
        <p className="text-sm text-muted">
          Konflikty rozstrzyga LWW po <code className="text-text">updated_at</code>, tak jak przy
          synchronizacji — import nie cofa danych nowszych niż plik. Konta z archiwum są
          dopasowywane po adresie e-mail, a gdy identyfikator autora się zmienił, identyfikatory
          jego ćwiczeń są przeliczane, bo wynikają z pary autor + nazwa.
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

        {restore.isPending && <p className="text-sm text-muted">Wgrywanie archiwum…</p>}
        {restore.error !== null && <Problem error={restore.error} />}

        {report !== null && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-elevated p-3 text-sm">
            <div className="font-medium text-text">Raport importu ({report.scope})</div>
            <ul className="text-muted">
              <li>Zapisane: {summaryLine(report.imported)}</li>
              <li>Pominięte: {summaryLine(report.skipped)}</li>
              {report.remappedExercises > 0 && (
                <li>
                  Przeliczono identyfikatory {report.remappedExercises} ćwiczeń — ich autorzy mają w
                  tej bazie inne identyfikatory niż w archiwum.
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
    `${String(counts.users)} kont, ${String(counts.tags)} tagów, ` +
    `${String(counts.exercises)} ćwiczeń, ${String(counts.sets)} serii, ` +
    `${String(counts.cycles)} cykli`
  );
}

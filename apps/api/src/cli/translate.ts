/**
 * `pnpm --filter api translate` — jednorazowe uzupełnienie tłumaczeń.
 *
 * Ostatni punkt zgłoszenia o językach: tagi i ćwiczenia, które ludzie dodali,
 * **zanim** tłumaczenie automatyczne w ogóle istniało. Nowe wiersze dostają
 * nazwy same, przy zapisie; te stare nie mają skąd, bo nikt ich już nie
 * zapisuje.
 *
 * To samo robi przycisk w panelu (`POST /admin/library/translations/refresh`)
 * i nie jest to duplikat, tylko dwa wejścia do jednej kolejki — dokładnie tak
 * jak przy porządkowaniu tombstone'ów (`prune`). Różnica jest jedna i widać ją
 * poniżej: CLI **czeka** na koniec przebiegu i wypisuje podsumowanie, bo proces,
 * który kończy się przed wykonaniem zleconej pracy, w cronie nie ma sensu.
 * Panel czekać nie może, bo warstwa wejściowa przerywa żądanie po dwóch
 * minutach.
 *
 * Bezpieczeństwo powtórzeń: wiersz z kompletem nazw nie idzie do modelu, a
 * domykanie zestawu nigdy nie rusza nazwy wpisanej ręcznie. Drugie uruchomienie
 * kosztuje więc tyle, ile zostało do zrobienia, a nie od nowa.
 *
 * ## Kiedy tego nie uruchamiać
 *
 * Uzupełnienie podbija `updated_at` wiersza — inaczej tłumaczenie nie dojechałoby
 * na telefony (patrz `translation/fill.ts`). Wiersz zmieniony w międzyczasie na
 * urządzeniu **bez sieci** przegra więc LWW, gdy jego push dotrze później niż
 * ten przebieg. Skala jest niewielka (chodzi o zmianę nazwy tego samego wiersza
 * w tym samym oknie), ale jest to powód, żeby przebieg puścić raz, a nie w pętli
 * co godzinę.
 */

import { loadConfig } from '../config.js';
import { createDatabase } from '../db.js';
import { logger } from '../logger.js';
import { createOpenRouterTranslator, createTranslationBacklog } from '../translation/index.js';

export async function runTranslate(): Promise<void> {
  const config = loadConfig();
  const translator = createOpenRouterTranslator(config.llm);

  if (translator === null) {
    // Nie jest to błąd konfiguracji, tylko wyłączona funkcja — kod wyjścia
    // zostaje zerowy, żeby cron nie alarmował o stanie, który ktoś wybrał.
    process.stdout.write(
      'Tłumaczenie jest wyłączone (brak OPENROUTER_API_KEY, LLM_ENABLED=false ' +
        'albo TRANSLATION_ENABLED=false) — nie ma czym uzupełniać nazw.\n',
    );
    return;
  }

  const connection = createDatabase(config.databaseUrl);

  try {
    const backlog = createTranslationBacklog(connection.db, translator);
    const queued = await backlog.enqueueMissing();

    logger.info('uzupełnianie tłumaczeń', { model: translator.model, queued });

    await backlog.drain();
    const status = backlog.status();

    process.stdout.write(
      `Wierszy bez kompletu nazw: ${String(queued ?? 0)}.\n` +
        `Uzupełniono: ${String(status.written)}, ` +
        `bez zmian: ${String(status.complete)}, ` +
        `nieudanych wywołań: ${String(status.failed)}.\n` +
        (status.failed > 0
          ? 'Wiersze, których model nie przetłumaczył, zostały z nazwą kanoniczną — ' +
            'ponowne uruchomienie spróbuje jeszcze raz tylko dla nich.\n'
          : ''),
    );
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await runTranslate();
}

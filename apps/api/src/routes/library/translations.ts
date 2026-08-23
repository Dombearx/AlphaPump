/**
 * Uzupełnienie brakujących tłumaczeń biblioteki.
 *
 * Jedna trasa i własny plik — z tego samego powodu, dla którego osobno stoi
 * przeliczenie wektorów: to jest zlecenie, a nie robota w miejscu. Handler
 * zgłasza wiersze do kolejki i odpowiada 202; nazwy dochodzą po kolei, poza
 * żądaniem.
 *
 * Endpoint jest odpowiedzią na ostatni punkt zgłoszenia — tagi i ćwiczenia
 * dodane przez użytkowników, **zanim** tłumaczenie automatyczne w ogóle
 * istniało. Biblioteka wbudowana ma nazwy wpisane ręcznie w seedzie i tego
 * przebiegu nie potrzebuje; te wiersze kolejka i tak pominie, bo komplet nazw
 * już mają.
 *
 * Jest idempotentny: wiersz z kompletem nazw nie idzie do modelu, a domykanie
 * zestawu nie rusza nazw wpisanych ręcznie. Drugie kliknięcie nie kosztuje więc
 * ani jednego wywołania więcej niż trzeba.
 */

import { type TranslationRefreshReport } from '@alphapump/core';
import { Hono } from 'hono';
import type { AppDependencies, AppEnvironment } from '../../context.js';
import { NO_TRANSLATIONS } from '../../translation/index.js';

export function createLibraryTranslationRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const translations = dependencies.translations ?? NO_TRANSLATIONS;

  router.post('/admin/library/translations/refresh', async (context) => {
    const queued = await translations.enqueueMissing();

    if (queued === null) {
      const disabled: TranslationRefreshReport = {
        enabled: false,
        status: 'disabled',
        queued: 0,
        pending: 0,
      };
      return context.json(disabled);
    }

    const status = translations.status();
    const report: TranslationRefreshReport = {
      enabled: true,
      // `busy` znaczy „przebieg już trwa" — zgłoszenie i tak dołączyło do tej
      // samej kolejki, bo wykonawca jest jeden. Panel dzięki temu mówi
      // „już liczę" zamiast udawać, że właśnie zaczął.
      status: status.running && queued === 0 ? 'busy' : 'started',
      queued,
      pending: status.pending,
    };
    // 202: zlecenie przyjęte, praca trwa gdzie indziej. 200 znaczyłoby
    // „przetłumaczone", a przetłumaczone jeszcze nie jest.
    return context.json(report, 202);
  });

  return router;
}

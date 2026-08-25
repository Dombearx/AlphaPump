/**
 * Kontekst żądania: co aplikacja Hono wie o sobie i o tym, kto pyta.
 */

import type { UserRole } from '@alphapump/core';
import type { Auth } from './auth.js';
import type { Database } from './db.js';
import type { EmbeddingBacklog } from './duplicates/backlog.js';
import type { DuplicateLayers } from './duplicates/layers.js';
import type { DerivedRecomputation } from './sync/derived.js';
import type { TranslationBacklog } from './translation/backlog.js';
import type { TriageClient } from './triage.js';
import type { VoiceLayers } from './voice/service.js';

/** Skąd wzięło się uwierzytelnienie — przydaje się w logach i w testach. */
export type Credential = 'session' | 'api-key';

export interface Principal {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  credential: Credential;
}

export interface AppEnvironment {
  Variables: {
    principal: Principal;
    /** Identyfikator żądania — wraca nagłówkiem `x-request-id` i wchodzi do logu. */
    requestId: string;
  };
  Bindings: Record<string, never>;
}

export interface AppDependencies {
  db: Database;
  auth: Auth;
  /**
   * Przeliczenia danych pochodnych wołane po każdej zmianie serii — pushem albo
   * zwykłym CRUD-em. Pominięcie pola daje zestaw domyślny
   * (`DERIVED_RECOMPUTATIONS`), więc produkcja nie ma jak zostać bez
   * przeliczania rekordów globalnych; test podstawia tu własną listę, także
   * pustą.
   */
  derived?: readonly DerivedRecomputation[];
  /**
   * Warstwy semantyczna i LLM-owa wykrywania duplikatów. Pominięcie
   * pola znaczy **warstwy wyłączone** — odwrotnie niż przy `derived`, i jest to
   * asymetria zamierzona: brak przeliczenia rekordów jest cichym błędem
   * poprawności, a warstwa LLM włączona przez przeoczenie to wychodzące żądania
   * i rachunek u dostawcy modeli. Produkcja składa je z konfiguracji w `index.ts`.
   */
  duplicates?: DuplicateLayers;
  /**
   * Kolejka przeliczania wektorów, wołana **poza** ścieżką żądania. Pominięcie
   * pola znaczy „nie ma czego liczyć" — tak samo jak wyłączona warstwa
   * semantyczna, bo jedno bez drugiego nie ma sensu. Produkcja składa ją
   * w `index.ts` z tych samych warstw co `duplicates`.
   */
  embeddings?: EmbeddingBacklog;
  /**
   * Kolejka tłumaczenia nazw na pozostałe języki, wołana **poza** ścieżką
   * żądania — z REST-a, z pushu i z panelu. Pominięcie pola znaczy „nie ma czym
   * tłumaczyć": nazwy zostają kanoniczne, a zapis działa bez zmian. Ta sama
   * asymetria co przy `duplicates` i z tego samego powodu — włączone przez
   * przeoczenie tłumaczenie to wychodzące żądania i rachunek u dostawcy.
   */
  translations?: TranslationBacklog;
  /**
   * Warstwy dyktowania serii głosem: transkrypcja i model wyciągający z tekstu
   * ćwiczenie i pomiary. Pominięcie pola znaczy **dyktowanie wyłączone** — ta
   * sama asymetria co przy `duplicates` i z tego samego powodu: włączone przez
   * przeoczenie dyktowanie to wychodzące żądania i rachunek u dwóch dostawców.
   * `POST /voice/set` oddaje wtedy 503, a telefon nie pokazuje mikrofonu.
   */
  voice?: VoiceLayers;
  /**
   * Klient usługi `services/triage` do ręcznego wyzwolenia przeglądu zgłoszeń
   * z panelu administracyjnego. Pominięcie pola znaczy **panel nie może
   * wyzwolić przeglądu** — `POST /admin/feedback/run` oddaje wtedy 503, tak
   * jak przy braku `TRIAGE_URL`/`TRIAGE_HTTP_TOKEN` w środowisku. Przegląd
   * dzieje się mimo to sam, w kilkanaście sekund po wpłynięciu zgłoszenia,
   * wewnątrz `triage`.
   */
  triage?: TriageClient;
}

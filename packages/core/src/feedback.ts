/**
 * Zgłoszenie zwrotne — kształt i granice, wspólne dla telefonu i serwera.
 *
 * Stałe stąd były wcześniej zapisane pięć razy w trzech plikach
 * (`apps/mobile/src/feedback.ts`, `apps/mobile/src/app-log.ts`,
 * `apps/api/src/schemas.ts`), a ich zgodność utrzymywały komentarze: „zgodne
 * z buforem telefonu", „zgodne z limitem, który akceptuje `POST /feedback`".
 * Cały ten pakiet istnieje po to, żeby takich par nie było — reguła opisana raz
 * nie ma jak się rozjechać z samą sobą.
 */

import { z } from 'zod';

/** Ile znaków przyjmuje treść zgłoszenia — i formularz, i serwer. */
export const FEEDBACK_MESSAGE_MAX_LENGTH = 2000;

/**
 * Ile ostatnich wpisów logu jedzie ze zgłoszeniem.
 *
 * Tyle, ile ma sens przeczytać ręcznie, i dokładnie tyle, ile telefon trzyma
 * w buforze. Nadmiar jest po stronie serwera cudzym błędem, nie naszym —
 * dlatego jest odrzucany, a nie przycinany.
 */
export const FEEDBACK_LOG_LIMIT = 30;

/** Pojedynczy wpis bywa dłuższy niż potrzeba: obiekt cykliczny, długi stos. */
export const FEEDBACK_LOG_MESSAGE_MAX_LENGTH = 2000;

export const feedbackLogLevelSchema = z.enum(['log', 'warn', 'error']);

export type FeedbackLogLevel = z.infer<typeof feedbackLogLevelSchema>;

/**
 * Wpis z bufora logów telefonu.
 *
 * `at` jest napisem, nie datą: idzie do pliku bez przeliczeń, dokładnie tak,
 * jak zapisał go telefon — razem z jego strefą i jego przestawionym zegarem,
 * bo to bywa właśnie ta informacja, której szuka się w zgłoszeniu.
 */
export const feedbackLogEntrySchema = z.object({
  level: feedbackLogLevelSchema,
  message: z.string().max(FEEDBACK_LOG_MESSAGE_MAX_LENGTH),
  at: z.string(),
});

export type FeedbackLogEntry = z.infer<typeof feedbackLogEntrySchema>;

export const submitFeedbackBodySchema = z.object({
  message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX_LENGTH),
  logs: z.array(feedbackLogEntrySchema).max(FEEDBACK_LOG_LIMIT).default([]),
});

export type SubmitFeedbackBody = z.infer<typeof submitFeedbackBodySchema>;

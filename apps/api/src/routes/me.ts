/**
 * Konto zalogowanego użytkownika.
 *
 * Dwa endpointy, oba potrzebne z tego samego powodu — klient musi wiedzieć,
 * czym właściwie dysponuje. `GET /me` odpowiada na to bezpośrednio: bot Discord
 * po wygenerowaniu tokenu sprawdza nim, czyim tokenem jest, aplikacja — czy
 * sesja jeszcze żyje, a od czasu resetów hasła z panelu także, czy konto nie ma
 * przypadkiem hasła tymczasowego do zmiany.
 *
 * `POST /me/password` jest drugą połową tamtej odpowiedzi: jedyną drogą zejścia
 * ze stanu „hasło tymczasowe". Zwykłej zmiany hasła nie dubluje i dublować nie
 * ma — tę obsługuje better-auth pod `/api/auth/change-password`, ze starym
 * hasłem jako potwierdzeniem tożsamości.
 *
 * Wymuszenie zmiany jest po stronie klientów (aplikacja i panel pokazują wtedy
 * wyłącznie ekran hasła), a nie w `authenticate`. Odcinanie każdego endpointu
 * dla konta z flagą kosztowałoby zapytanie do bazy przy **każdym** żądaniu —
 * także przy każdej paczce synchronizacji — a chroniłoby wyłącznie przed kimś,
 * kto omija własną aplikację, żeby dłużej używać hasła, które i tak zna
 * administrator.
 */

import { setOwnPasswordInputSchema, userSchema } from '@alphapump/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { toUserDto } from '../dto.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { validateJson } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import { revokeSessions, setAccountPassword } from '../passwords.js';
import { passwordResets, users } from '../schema.js';

const meResponseSchema = userSchema.extend({
  credential: z.enum(['session', 'api-key']),
  /**
   * Konto ma hasło nadane przez administratora i nie ustawiło jeszcze własnego.
   * Aplikacja i panel pokazują wtedy wyłącznie ekran zmiany hasła — reszty
   * i tak nie ma po co pokazywać komuś, kto zna hasło wpisane mu przez kogoś
   * innego.
   */
  mustChangePassword: z.boolean(),
});

export const setPasswordBodySchema = setOwnPasswordInputSchema;

export const meRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/me',
    summary: 'Zalogowany użytkownik',
    tag: 'konto',
    security: 'user',
    responses: [{ status: 200, description: 'Dane konta', schema: meResponseSchema }],
  },
  {
    method: 'post',
    path: '/me/password',
    summary: 'Ustawienie własnego hasła po resecie',
    description:
      'Dostępne wyłącznie dla konta z hasłem tymczasowym nadanym przez administratora. ' +
      'Starego hasła nie wymaga — zna je ten, kto je nadał. Po zmianie znikają wszystkie ' +
      'sesje konta poza tą, z której przyszło żądanie.',
    tag: 'konto',
    security: 'user',
    body: setPasswordBodySchema,
    responses: [
      { status: 204, description: 'Hasło ustawione' },
      { status: 403, description: 'Żądanie kluczem API — hasło zmienia się z sesji' },
      { status: 409, description: 'Konto nie ma hasła tymczasowego do zmiany' },
    ],
  },
];

export function createMeRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();

  const hasPendingReset = async (userId: string): Promise<boolean> => {
    const [row] = await dependencies.db
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.userId, userId))
      .limit(1);
    return row !== undefined;
  };

  router.get('/me', async (context) => {
    const principal = context.get('principal');
    const [row] = await dependencies.db
      .select()
      .from(users)
      .where(eq(users.id, principal.id))
      .limit(1);
    if (!row) throw notFound('No such account');

    return context.json({
      ...toUserDto(row),
      credential: principal.credential,
      mustChangePassword: await hasPendingReset(principal.id),
    });
  });

  router.post('/me/password', validateJson(setPasswordBodySchema), async (context) => {
    const principal = context.get('principal');

    // Klucz API jest poświadczeniem bota i celowo nie daje wstępu do zmiany
    // hasła: gdyby dawał, wyciek klucza przejmowałby konto, zamiast dawać dostęp
    // do danych, do których klucz był wystawiony.
    if (principal.credential !== 'session') {
      throw forbidden('The password can only be set from a signed-in session');
    }

    if (!(await hasPendingReset(principal.id))) {
      throw conflict(
        'This account has no temporary password to replace — change it through /api/auth/change-password',
      );
    }

    const { newPassword } = context.req.valid('json');
    await setAccountPassword(dependencies.auth, principal.id, newPassword);

    // Kolejność ma znaczenie: wiersz znika dopiero po udanym zapisie hasła.
    // Odwrotna zostawiłaby konto bez flagi i ze starym hasłem, gdyby zapis padł
    // — czyli w stanie, w którym nikt już o zmianę nie poprosi.
    await dependencies.db.delete(passwordResets).where(eq(passwordResets.userId, principal.id));

    const session = await dependencies.auth.api.getSession({ headers: context.req.raw.headers });
    await revokeSessions(dependencies.auth, principal.id, {
      except: session?.session.token ?? undefined,
    });

    return context.body(null, 204);
  });

  return router;
}

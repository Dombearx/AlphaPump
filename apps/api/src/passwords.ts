/**
 * Hasła nadawane z panelu administracyjnego.
 *
 * Poczty w stosie nie ma i w MVP nie będzie (patrz `auth.ts`), więc „przypomnij
 * hasło" nie ma jak dojść do użytkownika. Zamiast tego administrator nadaje
 * hasło **tymczasowe**, przekazuje je osobiście, a właściciel konta ustawia
 * sobie własne przy pierwszym logowaniu. Ten plik jest całą warstwą, która to
 * realizuje: generator hasła i dwie operacje na koncie, których better-auth nie
 * wystawia w kształcie, jakiego potrzebujemy.
 *
 * ## Dlaczego nie `auth.api.setUserPassword`
 *
 * Plugin `admin` ma taki endpoint, ale jest za middleware wymagającym **sesji**
 * administratora w nagłówkach żądania. Nasze `/admin/*` dopuszcza obok sesji
 * także klucz API (patrz `middleware/authenticate.ts`), a wtedy nie ma czego
 * przekazać dalej — reset kończyłby się wtedy błędem „brak sesji" mimo poprawnej
 * roli. Kontekst better-auth (`auth.$context`) daje te same operacje o poziom
 * niżej: to ten sam hash i ten sam adapter, którego używa endpoint pluginu,
 * bez powtórzonej kontroli dostępu, którą i tak wykonaliśmy wcześniej.
 */

import { randomInt } from 'node:crypto';
import { MIN_PASSWORD_LENGTH } from '@alphapump/core';
import type { Auth } from './auth.js';

/**
 * Alfabet hasła tymczasowego — bez znaków, które mylą się przy przepisywaniu
 * z komunikatora albo dyktowaniu przez telefon: `0`/`O`, `1`/`l`/`I`. Same małe
 * litery i cyfry, bo hasło i tak jest tymczasowe, a wielkość liter jest tu
 * wyłącznie kolejną okazją do pomyłki.
 */
const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

/** Cztery grupy po cztery znaki — 20 bitów entropii na grupę, 80 łącznie. */
const GROUPS = 4;
const GROUP_LENGTH = 4;

/**
 * Hasło tymczasowe w postaci `k7np-3rtq-w9xm-2vhd`.
 *
 * Myślniki są częścią hasła, nie ozdobą: administrator przepisuje je człowiekowi
 * na komunikatorze, a ciąg szesnastu znaków bez podziału przepisuje się źle.
 * Wchodzą do alfabetu haseł better-auth bez żadnego wyjątku — hash liczy się
 * z całości.
 */
export function generateTemporaryPassword(): string {
  const groups = Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  );
  const password = groups.join('-');

  // Asercja, a nie warunek: długość wynika ze stałych powyżej, więc naruszenie
  // jej znaczy zmianę w tym pliku, a nie sytuację do obsłużenia w czasie pracy.
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('Hasło tymczasowe jest krótsze niż minimum wymagane przez better-auth');
  }
  return password;
}

/**
 * Ustawia hasło konta, zakładając mu przy okazji sposób logowania hasłem, jeśli
 * konto go nie miało.
 *
 * Drugi przypadek dotyczy kont założonych przez Google: nie mają wiersza
 * `accounts` z hasłem, więc sam `updatePassword` nie miałby czego zaktualizować
 * i reset przeszedłby bez skutku. Po tej operacji konto ma obie drogi —
 * logowanie Google działa dalej, dochodzi logowanie hasłem.
 */
export async function setAccountPassword(
  auth: Auth,
  userId: string,
  password: string,
): Promise<void> {
  const context = await auth.$context;
  const hash = await context.password.hash(password);
  const accounts = await context.internalAdapter.findAccounts(userId);

  if (accounts.some((account) => account.providerId === 'credential')) {
    await context.internalAdapter.updatePassword(userId, hash);
    return;
  }

  await context.internalAdapter.createAccount({
    userId,
    providerId: 'credential',
    accountId: userId,
    password: hash,
  });
}

/**
 * Kasuje sesje konta — wszystkie albo wszystkie poza wskazaną.
 *
 * Po zmianie hasła sesje sprzed niej muszą zniknąć, bo inaczej zmiana nic nie
 * znaczy: telefon zalogowany starym hasłem chodzi dalej, jakby nic się nie
 * stało. Przy resecie z panelu znika komplet (to jest właśnie sens resetu:
 * odciąć dostęp), a przy ustawieniu własnego hasła zostaje ta jedna, z której
 * przyszło żądanie — inaczej człowiek wylatywałby z aplikacji w nagrodę za
 * zrobienie tego, o co go poprosiliśmy.
 *
 * Kluczy API operacja **nie** rusza. Klucz jest osobnym poświadczeniem bota,
 * a nie kopią hasła; unieważnia się go z ekranu tokenów.
 */
export async function revokeSessions(
  auth: Auth,
  userId: string,
  options: { except?: string } = {},
): Promise<void> {
  const context = await auth.$context;

  if (options.except === undefined) {
    await context.internalAdapter.deleteUserSessions(userId);
    return;
  }

  const sessions = await context.internalAdapter.listSessions(userId);
  const tokens = sessions
    .map((session) => session.token)
    .filter((token) => token !== options.except);
  if (tokens.length > 0) await context.internalAdapter.deleteSessions(tokens);
}

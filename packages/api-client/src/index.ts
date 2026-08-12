/**
 * Typowany klient API oparty o Hono RPC.
 *
 * **Pakiet jest pusty i nie ma konsumenta.** Miał go dostarczyć etap 3, ale
 * przy realizacji etapu 13 okazało się, że żadna z dwóch stron go nie
 * potrzebuje: panel administracyjny i aplikacja mobilna czytają odpowiedzi
 * schematami Zod z `@alphapump/core` — tymi samymi, którymi API je opisuje
 * i waliduje. Kontrakt jest więc już wspólny i sprawdzany po obu stronach,
 * a klient RPC dołożyłby do tego zależność od typów serwera, nie dając nowej
 * gwarancji.
 *
 * Pakiet zostaje w drzewie, bo wraca w chwili, w której pojawi się konsument,
 * dla którego wnioskowanie typów wprost z Hono coś zmienia — na przykład bot
 * Discord pisany w tym samym monorepo.
 */

export const PACKAGE_NAME = '@alphapump/api-client';

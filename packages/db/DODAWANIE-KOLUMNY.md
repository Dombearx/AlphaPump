# Lista kontrolna: dodaję kolumnę

Schemat jest napisany **dwa razy** — raz dla Postgresa, raz dla SQLite — bo
buildery Drizzle są osobne dla każdego dialektu. Parzystości pilnuje
`tests/schema-parity.test.ts`, ale test odpowiada dopiero na pytanie „czy oba
schematy się zgadzają", a nie „czy o czymś nie zapomniałem". Ta lista odpowiada
na to drugie.

Jedno pole domenowe dotyka dziewięciu miejsc. Nie jest to przypadek ani zaniedbanie:
tyle warstw ma protokół, w którym ten sam wiersz żyje na telefonie offline,
przyjeżdża na serwer i wraca na drugie urządzenie.

## Kolejność

1. **`src/pg/schema.ts`** — kolumna po stronie serwera. Kolumny synchronizowane
   mają `server_seq` i `deleted_at`; nowe pole zwykle jest po prostu obok.
2. **`src/sqlite/schema.ts`** — to samo pole w bazie telefonu. Czas jako
   `timestamp_ms`, dzień jako `YYYY-MM-DD` — patrz komentarz na górze pliku.
3. **`pnpm generate`** — migracje dla obu dialektów plus przepakowanie zestawu
   migracji SQLite (`src/sqlite/migrations-bundle.ts`, plik generowany).
4. **`apps/api/src/dto.ts`** — kształt wystawiany przez API.
5. **`apps/api/src/sync/rows.ts`** — kształt schodzący pullem (DTO + `serverSeq`).
6. **`apps/api/src/sync/push/<encja>.ts`** — przyjęcie pola z paczki telefonu.
7. **`apps/api/src/sync/pull.ts`** — jeśli pole wpływa na to, *które* wiersze
   schodzą (zwykle nie wpływa).
8. **`apps/mobile/src/sync/payload.ts`** i **`apply.ts`** — wysyłka i zapis
   lokalny.
9. **`packages/core/src/schemas.ts`** — schemat encji, z którego wynika i
   walidacja żądania, i typ w aplikacji.

Do tego, gdy pole ma znaczenie dla kopii zapasowej:
**`packages/core/src/transfer.ts`** (kształt archiwum) oraz
`apps/api/src/transfer/{export,import}.ts`.

## Czego nie trzeba

Panel administracyjny i aplikacja mobilna czytają odpowiedzi schematami z
`@alphapump/core`, więc nowe pole pojawia się w ich typach samo. Jeśli ma być
widoczne na ekranie — to już osobna decyzja, nie krok migracyjny.

## Sprawdzenie

```
pnpm --filter @alphapump/db test    # parzystość schematów i migracje na czystej bazie
pnpm typecheck                       # miejsca, o których zapomniano, zwykle wychodzą tutaj
pnpm test                            # reszta
```

/**
 * Kiedy okno „uruchom ponownie" ma prawo się pokazać.
 *
 * `expo-updates` mówi tylko tyle, że paczka **jest pobrana i czeka**
 * (`isUpdatePending`). To za mało, żeby o coś pytać, bo są dwa stany, w których
 * pytanie prowadzi donikąd — i oba wyglądają dla użytkownika tak samo:
 * „aktualizacja gotowa, uruchom ponownie", restart, brak zmian, i to samo okno
 * przy następnym otwarciu. Bez końca.
 *
 * **Pierwszy: paczka z serwera jest tą, która już chodzi.** Klient nie porównuje
 * identyfikatorów, żeby zdecydować, czy proponować wydanie — porównuje
 * `createdAt` z datą zapamiętaną przy pobraniu. Wydanie wgrane ponownie z nową
 * datą, a tą samą treścią (a więc i tym samym identyfikatorem), jest więc na
 * zawsze „nowsze" od kopii, którą telefon ma na dysku. Serwer aktualizacji tego
 * już nie robi (`deploy/update_server.py`), ale telefon nie ma jak wiedzieć,
 * jaki kod stoi po drugiej stronie — a odpowiedź jest tutaj darmowa i pewna:
 * skoro identyfikator pobranej paczki jest identyfikatorem paczki uruchomionej,
 * to nie ma czego uruchamiać.
 *
 * **Drugi: restart już był i nic nie dał.** Paczka, która wywali się przy
 * starcie, zostaje przez `expo-updates` odznaczona jako nieudana i nigdy więcej
 * nie jest uruchamiana — ale zostaje na dysku i dalej jest „pobrana i czeka".
 * Pytanie o restart po raz drugi jest wtedy proszeniem użytkownika o czynność,
 * o której z góry wiadomo, że nic nie zmieni. Pytamy więc **raz** na wydanie:
 * jeżeli po restarcie dla danej paczki dalej chodzi inna, to ta paczka nie
 * wstaje i trzeba nowego wydania, a nie kolejnego kliknięcia.
 *
 * Moduł jest czysty i nie importuje niczego z Expo — wartości wchodzą gotowe
 * z `ota.ts` i `expo.ts`, tak samo jak w `manifest.ts` i `running.ts` obok.
 */

export interface PendingUpdate {
  /** `expo-updates`: paczka pobrana i gotowa do uruchomienia. */
  pending: boolean;
  /** Identyfikator pobranej paczki; `null`, gdy klient go nie podał. */
  downloadedId: string | null;
  /** Identyfikator paczki, która chodzi w tej chwili; `null` dla wbudowanej. */
  runningId: string | null;
  /** Paczka, dla której użytkownik już raz kliknął „uruchom ponownie". */
  restartedForId: string | null;
}

export function shouldOfferRestart({
  pending,
  downloadedId,
  runningId,
  restartedForId,
}: PendingUpdate): boolean {
  if (!pending) return false;

  // Bez identyfikatora nie ma jak rozstrzygnąć niczego poniżej. Zostaje wierzyć
  // klientowi: lepsze jedno zbędne pytanie niż zjedzone wydanie.
  if (downloadedId === null) return true;

  if (downloadedId === runningId) return false;

  return !(restartedForId === downloadedId);
}

/**
 * Czy pamięć o restarcie dotyczy paczki, która w tej chwili chodzi — czyli czy
 * restart się udał i notatka jest już niepotrzebna.
 *
 * Kasowanie jej jest ważniejsze, niż wygląda: gdyby została, a `expo-updates`
 * kiedyś zaproponował **tę samą** paczkę ponownie (przywrócenie wydania, ręczne
 * cofnięcie na minipc), okno zostałoby zablokowane dla wydania, które ma pełne
 * prawo się uruchomić.
 */
export function restartSucceeded({
  runningId,
  restartedForId,
}: Pick<PendingUpdate, 'runningId' | 'restartedForId'>): boolean {
  return restartedForId !== null && restartedForId === runningId;
}

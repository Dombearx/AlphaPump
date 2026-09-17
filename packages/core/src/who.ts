/**
 * Cykl WHO — wbudowany szablon cyklu oparty o wytyczne WHO dotyczące aktywności
 * fizycznej dla dorosłych (18–64 lata).
 *
 * ## Co mówią wytyczne
 *
 * Tygodniowo: **co najmniej 150–300 minut** aktywności aerobowej o umiarkowanej
 * intensywności **albo** 75–150 minut o wysokiej intensywności, **albo**
 * równoważna kombinacja obu. Dolna granica tego przedziału to próg podstawowych
 * korzyści zdrowotnych, górna — próg korzyści **dodatkowych**. Stąd dwa poziomy
 * w jednej pozycji celu: `target` i `stretchTarget`.
 *
 * ## Dlaczego jedna pozycja, a nie trzy
 *
 * „150 minut umiarkowanego ALBO 75 minut wysokiego" to alternatywa, a cykl
 * uznaje się za zrealizowany dopiero wtedy, gdy zrealizowane są **wszystkie**
 * jego pozycje. Osobna pozycja na każdą intensywność zamieniłaby więc regułę
 * WHO w koniunkcję: ktoś, kto przebiegł tygodniowo 80 minut interwałów, miałby
 * cykl w połowie, choć wytyczne ma wypełnione z nawiązką.
 *
 * Dlatego pozycja jest jedna — w zakresie „umiarkowana" — a różnicę między
 * intensywnościami niesie waga wkładu: minuta wysiłku wysokiej intensywności
 * liczy się w niej za dwie, wysiłek lekki nie liczy się wcale (patrz
 * `intensity.ts`). Jedna liczba zamiast trzech, a reguła zachowana co do minuty.
 *
 * Kto chce widzieć rozbicie na trzy poziomy osobno, dokłada sobie do cyklu
 * pozycje w zakresach „niska" i „wysoka" — zakres intensywnościowy jest zwykłym
 * zakresem pozycji celu i nie jest zarezerwowany dla tego szablonu.
 *
 * ## Czego tu nie ma
 *
 * Wytyczne wymagają też ćwiczeń wzmacniających mięśnie w **co najmniej dwa
 * dni** w tygodniu. Metryki „liczba dni" cykle nie mają, a dorabianie jej pod
 * jeden szablon byłoby zmianą znacznie większą niż sam szablon — więc tej części
 * cykl WHO nie pilnuje.
 *
 * Szablon jest **opcjonalny**: nie powstaje sam ani przy zakładaniu konta, ani
 * przy seedowaniu bazy. Użytkownik dodaje go z ekranu nowego cyklu, a wyłącza
 * tak samo jak każdy inny cykl — archiwizując go albo usuwając.
 */

import { addDays, type IsoDate } from './dates.js';
import type { CreateCycleInput } from './schemas.js';

/** Wytyczne są tygodniowe, więc i okres cyklu jest tygodniowy. */
export const WHO_CYCLE_DAYS = 7;

/** Próg podstawowych korzyści zdrowotnych: 150 minut tygodniowo. */
export const WHO_MINIMUM_S = 150 * 60;

/** Próg korzyści dodatkowych: 300 minut tygodniowo. */
export const WHO_ADDITIONAL_S = 300 * 60;

export const WHO_CYCLE_NAME = 'WHO weekly activity';

/**
 * Cykl WHO gotowy do zapisania. Początek podaje wołający — rdzeń nie sięga po
 * zegar, tak samo jak reszta tego pakietu.
 */
export function whoCycleInput(startsOn: IsoDate): CreateCycleInput {
  return {
    name: WHO_CYCLE_NAME,
    startsOn,
    endsOn: addDays(startsOn, WHO_CYCLE_DAYS - 1),
    goals: [
      {
        metric: 'duration',
        target: WHO_MINIMUM_S,
        stretchTarget: WHO_ADDITIONAL_S,
        exerciseId: null,
        tagId: null,
        intensity: 'moderate',
      },
    ],
  };
}

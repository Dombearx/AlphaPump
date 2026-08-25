/**
 * Formularz serii: jedno ćwiczenie, jeden dzień.
 *
 * Oba konteksty są w adresie, więc ekran da się otworzyć wprost — z dnia,
 * z wyboru ćwiczenia, a w kolejnych etapach także z kalendarza i z listy pozycji
 * cyklu, bez żadnego stanu przekazywanego bokiem.
 *
 * Tą samą drogą wchodzi seria podyktowana głosem: ekran dyktowania podstawia
 * rozpoznane wartości w parametry adresu (patrz `src/voice-draft.ts`), a tutaj
 * wracają one liczbami. Adres bez tych parametrów to zwykłe wejście
 * w formularz, w którym działa podpowiedź z poprzedniej serii.
 */

import { isIsoDate, isUuid } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { LogScreen } from '../../../../src/screens/log';
import { readDictationParams } from '../../../../src/voice-draft';

export default function LogRoute() {
  const params = useLocalSearchParams<{ date: string; exerciseId: string }>();
  const { date, exerciseId } = params;

  if (!isIsoDate(date)) return <Redirect href="/" />;
  if (!isUuid(exerciseId)) return <Redirect href={`/day/${date}`} />;

  return <LogScreen day={date} exerciseId={exerciseId} dictated={readDictationParams(params)} />;
}

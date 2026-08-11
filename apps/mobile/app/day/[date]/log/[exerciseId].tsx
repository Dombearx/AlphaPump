/**
 * Formularz serii: jedno ćwiczenie, jeden dzień.
 *
 * Oba konteksty są w adresie, więc ekran da się otworzyć wprost — z dnia,
 * z wyboru ćwiczenia, a w kolejnych etapach także z kalendarza i z listy pozycji
 * cyklu, bez żadnego stanu przekazywanego bokiem.
 */

import { isIsoDate, isUuid } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { LogScreen } from '../../../../src/screens/log';

export default function LogRoute() {
  const { date, exerciseId } = useLocalSearchParams<{ date: string; exerciseId: string }>();

  if (!isIsoDate(date)) return <Redirect href="/" />;
  if (!isUuid(exerciseId)) return <Redirect href={`/day/${date}`} />;

  return <LogScreen day={date} exerciseId={exerciseId} />;
}

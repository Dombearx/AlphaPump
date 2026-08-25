/**
 * Dyktowanie serii dla wskazanego dnia.
 *
 * Dzień jest w adresie z tego samego powodu co przy wyborze ćwiczenia: powrót,
 * ponowne wejście i przywrócenie aplikacji przez system trafiają zawsze w ten
 * dzień, o który chodziło — a nie w dzisiejszy.
 */

import { isIsoDate } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { DictateScreen } from '../../../src/screens/dictate';

export default function DictateRoute() {
  const { date } = useLocalSearchParams<{ date: string }>();

  if (!isIsoDate(date)) return <Redirect href="/" />;
  return <DictateScreen day={date} />;
}

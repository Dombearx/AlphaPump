/**
 * Dzień wskazany datą — ten sam ekran co dzień bieżący.
 *
 * Data przychodzi z adresu, więc może być czymkolwiek. Wartość, która nie jest
 * istniejącym dniem, zawraca do dziś zamiast renderować widok, który zapytałby
 * bazę o `2026-02-30`.
 */

import { isIsoDate } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { DayScreen } from '../../../src/screens/day';

export default function DayRoute() {
  const { date } = useLocalSearchParams<{ date: string }>();

  if (!isIsoDate(date)) return <Redirect href="/" />;
  return <DayScreen day={date} />;
}

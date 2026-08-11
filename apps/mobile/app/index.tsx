/**
 * Ekran startowy — widok dnia bieżącego.
 *
 * Specyfikacja stawia to wprost: „widok główny po wejściu do aplikacji to widok
 * dodawania serii dla bieżącego dnia". Trasa nie robi więc nic poza podaniem
 * dzisiejszej daty; cały ekran jest w `src/screens/day.tsx`, bo ten sam
 * komponent obsługuje dzień historyczny.
 */

import { today } from '../src/day-labels';
import { DayScreen } from '../src/screens/day';

export default function TodayRoute() {
  return <DayScreen day={today()} />;
}

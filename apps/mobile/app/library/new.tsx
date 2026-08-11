/**
 * Nowe ćwiczenie.
 *
 * Oba parametry są opcjonalne i oba są skrótami, a nie stanem: `tagId`
 * podpowiada tag główny, gdy użytkownik przyszedł tu z odfiltrowanej listy,
 * a `day` znaczy „wracam prosto do zapisania serii tego dnia". Ich brak jest
 * poprawny i daje zwykłe dodawanie ćwiczenia z poziomu biblioteki.
 */

import { isIsoDate, isUuid } from '@alphapump/core';
import { useLocalSearchParams } from 'expo-router';
import { ExerciseFormScreen } from '../../src/screens/exercise-form';

export default function NewExerciseRoute() {
  const { tagId, day } = useLocalSearchParams<{ tagId?: string; day?: string }>();

  return (
    <ExerciseFormScreen
      mode={{ kind: 'create', ...(isUuid(tagId) ? { tagId } : {}) }}
      {...(isIsoDate(day) ? { day } : {})}
    />
  );
}

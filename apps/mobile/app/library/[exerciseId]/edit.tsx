/**
 * Edycja ćwiczenia. Prawo do zmiany sprawdza sam ekran — ma je autor
 * i administrator, a reszta widzi wyjaśnienie zamiast przycisku zapisu.
 */

import { isUuid } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ExerciseFormScreen } from '../../../src/screens/exercise-form';

export default function EditExerciseRoute() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();

  if (!isUuid(exerciseId)) return <Redirect href="/library" />;
  return <ExerciseFormScreen mode={{ kind: 'edit', id: exerciseId }} />;
}

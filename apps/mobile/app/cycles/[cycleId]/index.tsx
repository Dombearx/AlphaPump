/**
 * Pojedynczy cykl: postęp, poprzedni okres, reset i archiwum.
 */

import { isUuid } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { CycleScreen } from '../../../src/screens/cycle';

export default function CycleRoute() {
  const { cycleId } = useLocalSearchParams<{ cycleId: string }>();

  if (!isUuid(cycleId)) return <Redirect href="/cycles" />;
  return <CycleScreen cycleId={cycleId} />;
}

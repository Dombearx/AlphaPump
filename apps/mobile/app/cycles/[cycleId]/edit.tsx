/**
 * Edycja cyklu — nazwa, zakres dat i pozycje celu.
 */

import { isUuid } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { CycleFormScreen } from '../../../src/screens/cycle-form';

export default function EditCycleRoute() {
  const { cycleId } = useLocalSearchParams<{ cycleId: string }>();

  if (!isUuid(cycleId)) return <Redirect href="/cycles" />;
  return <CycleFormScreen mode={{ kind: 'edit', id: cycleId }} />;
}

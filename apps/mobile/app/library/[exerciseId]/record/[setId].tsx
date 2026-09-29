/**
 * Historia poprawiania rekordu. Oba identyfikatory przychodzą z adresu, więc
 * mogą być czymkolwiek — wartość, która nie jest UUID-em, zawraca do listy.
 */

import { isUuid } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { RecordProgressionScreen } from '../../../../src/screens/record-progression';

export default function RecordProgressionRoute() {
  const { exerciseId, setId } = useLocalSearchParams<{ exerciseId: string; setId: string }>();

  if (!isUuid(exerciseId) || !isUuid(setId)) return <Redirect href="/library" />;
  return <RecordProgressionScreen exerciseId={exerciseId} setId={setId} />;
}

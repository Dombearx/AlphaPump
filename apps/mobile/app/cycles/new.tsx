/**
 * Nowy cykl.
 */

import { CycleFormScreen } from '../../src/screens/cycle-form';

export default function NewCycleRoute() {
  return <CycleFormScreen mode={{ kind: 'create' }} />;
}

/**
 * Przygotowanie bazy lokalnej przed pierwszym ekranem.
 *
 * Kolejność jest wymuszona: migracje, potem seed, dopiero potem interfejs.
 * Ekran, który wyrenderowałby się przed migracjami, zapytałby o tabelę, której
 * jeszcze nie ma — i to jest awaria widoczna dopiero na urządzeniu.
 *
 * Seed daje bibliotekę wbudowaną od razu przy pierwszym uruchomieniu, bez
 * czekania na pierwszą synchronizację. Nie zduplikuje jej po pullu, bo
 * identyfikatory ćwiczeń wbudowanych są deterministyczne i po obu stronach
 * identyczne.
 */

import { seedSqlite } from '@alphapump/db/sqlite';
import migrations from '@alphapump/db/sqlite-migrations';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { db } from './client';

type Stage = 'migrating' | 'seeding' | 'ready';

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const { success, error } = useMigrations(db, migrations);
  const [stage, setStage] = useState<Stage>('migrating');
  const [seedError, setSeedError] = useState<Error | null>(null);

  useEffect(() => {
    if (!success) return;
    setStage('seeding');
    seedSqlite(db)
      .then(() => setStage('ready'))
      .catch((problem: Error) => setSeedError(problem));
  }, [success]);

  const failure = error ?? seedError;
  if (failure) return <Failure message={failure.message} />;
  if (stage !== 'ready') return <Preparing />;

  return <>{children}</>;
}

function Preparing() {
  return (
    <View className="flex-1 items-center justify-center bg-base">
      <ActivityIndicator size="large" color="#f97316" />
      <Text className="mt-4 text-muted">Preparing local database…</Text>
    </View>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-base px-6">
      <Text className="text-lg font-semibold text-danger">The local database failed to start</Text>
      <Text className="text-center text-muted">{message}</Text>
    </View>
  );
}

/**
 * Format archiwum — wspólny dla eksportu użytkownika i kopii zapasowej.
 *
 * Testy pilnują trzech rzeczy, z których każda odpowiada realnej awarii:
 *
 * 1. **Plik obcy nie wchodzi.** Import pisze do bazy; zgadywanie kształtu byłoby
 *    najgorszym możliwym wyborem.
 * 2. **Osierocone wiersze są widoczne przed dotknięciem bazy.** Inaczej pierwszy
 *    z nich wywraca transakcję komunikatem sterownika, bezużytecznym dla osoby
 *    odtwarzającej kopię.
 * 3. **Postać kanoniczna nie widzi różnic bez znaczenia.** To ona rozstrzyga
 *    kryterium „dane po odtworzeniu zgadzają się z oryginałem" — także
 *    w comiesięcznej próbie odtworzenia w CI.
 */

import { describe, expect, it } from 'vitest';
import { exerciseId, tagId } from '../src/ids.js';
import { slug } from '../src/slug.js';
import { tagColor } from '../src/tag-color.js';
import {
  planArchiveIdentity,
  ARCHIVE_FORMAT,
  ARCHIVE_IMPORT_ORDER,
  ARCHIVE_VERSION,
  archiveSummary,
  canonicalArchive,
  createArchive,
  findArchiveProblems,
  parseArchive,
  type ArchiveContent,
} from '../src/transfer.js';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'kuba@example.com',
  nickname: 'Kuba',
  role: 'user',
} as const;

const STAMPS = {
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-01T08:00:00.000Z',
  deletedAt: null,
} as const;

function content(): ArchiveContent {
  const plecy = tagId('Plecy');
  const deadlift = exerciseId(USER.id, 'Martwy ciąg');

  return {
    users: [{ ...USER }],
    tags: [{ id: plecy, name: 'Plecy', slug: slug('Plecy'), color: tagColor('Plecy'), ...STAMPS }],
    exercises: [
      {
        id: deadlift,
        name: 'Martwy ciąg',
        slug: slug('Martwy ciąg'),
        authorId: USER.id,
        loggingType: 'weight_reps',
        primaryTagId: plecy,
        additionalTagIds: [],
        note: null,
        ...STAMPS,
      },
    ],
    sets: [
      {
        id: '00000000-0000-7000-8000-000000000001',
        userId: USER.id,
        exerciseId: deadlift,
        performedOn: '2026-08-10',
        position: 0,
        weightG: 140_000,
        reps: 5,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: 'czysto',
        ...STAMPS,
      },
    ],
    cycles: [
      {
        id: '00000000-0000-7000-8000-000000000002',
        userId: USER.id,
        name: 'Sierpień',
        startsOn: '2026-08-01',
        endsOn: '2026-08-31',
        archivedAt: null,
        goals: [
          {
            id: '00000000-0000-7000-8000-000000000003',
            metric: 'sets',
            target: 20,
            exerciseId: deadlift,
            tagId: null,
          },
        ],
        ...STAMPS,
      },
    ],
  };
}

describe('createArchive', () => {
  it('stempluje format, wersję i moment eksportu', () => {
    const archive = createArchive(content(), {
      scope: 'user',
      exportedAt: new Date('2026-08-11T10:00:00Z'),
    });

    expect(archive).toMatchObject({
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      scope: 'user',
      exportedAt: '2026-08-11T10:00:00.000Z',
    });
  });

  it('archiwum przechodzi własny parser bez zmian', () => {
    const archive = createArchive(content(), {
      scope: 'system',
      exportedAt: new Date('2026-08-11T10:00:00Z'),
    });
    expect(parseArchive(JSON.parse(JSON.stringify(archive)))).toEqual(archive);
  });
});

describe('parseArchive', () => {
  it('odrzuca plik, który nie jest archiwum AlphaPump', () => {
    expect(() => parseArchive({ hello: 'world' })).toThrow();
  });

  it('odrzuca wersję formatu, której nie zna', () => {
    const archive = {
      ...createArchive(content(), { scope: 'user', exportedAt: new Date('2026-08-11T10:00:00Z') }),
      version: 999,
    };
    expect(() => parseArchive(archive)).toThrow();
  });

  it('odrzuca serię z pomiarem ujemnym', () => {
    const broken = createArchive(content(), {
      scope: 'user',
      exportedAt: new Date('2026-08-11T10:00:00Z'),
    });
    broken.sets[0]!.reps = -1;
    expect(() => parseArchive(broken)).toThrow();
  });
});

describe('findArchiveProblems', () => {
  it('spójne archiwum nie ma problemów', () => {
    expect(findArchiveProblems(content())).toEqual([]);
  });

  it('wskazuje ćwiczenie bez autora w pliku', () => {
    const broken = content();
    broken.users = [];

    expect(findArchiveProblems(broken)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: 'exercise', message: expect.stringContaining('Autor') }),
      ]),
    );
  });

  it('wskazuje serię bez ćwiczenia w pliku', () => {
    const broken = content();
    broken.exercises = [];

    const problems = findArchiveProblems(broken);
    expect(problems.some((problem) => problem.entity === 'set')).toBe(true);
  });

  it('wskazuje pozycję celu wskazującą na nieobecny tag', () => {
    const broken = content();
    broken.cycles[0]!.goals[0] = {
      ...broken.cycles[0]!.goals[0]!,
      exerciseId: null,
      tagId: tagId('Nogi'),
    };

    expect(findArchiveProblems(broken)).toEqual(
      expect.arrayContaining([expect.objectContaining({ entity: 'cycle' })]),
    );
  });
});

describe('canonicalArchive', () => {
  it('nie widzi kolejności wierszy ani momentu eksportu', () => {
    const first = content();
    const second = content();
    second.tags = [...second.tags].reverse();
    second.exercises[0]!.additionalTagIds = [];

    expect(canonicalArchive(second)).toEqual(canonicalArchive(first));
  });

  it('widzi zmianę powiązania autora ćwiczenia', () => {
    const changed = content();
    changed.exercises[0]!.authorId = '22222222-2222-4222-8222-222222222222';

    expect(canonicalArchive(changed)).not.toEqual(canonicalArchive(content()));
  });

  it('widzi zmianę właściciela serii', () => {
    const changed = content();
    changed.sets[0]!.userId = '22222222-2222-4222-8222-222222222222';

    expect(canonicalArchive(changed)).not.toEqual(canonicalArchive(content()));
  });

  it('nie zależy od znaczników synchronizacji, bo te po odtworzeniu są nowe', () => {
    const changed = content();
    changed.sets[0]!.updatedAt = '2026-09-09T09:09:09.000Z';

    expect(canonicalArchive(changed)).toEqual(canonicalArchive(content()));
  });
});

describe('archiveSummary', () => {
  it('zlicza wiersze każdej encji', () => {
    expect(archiveSummary(content())).toEqual({
      users: 1,
      tags: 1,
      exercises: 1,
      sets: 1,
      cycles: 1,
    });
  });

  it('kolejność importu idzie od bytów niezależnych do zależnych', () => {
    expect(ARCHIVE_IMPORT_ORDER).toEqual(['users', 'tags', 'exercises', 'sets', 'cycles']);
  });
});

describe('planArchiveIdentity', () => {
  const KNOWN_ID = '99999999-9999-4999-8999-999999999999';

  it('bez zmiany identyfikatora autora nie rusza niczego', () => {
    const plan = planArchiveIdentity(content(), new Map([[USER.email, USER.id]]));

    expect(plan.userIdMap.get(USER.id)).toBe(USER.id);
    expect(plan.missingUsers).toEqual([]);
    expect(plan.remappedExerciseIds).toEqual([]);
    expect(plan.exerciseIdMap.get(exerciseId(USER.id, 'Martwy ciąg'))).toBe(
      exerciseId(USER.id, 'Martwy ciąg'),
    );
  });

  it('dopasowuje konto po adresie e-mail i przelicza identyfikator ćwiczenia', () => {
    const archive = content();
    const plan = planArchiveIdentity(archive, new Map([[USER.email, KNOWN_ID]]));

    expect(plan.userIdMap.get(USER.id)).toBe(KNOWN_ID);
    expect(plan.remappedExerciseIds).toEqual([archive.exercises[0]!.id]);
    // Nowy identyfikator wynika z **nowej** pary autor + nazwa — inaczej push
    // odrzuciłby to ćwiczenie przy pierwszej synchronizacji.
    expect(plan.exerciseIdMap.get(archive.exercises[0]!.id)).toBe(
      exerciseId(KNOWN_ID, 'Martwy ciąg'),
    );
  });

  it('dopasowanie po e-mailu nie zależy od wielkości liter', () => {
    const plan = planArchiveIdentity(
      content(),
      new Map([['KUBA@EXAMPLE.COM'.toLowerCase(), KNOWN_ID]]),
    );
    expect(plan.userIdMap.get(USER.id)).toBe(KNOWN_ID);
  });

  it('wskazuje konta, których baza docelowa nie zna', () => {
    const plan = planArchiveIdentity(content(), new Map());

    expect(plan.missingUsers.map((user) => user.email)).toEqual([USER.email]);
    // Identyfikator zostaje z archiwum: to konto trzeba będzie założyć.
    expect(plan.userIdMap.get(USER.id)).toBe(USER.id);
    expect(plan.remappedExerciseIds).toEqual([]);
  });
});

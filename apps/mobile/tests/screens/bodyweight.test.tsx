/**
 * Karta „Bodyweight" na ekranie konta.
 *
 * Sprawdzane jest to, czego nie widzi test czystej funkcji: że pole pokazuje
 * masę **zapisaną na urządzeniu** (a nie pustkę), że zapis naprawdę trafia do
 * magazynu w gramach i z dzisiejszą datą, że historia pokazuje zmianę względem
 * poprzedniego pomiaru i że pole wyczyszczone kasuje ustawienie zamiast
 * zapisywać zero — bo zero podstawiałoby się potem do każdej serii.
 */

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BodyweightEntry, BodyweightStore } from '../../src/bodyweight/state';
import { today } from '../../src/day-labels';
import { BodyweightSettings } from '../../src/ui/bodyweight';
import { mount, screenText, user } from './harness';

/** Magazyn w pamięci — telefon trzyma historię w pliku, test w zmiennej. */
function memoryStore(
  history: BodyweightEntry[],
): BodyweightStore & { current: () => readonly BodyweightEntry[] } {
  let stored: readonly BodyweightEntry[] = history;
  return {
    read: () => Promise.resolve([...stored]),
    write: (next) => {
      stored = next;
      return Promise.resolve();
    },
    current: () => stored,
  };
}

const field = () => screen.getByLabelText('Current weight') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save bodyweight' });

describe('ustawienie masy ciała', () => {
  it('pokazuje masę zapisaną na urządzeniu, w kilogramach', async () => {
    await mount(
      <BodyweightSettings store={memoryStore([{ on: '2026-06-01', bodyweightG: 80_500 }])} />,
    );

    expect(field().value).toBe('80.5');
  });

  it('startuje pusto, dopóki nikt masy nie podał', async () => {
    await mount(<BodyweightSettings store={memoryStore([])} />);

    expect(field().value).toBe('');
  });

  it('zapisuje wpisaną masę w gramach, pod dzisiejszą datą', async () => {
    const store = memoryStore([]);
    await mount(<BodyweightSettings store={store} />);

    await user().type(field(), '78,5');
    await user().click(saveButton());

    expect(store.current()).toEqual([{ on: today(), bodyweightG: 78_500 }]);
  });

  it('puste pole kasuje ustawienie razem z historią', async () => {
    const store = memoryStore([{ on: '2026-06-01', bodyweightG: 80_000 }]);
    await mount(<BodyweightSettings store={store} />);

    await user().clear(field());
    await user().click(saveButton());

    expect(store.current()).toEqual([]);
  });

  it('bzdury nie zapisuje, tylko mówi, czego oczekuje', async () => {
    const store = memoryStore([{ on: '2026-06-01', bodyweightG: 80_000 }]);
    await mount(<BodyweightSettings store={store} />);

    await user().clear(field());
    await user().type(field(), 'ciężko');
    await user().click(saveButton());

    expect(store.current()).toEqual([{ on: '2026-06-01', bodyweightG: 80_000 }]);
    expect(screenText()).toContain('Enter your weight in kilograms');
  });
});

describe('historia masy ciała', () => {
  it('pokazuje dotychczasowe pomiary razem ze zmianą', async () => {
    // To jest cały powód, dla którego historia istnieje: „−2 kg" jest zdaniem
    // o treningu, a sama liczba „80" nie jest.
    await mount(
      <BodyweightSettings
        store={memoryStore([
          { on: '2026-06-01', bodyweightG: 80_000 },
          { on: '2026-05-04', bodyweightG: 82_000 },
        ])}
      />,
    );

    expect(screenText()).toContain('80 kg');
    expect(screenText()).toContain('−2 kg');
    expect(screenText()).toContain('82 kg');
  });

  it('bez ani jednego pomiaru nie stoi na ekranie pustą sekcją', async () => {
    await mount(<BodyweightSettings store={memoryStore([])} />);

    expect(screenText()).not.toContain('History');
  });

  it('dopisuje zapisaną masę do historii', async () => {
    const store = memoryStore([{ on: '2026-06-01', bodyweightG: 80_000 }]);
    await mount(<BodyweightSettings store={store} />);

    await user().clear(field());
    await user().type(field(), '79');
    await user().click(saveButton());

    expect(store.current()).toEqual([
      { on: today(), bodyweightG: 79_000 },
      { on: '2026-06-01', bodyweightG: 80_000 },
    ]);
  });
});

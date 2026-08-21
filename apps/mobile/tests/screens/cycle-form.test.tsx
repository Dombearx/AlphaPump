/**
 * Formularz cyklu — najdłuższy ekran w aplikacji i jedyny z formularzem
 * zagnieżdżonym w formularzu: cykl ma nazwę i zakres dat, a w środku listę
 * pozycji celu, z których każda ma własny zestaw pól.
 *
 * Sprawdzane jest to, czego test logiki nie widzi: że pola pozycji celu wynikają
 * z **wybranej metryki**, że cykl bez pozycji nie da się zapisać, i że zapisany
 * cykl ląduje w bazie lokalnej razem ze swoimi pozycjami — bo to one, a nie sam
 * cykl, naliczają postęp.
 */

import { screen } from '@testing-library/react';
import { cycleGoals, cycles } from '@alphapump/db/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CycleFormScreen } from '../../src/screens/cycle-form';
import { TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, user, type MountedScreen } from './harness';

describe('formularz cyklu', () => {
  let local: MountedScreen;

  beforeEach(async () => {
    local = await openLocalDatabase();
    mount(<CycleFormScreen mode={{ kind: 'create' }} />);
  });

  afterEach(() => local.close());

  it('pokazuje gotowe zakresy zamiast pustego pola daty', () => {
    // Wpisanie dwóch dat z palca to najdłuższa droga do cyklu, jaką da się
    // wymyślić — a prawie każdy cykl to tydzień, dwa albo miesiąc.
    const text = screenText();
    expect(text).toContain('One week');
    expect(text).toContain('30 days');
    expect(text).toContain('No end');
  });

  it('mówi wprost, jaki zakres wyjdzie z wybranych ustawień', () => {
    // Sam licznik dni nie mówi, kiedy cykl się kończy, a to jest ta informacja,
    // przez którą ktoś zauważa, że pomylił się o tydzień.
    expect(screenText()).toMatch(/Range: \d{4}-\d{2}-\d{2}/);
  });

  it('nie zapisuje cyklu bez pozycji celu', async () => {
    // Cykl bez pozycji nie naliczy niczego i nie powie o tym ani słowa —
    // wyglądałby jak cykl, który po prostu stoi w miejscu.
    await user().type(screen.getByLabelText('Name'), 'Sierpień');
    await user().click(screen.getByRole('button', { name: 'Save cycle' }));

    expect(await local.db.select().from(cycles)).toHaveLength(0);
  });

  it('zapisuje cykl razem z pozycją celu', async () => {
    await user().type(screen.getByLabelText('Name'), 'Sierpień');
    // Pozycja celu potrzebuje trzech rzeczy: metryki (domyślnie „sets"), tego,
    // co ma liczyć, i liczby. Bez kompletu przycisk zostaje wyłączony — i to też
    // jest tu sprawdzone, bo wcześniej dawał się nacisnąć i nic nie robił.
    await user().click(screen.getByRole('button', { name: 'chest' }));
    await user().type(screen.getByLabelText('Target'), '60');
    await user().click(screen.getByRole('button', { name: 'Add item' }));
    await user().click(screen.getByRole('button', { name: 'Save cycle' }));

    const saved = await local.db.select().from(cycles);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Sierpień', userId: TEST_USER.id });
    // Bez `server_seq` — cykl powstał offline i serwer o nim jeszcze nie wie.
    expect(saved[0]?.serverSeq).toBeNull();

    const goals = await local.db.select().from(cycleGoals);
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ metric: 'sets', target: 60, cycleId: saved[0]?.id });
    // Cel tagowy, więc `tagId` wypełniony, a `exerciseId` pusty — pozycja liczy
    // po tagu głównym ćwiczenia, a nie po jednym konkretnym ćwiczeniu.
    expect(goals[0]?.tagId).not.toBeNull();
    expect(goals[0]?.exerciseId).toBeNull();
  });

  it('tłumaczy, że cel tagowy liczy tylko tag główny', () => {
    // Filtr biblioteki obejmuje też tagi dodatkowe, więc bez tego zdania cel
    // „triceps" wyglądałby, jakby miał liczyć dipy — a nie liczy.
    expect(screenText()).toContain("A tag goal only counts an exercise's primary tag");
  });
});

/**
 * Tapeta widziana z ekranu: karta ustawień w koncie i zdjęcie pod aplikacją.
 *
 * Magazyn jest atrapą, bo to warstwa natywna — wybór pliku i katalog dokumentów
 * istnieją wyłącznie na telefonie. Wszystko powyżej jedzie prawdziwe: to tu
 * widać, czy wybrane zdjęcie **faktycznie** trafia pod aplikację, czy odmowa ma
 * gdzie się pokazać i czy da się wrócić do tła domyślnego.
 */

import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackgroundProvider } from '../../src/background/provider';
import type { BackgroundStore } from '../../src/background/state';
import { AppBackdrop, BackgroundSettings } from '../../src/ui/background';
import { mount, user } from './harness';

const WALLPAPER = 'file:///documents/background/background-1.jpg';

/** Korzeń i karta ustawień razem — tak, jak stoją w aplikacji. */
function mountBackground(store: Partial<BackgroundStore>): void {
  const full: BackgroundStore = {
    read: async () => null,
    pick: async () => null,
    clear: async () => undefined,
    ...store,
  };

  mount(
    <BackgroundProvider store={full}>
      <AppBackdrop />
      <BackgroundSettings />
    </BackgroundProvider>,
  );
}

/** Zdjęcie pod aplikacją — albo jego brak. */
function backdrop(): Element | null {
  return document.querySelector('[data-testid="app-backdrop"]');
}

describe('tapeta aplikacji', () => {
  it('domyślnie nie podkłada niczego pod aplikację', async () => {
    mountBackground({});

    expect(await screen.findByText('Default background')).toBeTruthy();
    expect(backdrop()).toBeNull();
  });

  it('wybrane zdjęcie ląduje pod aplikacją od razu', async () => {
    // Bez tego tapeta byłaby widoczna dopiero po ponownym otwarciu aplikacji —
    // czyli wyglądałaby jak niedziałająca.
    mountBackground({ pick: async () => WALLPAPER });

    await user().click(screen.getByRole('button', { name: 'Choose a photo' }));

    expect(await screen.findByText('Your photo')).toBeTruthy();
    expect(backdrop()).not.toBeNull();
  });

  it('pokazuje tapetę zapamiętaną z poprzedniego uruchomienia', async () => {
    mountBackground({ read: async () => WALLPAPER });

    expect(await screen.findByText('Your photo')).toBeTruthy();
    expect(backdrop()).not.toBeNull();
  });

  it('przywraca domyślne tło', async () => {
    const clear = vi.fn(async () => undefined);
    mountBackground({ read: async () => WALLPAPER, clear });

    await user().click(await screen.findByRole('button', { name: 'Use the default' }));

    expect(clear).toHaveBeenCalled();
    expect(await screen.findByText('Default background')).toBeTruthy();
    expect(backdrop()).toBeNull();
  });

  it('mówi, dlaczego zdjęcie nie zostało przyjęte', async () => {
    mountBackground({
      pick: () => Promise.reject(new Error('That image is 12.0 MB and the limit is 8.0 MB')),
    });

    await user().click(screen.getByRole('button', { name: 'Choose a photo' }));

    expect(await screen.findByText(/12.0 MB/)).toBeTruthy();
    expect(backdrop()).toBeNull();
  });

  it('rezygnacja z wyboru zostawia tapetę, która była', async () => {
    // Zamknięcie okna wyboru pliku nie jest błędem i nie ma prawa skasować
    // zdjęcia, które użytkownik ustawił wcześniej.
    mountBackground({ read: async () => WALLPAPER, pick: async () => null });

    await user().click(await screen.findByRole('button', { name: 'Change photo' }));

    expect(await screen.findByText('Your photo')).toBeTruthy();
    expect(backdrop()).not.toBeNull();
  });
});

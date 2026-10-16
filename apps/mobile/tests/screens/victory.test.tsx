/**
 * Overlay animacji zwycięstwa.
 *
 * Sprawdzane jest to, czego nie widzi test czystej funkcji: że overlay składa
 * się w całość razem z dwunastoma glifami wybuchu, że tapnięcie zamyka go od
 * razu i że po `VICTORY_MS` schodzi sam. To ostatnie jest tu sednem — overlay
 * zasłania cały ekran, więc odliczanie, które nie dojdzie do końca, zostawia
 * aplikację bez wyjścia poza zgadnięciem, że trzeba tapnąć.
 *
 * Czego ten test nie sprawdza: samego ruchu. Wartości `Animated` liczy warstwa
 * natywna i wygląd animacji ocenia się na telefonie, nie w jsdomie.
 */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VICTORY_MS, VICTORY_SPARK_COUNT, victoryShout } from '../../src/victory';
import { VictoryOverlay } from '../../src/ui/victory';

const dismiss = () => screen.getByRole('button', { name: 'Dismiss the celebration' });

describe('animacja zwycięstwa', () => {
  it('krzyczy nagłówkiem i okrzykiem tego triumfu', () => {
    render(<VictoryOverlay round={1} onDone={vi.fn()} />);

    expect(screen.getByText('WIĘCEJ NIŻ MASON!')).toBeDefined();
    expect(screen.getByText(victoryShout(1))).toBeDefined();
  });

  it('nie jest dyskretnym komunikatem — wysypuje fajerwerki', () => {
    // Zgłoszenie prosi wprost o efektowny overlay, a nie o linijkę tekstu.
    // Glify wybuchu poznajemy po przesunięciu od środka: tylko one je mają.
    render(<VictoryOverlay round={0} onDone={vi.fn()} />);

    expect(document.querySelectorAll('[style*="translateX"]')).toHaveLength(VICTORY_SPARK_COUNT);
    expect(screen.getByText('🎺 💪 🎆 💪 🎺')).toBeDefined();
  });

  it('tapnięcie zamyka ją od razu', async () => {
    const onDone = vi.fn();
    render(<VictoryOverlay round={0} onDone={onDone} />);

    await userEvent.click(dismiss());

    expect(onDone).toHaveBeenCalledOnce();
  });

  describe('schodzi sama', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('po czasie animacji, bez niczyjego tapnięcia', () => {
      const onDone = vi.fn();
      render(<VictoryOverlay round={0} onDone={onDone} />);

      act(() => vi.advanceTimersByTime(VICTORY_MS - 1));
      expect(onDone).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(1));
      expect(onDone).toHaveBeenCalledOnce();
    });
  });
});

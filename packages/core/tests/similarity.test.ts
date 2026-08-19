/**
 * Ostrzeganie o podobnych ćwiczeniach — kryterium etapu 8 w jego czystej części.
 *
 * Testy pilnują dwóch rzeczy naraz: że duplikat zostaje znaleziony i że nazwy
 * dzielące wyłącznie ogon znaków **nie** są uznawane za podobne. Druga część
 * jest ważniejsza — ostrzeżenie, które zapala się zawsze, przestaje cokolwiek
 * znaczyć.
 */

import { describe, expect, it } from 'vitest';
import {
  SIMILARITY_THRESHOLD,
  findSimilarExercises,
  nameContains,
  nameSimilarity,
  nameTokens,
  tokenSimilarity,
} from '../src/similarity.js';

const LIBRARY = [
  { id: 'e-1', name: 'Wyciskanie sztangi leżąc' },
  { id: 'e-2', name: 'Wiosłowanie sztangą' },
  { id: 'e-3', name: 'Przysiad ze sztangą' },
  { id: 'e-4', name: 'Martwy ciąg' },
  { id: 'e-5', name: 'Podciąganie nachwytem' },
];

describe('nameTokens', () => {
  it('rozbija nazwę na słowa sluga', () => {
    expect(nameTokens('Wyciskanie sztangi leżąc')).toEqual(['wyciskanie', 'sztangi', 'lezac']);
  });

  it('pomija człony nieznaczące', () => {
    expect(nameTokens('Wyciskanie sztangi na ławce')).toEqual(['wyciskanie', 'sztangi', 'lawce']);
  });

  it('nazwa z samych krótkich członów nie zostaje bez słów', () => {
    expect(nameTokens('V up')).toEqual(['v', 'up']);
  });
});

describe('tokenSimilarity', () => {
  it('odmiana tego samego słowa jest bliska jedynki', () => {
    expect(tokenSimilarity('przysiad', 'przysiady')).toBeGreaterThan(0.85);
  });

  it('różne słowa o wspólnym rdzeniu literowym zostają nisko', () => {
    expect(tokenSimilarity('wyciskanie', 'wioslowanie')).toBeLessThan(0.5);
  });
});

describe('nameSimilarity', () => {
  it('ten sam slug daje jedynkę', () => {
    expect(nameSimilarity('Martwy ciąg', 'martwy CIAG')).toBe(1);
  });

  it('nazwa dłuższa o jeden człon zostaje bardzo podobna', () => {
    expect(nameSimilarity('Przysiad', 'Przysiady przednie')).toBeGreaterThan(0.6);
  });

  it('wspólny ogon znaków to za mało, żeby uznać nazwy za podobne', () => {
    // Trigramowe porównanie całych napisów dałoby tu fałszywy alarm — oba
    // napisy kończą się na „sztang…" i mają podobną długość. Jedno wspólne
    // słowo z dwóch to dokładnie ten przypadek, przed którym broni próg.
    expect(nameSimilarity('Wiosłowanie sztangą', 'Wyciskanie sztangi')).toBeLessThan(
      SIMILARITY_THRESHOLD,
    );
  });

  it('nazwa bez liter nie jest podobna do niczego', () => {
    expect(nameSimilarity('???', 'Martwy ciąg')).toBe(0);
  });
});

describe('nameContains', () => {
  it('krótsza nazwa jest fragmentem dłuższej mimo odmiany', () => {
    expect(nameContains('Przysiady bułgarskie ze sztangielkami', 'Przysiad')).toBe(true);
  });

  it('fragment nie działa w drugą stronę', () => {
    expect(nameContains('Przysiad', 'Przysiady bułgarskie ze sztangielkami')).toBe(false);
  });

  it('nie zależy od wielkości liter ani od ogonków', () => {
    expect(nameContains('wyciskanie sztangi lezac', 'WYCISKANIE LEŻĄC')).toBe(true);
  });

  it('jedno wspólne słowo z dwóch to nie fragment', () => {
    expect(nameContains('Wiosłowanie sztangą', 'Wyciskanie sztangi')).toBe(false);
  });

  it('nazwa bez liter nie jest fragmentem niczego', () => {
    expect(nameContains('Martwy ciąg', '???')).toBe(false);
  });
});

describe('findSimilarExercises', () => {
  it('znajduje duplikat mimo odmiany i braku ogonków', () => {
    const matches = findSimilarExercises('wyciskanie sztangi lezac', LIBRARY);

    expect(matches[0]?.exercise.id).toBe('e-1');
    expect(matches[0]?.identical).toBe(true);
  });

  it('znajduje wariant nazwy, choć slug jest inny', () => {
    const matches = findSimilarExercises('Martwy ciąg klasyczny', LIBRARY);

    expect(matches.map((match) => match.exercise.id)).toEqual(['e-4']);
    expect(matches[0]?.identical).toBe(false);
  });

  it('ostrzega, gdy wpisana nazwa jest fragmentem istniejącej', () => {
    // Sam wynik to tu `2 × 1 / 4`, czyli poniżej progu — a jest to duplikat,
    // o którym serwer mówi w trybie online. Offline nie ma go czym zastąpić.
    expect(nameSimilarity('Wyciskanie', 'Wyciskanie sztangi leżąc')).toBeLessThan(
      SIMILARITY_THRESHOLD,
    );

    const matches = findSimilarExercises('Wyciskanie', LIBRARY);
    expect(matches.map((match) => match.exercise.id)).toEqual(['e-1']);
  });

  it('ostrzega, gdy istniejąca nazwa jest fragmentem wpisanej', () => {
    const name = 'Martwy ciąg sumo na podwyższeniu z pasem';
    expect(nameSimilarity(name, 'Martwy ciąg')).toBeLessThan(SIMILARITY_THRESHOLD);

    const matches = findSimilarExercises(name, LIBRARY);
    expect(matches.map((match) => match.exercise.id)).toEqual(['e-4']);
  });

  it('nie ostrzega przy nazwie, której w bibliotece nie ma', () => {
    expect(findSimilarExercises('Wiosłowanie hantlem jednorącz', LIBRARY)).toEqual([]);
  });

  it('pusta nazwa nie daje ostrzeżenia', () => {
    expect(findSimilarExercises('  ', LIBRARY)).toEqual([]);
  });

  it('pomija ćwiczenie edytowane — nie jest duplikatem samego siebie', () => {
    const matches = findSimilarExercises('Martwy ciąg', LIBRARY, { excludeId: 'e-4' });
    expect(matches).toEqual([]);
  });

  it('oddaje najwyżej tyle wpisów, ile pozwala limit', () => {
    const library = [
      { id: 'a', name: 'Przysiad' },
      { id: 'b', name: 'Przysiady' },
      { id: 'c', name: 'Przysiad przedni' },
      { id: 'd', name: 'Przysiad bułgarski' },
    ];

    expect(findSimilarExercises('Przysiad', library, { limit: 2 })).toHaveLength(2);
  });
});

/**
 * ZŁOTE WARTOŚCI — KONTRAKT DANYCH.
 *
 * Ten plik nie jest zestawem asercji, tylko zapisem umowy. Identyfikatory
 * ćwiczeń i tagów są wyliczane deterministycznie z nazwy, więc każda zmiana
 * `slug()`, przestrzeni nazw albo klucza identyfikatora **przepisuje id
 * istniejących wierszy** — serie zaczynają wskazywać na ćwiczenia, których już
 * nie ma, a ćwiczenia utworzone offline przestają się deduplikować.
 *
 * Jeżeli test korzystający z tego pliku zaczyna padać, to nie jest test do
 * poprawienia. To sygnał, że zmiana wymaga świadomej decyzji i migracji danych.
 *
 * **Kolorów tu nie ma i być nie powinno.** Były, i kosztowało to tablicę ośmiu
 * wyjątków wpisanych w `tag-color.ts` tylko po to, żeby ten plik dalej
 * przechodził. Kolor jest zapisany w kolumnie `tags.color`, więc istniejące tagi
 * mają swój niezależnie od wzoru — zmiana wzoru dotyczy wyłącznie tagów
 * tworzonych od tej chwili i niczego nie osierocą. Kontraktem są slug
 * i identyfikator: to one wchodzą w klucze obce.
 */

/** Autor spoza konta systemowego — stały, żeby wartości poniżej były powtarzalne. */
export const GOLDEN_AUTHOR_ID = '0193f0a0-1c2d-7e3f-8a9b-0c1d2e3f4a5b';

export interface GoldenTag {
  name: string;
  slug: string;
  id: string;
}

export const GOLDEN_TAGS: readonly GoldenTag[] = [
  { name: 'Biceps', slug: 'biceps', id: 'd939750b-cb23-5e32-b7c7-d87be1418613' },
  { name: 'biceps', slug: 'biceps', id: 'd939750b-cb23-5e32-b7c7-d87be1418613' },
  { name: 'BICEPS', slug: 'biceps', id: 'd939750b-cb23-5e32-b7c7-d87be1418613' },
  {
    name: 'Klatka piersiowa',
    slug: 'klatka-piersiowa',
    id: '31b7576b-1091-52f1-b991-e66d3b141fd5',
  },
  {
    name: 'Nogi – przód',
    slug: 'nogi-przod',
    id: 'f165baf1-8a0d-564a-93e7-c24547a70c27',
  },
  {
    name: 'Grzbiet',
    slug: 'grzbiet',
    id: 'f5aebe6b-7bf2-5c41-b865-7ca39117e52e',
  },
  { name: 'Łydki', slug: 'lydki', id: '3691d807-6e16-5395-b98e-33dd525cbcd9' },
  {
    name: 'Ćwiczenia złożone',
    slug: 'cwiczenia-zlozone',
    id: '008279e7-2a06-59be-bec6-eee223a5cffa',
  },
  {
    name: 'Triceps / ramię',
    slug: 'triceps-ramie',
    id: 'e3d2ebd4-57ba-5c5c-b95d-333e44132d22',
  },
  {
    name: '  Barki  ',
    slug: 'barki',
    id: '4793ede6-ee6f-5160-bd55-22c14d4d068b',
  },
];

export interface GoldenExercise {
  name: string;
  slug: string;
  /** `uuidv5(NS_EXERCISE, "${SYSTEM_USER_ID}/${slug}")` — ćwiczenie wbudowane. */
  builtInId: string;
  /** `uuidv5(NS_EXERCISE, "${GOLDEN_AUTHOR_ID}/${slug}")` — to samo, inny autor. */
  authoredId: string;
}

export const GOLDEN_EXERCISES: readonly GoldenExercise[] = [
  {
    name: 'Wyciskanie sztangi leżąc',
    slug: 'wyciskanie-sztangi-lezac',
    builtInId: '22c7ce8b-9cd7-579c-a512-6bfbb5af664f',
    authoredId: '267872be-c4bd-5660-a5c0-5c71253ffa7c',
  },
  {
    name: 'Martwy ciąg',
    slug: 'martwy-ciag',
    builtInId: '27b4e502-4c06-54a2-9bf2-7adb249ba62b',
    authoredId: '1c2c3bd6-2ff9-59ce-b537-e9f5efefdd0b',
  },
  {
    name: 'Podciąganie (nachwyt)',
    slug: 'podciaganie-nachwyt',
    builtInId: 'cfae87ee-b514-53f9-ae0e-79e3c855fced',
    authoredId: '8fd6077e-57fa-5fb3-a33b-2f673d19b77b',
  },
  {
    name: 'Przysiad ze sztangą',
    slug: 'przysiad-ze-sztanga',
    builtInId: '580e8436-cfc1-52c7-94d7-b92dff3171da',
    authoredId: '4bdf9bf9-3520-50df-a30b-9f31a57d4810',
  },
  {
    name: 'Bieg',
    slug: 'bieg',
    builtInId: '817feba5-0bf3-5f80-aa83-bcbe17056350',
    authoredId: 'f9c195e7-1995-5fa8-ab18-753926457faa',
  },
  {
    name: 'Deska (plank)',
    slug: 'deska-plank',
    builtInId: 'fd027784-8a75-55d1-9720-624dbfaa9cf0',
    authoredId: '50a90dd8-4ad1-5dff-82f6-09b8d7ea9689',
  },
  {
    name: "Farmer's walk",
    slug: 'farmers-walk',
    builtInId: '7d817b2d-a382-53a9-b97a-c397256a83b5',
    authoredId: '70f85f6c-05e6-5b49-aec4-a5254a72545b',
  },
  {
    name: 'Wznosy bokiem — hantle',
    slug: 'wznosy-bokiem-hantle',
    builtInId: 'd55c86f6-2768-513b-b11b-068c393f69d6',
    authoredId: 'fd7acad0-2b31-5fbf-8b1c-a3e42c500e31',
  },
];

/** Przestrzenie nazw i konto systemowe — również objęte kontraktem. */
export const GOLDEN_NAMESPACES = {
  NS_ALPHAPUMP: 'f885e373-f6d3-5597-b235-000747dbfff8',
  NS_EXERCISE: 'ede0b886-0a38-5e97-9992-475f2fbabb87',
  NS_TAG: '387d6d24-6bbc-5f2e-8dab-a25f96fb1d2d',
  SYSTEM_USER_ID: '73d7cbab-d3b4-549a-8d8f-9de36dbaae82',
} as const;

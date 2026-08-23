/**
 * Pola na nazwy w pozostałych językach — jeden `Field` na język.
 *
 * Stoją **pod** nazwą kanoniczną i są opcjonalne, bo taka jest reguła całej tej
 * warstwy: nazwa wpisana ręcznie ma pierwszeństwo, a puste pole znaczy „niech
 * dołoży model". Podpis mówi to wprost, żeby nikt nie czuł się zobowiązany do
 * wypełnienia dwóch pól przy dodawaniu ćwiczenia w trakcie treningu.
 *
 * Nazwa kanoniczna zostaje osobno i nie jest tu powtarzana: to z niej liczy się
 * identyfikator ćwiczenia, więc gdyby dało się ją edytować „przy okazji" jako
 * jeden z języków, ta sama nazwa w dwóch językach dałaby dwa różne wiersze.
 */

import { LANGUAGES, LANGUAGE_LABELS, type Language, type Translations } from '@alphapump/core';
import { Text, View } from 'react-native';
import { Field } from './primitives';

/** Stan pól: napis na język, bo tym operuje `TextInput`. Pusty znaczy „brak". */
export type TranslationDraft = Record<Language, string>;

export const EMPTY_TRANSLATIONS: TranslationDraft = { en: '', pl: '' };

/** Zestaw z bazy do pól formularza; brak tłumaczenia to puste pole. */
export function draftFromTranslations(translations: Translations | null | undefined) {
  const draft = { ...EMPTY_TRANSLATIONS };
  for (const language of LANGUAGES) draft[language] = translations?.[language] ?? '';
  return draft;
}

/**
 * Pola formularza z powrotem do zestawu. `null`, gdy nie wpisano ani jednej
 * nazwy — kolumna trzyma wtedy `NULL`, a nie pusty obiekt, żeby „nie ma
 * tłumaczeń" wyglądało w bazie zawsze tak samo.
 */
export function translationsFromDraft(draft: TranslationDraft): Translations | null {
  const translations: Translations = {};
  for (const language of LANGUAGES) {
    const name = draft[language].trim();
    if (name.length > 0) translations[language] = name;
  }
  return Object.keys(translations).length > 0 ? translations : null;
}

export function TranslationFields({
  draft,
  onChange,
}: {
  draft: TranslationDraft;
  onChange: (draft: TranslationDraft) => void;
}) {
  return (
    <View className="gap-3">
      <Text className="text-xs text-muted">
        Names in other languages. Leave a field empty and it gets filled in automatically after the
        next sync — what you type here is never overwritten.
      </Text>
      {LANGUAGES.map((language) => (
        <Field
          key={language}
          label={LANGUAGE_LABELS[language]}
          value={draft[language]}
          onChangeText={(value) => onChange({ ...draft, [language]: value })}
          placeholder="optional"
        />
      ))}
    </View>
  );
}

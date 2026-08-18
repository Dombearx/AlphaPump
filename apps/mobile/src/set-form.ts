/**
 * Przyciski pod formularzem serii.
 *
 * Reguła jest jedna i mieści się w kilku linijkach, ale rozstrzyga o tym, jak
 * wychodzi się z edycji — dlatego siedzi tutaj, w czystym module, i ma test bez
 * renderowania ekranu.
 *
 * W trybie dopisywania jest jeden przycisk („Add set"). Przy edycji zostają
 * dwa: zapis zmian i usunięcie. Nie ma ani „Add as new" (w tym miejscu nikt
 * z tego nie korzystał — nową serię dopisuje się formularzem po wyjściu
 * z edycji), ani „Cancel", bo edycję zamyka tapnięcie w tło, poza kartą
 * formularza, i **odrzuca** przy tym wpisane zmiany.
 */

export type SetFormAction = 'create' | 'update' | 'delete';

/** `editing` to identyfikator edytowanej serii albo `null` przy dopisywaniu. */
export function setFormActions(editing: string | null): readonly SetFormAction[] {
  return editing === null ? ['create'] : ['update', 'delete'];
}

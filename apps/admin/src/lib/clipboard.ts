/**
 * Kopiowanie do schowka.
 *
 * Funkcja istnieje z jednego powodu: `navigator.clipboard` **nie jest**
 * dostępne w tym panelu domyślnie. Przeglądarki wystawiają je wyłącznie
 * w kontekście bezpiecznym (HTTPS albo `localhost`), a panel stoi po HTTP
 * wewnątrz VPN — czyli dokładnie w tym jednym przypadku, w którym API jest
 * `undefined` i wywołanie go wprost wysypuje komponent.
 *
 * Stąd droga awaryjna przez `document.execCommand('copy')`: przestarzała, ale
 * działająca po HTTP i obecna we wszystkich przeglądarkach, w których panel ma
 * prawo działać. Gdy zawiedzie i ona, funkcja mówi „nie udało się" zamiast
 * udawać sukces — hasło tymczasowe pokazuje się **raz**, więc ciche
 * niedokopiowanie kosztowałoby kolejny reset.
 */
export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Kontekst niebezpieczny albo odmowa uprawnienia — próbujemy drogą niżej.
  }

  try {
    const field = document.createElement('textarea');
    field.value = value;
    // Poza ekranem, ale w drzewie: zaznaczenia nie da się zrobić na elemencie,
    // którego nie ma w dokumencie, a `display: none` odbiera zaznaczalność.
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}

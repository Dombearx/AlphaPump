## Cel produktu

Aplikacja mobilna na Androida i iOS służy do bardzo szybkiego zapisywania serii treningowych, śledzenia postępu, realizacji cykli treningowych i porównywania wyników w ramach grupy znajomych korzystających z aplikacji. Aplikacja ma działać w pełni offline, korzystać lokalnie z własnej bazy danych jako podstawowego źródła odczytu i zapisu, a synchronizacja z serwerem ma działać w tle, bez wpływu na szybkość interfejsu.  [developer.android](https://developer.android.com/topic/architecture/data-layer/offline-first)

Produkt ma być minimalistyczny, szybki i spójny wizualnie oraz funkcjonalnie. Podobne akcje w całej aplikacji mają używać tych samych wzorców interfejsu, a formularze, listy i mechanizmy dodawania danych mają być maksymalnie reużywalne, aby użytkownik nie musiał uczyć się kilku sposobów wykonywania podobnych działań.  [play.google](https://play.google.com/store/apps/details?id=com.github.jamesgay.fitnotes&hl=en_US)

## Zakres MVP

MVP obejmuje logowanie użytkowników, bibliotekę ćwiczeń i tagów, dodawanie własnych ćwiczeń i tagów, logowanie serii dla dowolnego dnia, cykle treningowe, rekordy indywidualne i globalne, wykresy postępu per ćwiczenie, kalendarz, globalne rankingi oraz API do logowania i CRUD serii. MVP obejmuje też tryb ciemny, działanie offline, synchronizację w tle, automatyczne rozstrzyganie konfliktów i prosty panel administracyjny do zarządzania użytkownikami oraz bazą danych.  [play.google](https://play.google.com/store/apps/details?id=com.github.jamesgay.fitnotes&hl=en_US)

Poza MVP pozostają rozbudowane funkcje społecznościowe, reset hasła przez e-mail, grupowanie użytkowników w wiele drużyn, wearable integrations, powiadomienia push, rozbudowane plany treningowe i analityka per partia mięśniowa poza widokiem cykli. Te elementy nie są wymagane w pierwszej wersji produktu.  [getfitnotes](https://www.getfitnotes.com/docs/records.html)

## Platformy i użytkownicy

Aplikacja ma działać na telefonach z Androidem i iOS. Wsparcie dla tabletów nie jest wymaganiem MVP.

Pierwsze wydanie obejmuje Androida. Wsparcie iOS dochodzi w kolejnym kroku i pozostaje wymaganiem docelowym - aplikacja jest budowana tak, aby dodanie iOS nie wymagało zmian w kodzie. 

W systemie występują dwie role:
- użytkownik,
- administrator.

Każdy użytkownik posiada dokładnie jeden profil. Konto użytkownika jest obowiązkowe do korzystania z aplikacji i nie istnieje tryb anonimowy. 

## Logowanie i konto

Aplikacja ma obsługiwać dwie metody logowania:
- Google,
- e-mail + hasło.

Potwierdzenie adresu e-mail nie jest wymagane. Reset hasła przez e-mail nie jest częścią MVP, więc logowanie e-mail + hasło nie wymaga na starcie wdrażania procesu odzyskiwania hasła. 

Każdy użytkownik może wygenerować wiele tokenów API. Tokeny służą do korzystania z API poza interfejsem aplikacji, na przykład przez bota Discord działającego w tym samym VPN. 

## Główne zasady produktu

Podstawową jednostką danych jest seria treningowa. Aplikacja nie wymaga formalnego bytu “trening” jako osobnej encji wymaganej do zapisu danych, a użytkownik zapisuje po prostu serie przypisane do konkretnego dnia.  [play.google](https://play.google.com/store/apps/details?id=com.github.jamesgay.fitnotes&hl=en_US)

Najważniejszym ekranem aplikacji jest widok dodawania serii dla bieżącego dnia. Przepływ ma być zbliżony do FitNotes: użytkownik szybko wybiera ćwiczenie, widzi już dodane serie, może dodać kolejną serię, kliknąć istniejącą serię i na jej podstawie od razu rozpocząć wpisywanie następnej.  [play.google](https://play.google.com/store/apps/details?id=com.github.jamesgay.fitnotes&hl=en_US)

Interfejs ma być minimalistyczny i szybki. Każdy podobny proces wprowadzania danych ma działać w podobny sposób i korzystać z tych samych komponentów oraz wzorców interakcji. 

## Model domenowy

Główne encje w systemie:
- użytkownik,
- ćwiczenie,
- tag,
- seria,
- cykl,
- token API,
- wpis rankingowy,
- rekord ćwiczenia,
- rekord globalny ćwiczenia.

Ćwiczenia, tagi i serie stanowią podstawę działania produktu. Cykle korzystają z serii i ich dopasowania do ćwiczeń lub tagów. Rekordy i rankingi są pochodnymi danych zapisanych w seriach. 

## Ćwiczenia

System posiada jedną wspólną bibliotekę ćwiczeń. Użytkownik może filtrować bibliotekę według:
- ćwiczeń wbudowanych,
- ćwiczeń dodanych przez użytkowników,
- konkretnego użytkownika,
- tagów.

Nowe ćwiczenia dodawane przez użytkownika trafiają do wspólnej biblioteki i są widoczne dla wszystkich.

Podczas dodawania nowego ćwiczenia system ma ostrzegać o podobnych istniejących ćwiczeniach, ale nie blokuje utworzenia nowego wpisu.

Ostrzeżenie o podobnych ćwiczeniach działa również bez połączenia z siecią, w oparciu o dane lokalne. Przy dostępnym połączeniu wyszukiwanie podobieństw jest dokładniejsze i obejmuje także ćwiczenia o innej nazwie, lecz tym samym znaczeniu.

Ćwiczenie może edytować wyłącznie jego autor oraz administrator. Pozostali użytkownicy mogą z ćwiczenia korzystać, ale nie mogą zmieniać jego nazwy, tagów ani notatki. 

Każde ćwiczenie zawiera:
- nazwę,
- autora,
- typ logowania,
- dokładnie jeden główny tag,
- zero lub więcej dodatkowych tagów,
- opcjonalną notatkę.

Główny tag musi być jednoznacznie wskazany przez użytkownika. To właśnie główny tag decyduje o zaliczaniu serii do cykli opartych o partie mięśniowe. 

Typ logowania ćwiczenia jest ustalany przy tworzeniu ćwiczenia i później nie może być zmieniony. Jeśli użytkownik chce inny typ logowania, musi utworzyć nowe ćwiczenie. 

Nazewnictwo ćwiczeń ma być unikalne w obrębie pary:
- nazwa ćwiczenia,
- autor ćwiczenia.

To oznacza, że dwie różne osoby mogą mieć ćwiczenie o tej samej nazwie, ale ten sam użytkownik nie może mieć dwóch własnych ćwiczeń o identycznej nazwie. 

Ćwiczenie może usunąć wyłącznie jego autor oraz administrator. Ćwiczenia, które są używane przez zapisane serie lub zależności systemowe, nie mogą być usuwane w sposób naruszający integralność danych. 

## Tagi

System posiada wspólną listę tagów. Użytkownik może korzystać z tagów istniejących lub tworzyć własne nowe tagi. 

Każdy tag posiada:
- nazwę,
- kolor globalny.

Kolor nowego tagu jest przydzielany automatycznie przez system i powinien różnić się od już użytych kolorów w możliwie praktycznym stopniu. Użytkownik nie ustawia koloru ręcznie. 

Tagi mogą być używane jako:
- główny tag ćwiczenia,
- dodatkowy tag ćwiczenia,
- filtr przeglądania biblioteki ćwiczeń,
- kryterium celu w cyklu.

Tagu nie można usunąć, jeśli istnieją ćwiczenia, które go używają. 

## Serie

Seria treningowa jest podstawową jednostką zapisu. Każda seria należy do konkretnego dnia i konkretnego ćwiczenia. 

Każda seria może zawierać opcjonalną notatkę. 

Obsługiwane typy logowania serii:
- ciężar + powtórzenia,
- ciężar + czas,
- masa ciała + powtórzenia,
- masa ciała + czas,
- dystans + czas.

Dla ćwiczeń opartych o masę ciała użytkownik może wpisać wartość masy ciała. Masa ciała nie bierze udziału w liczeniu rekordów. 

Użytkownik może dodawać serie do:
- dnia bieżącego,
- dowolnego dnia w przeszłości,
- dowolnego dnia wybranego z kalendarza.

Dodanie serii do wskazanego dnia otwiera ten sam widok, co standardowe dodawanie serii, tylko w kontekście wybranej daty. Seria historyczna wpływa na rekordy, wykresy, rankingi i cykle tak samo jak seria dodana bieżącego dnia. 

### Operacje na seriach

Użytkownik może:
- tworzyć serię,
- edytować serię,
- usuwać serię,
- zmieniać kolejność serii w obrębie dnia.

Zmiany muszą automatycznie przeliczać:
- postęp cykli,
- rekordy ćwiczenia,
- rekordy globalne ćwiczenia,
- dane rankingowe,
- wykresy.

### Szybkie logowanie

Aplikacja ma automatycznie podpowiadać wartości dla nowej serii. Jeśli użytkownik dodaje kolejną serię tego samego ćwiczenia tego samego dnia, domyślnie podpowiadane są wartości z poprzednio zapisanej serii tego dnia. 

Jeśli użytkownik dodaje pierwszą serię danego ćwiczenia w danym dniu, system ma podpowiedzieć wartości z pierwszej serii z ostatniego dnia, w którym to ćwiczenie było wykonywane. 

Przykład: jeśli w poniedziałek zapisano serie 10, 9, 6, 4 powtórzenia, to w środę pierwsza seria ma podpowiedzieć 10. Jeśli w środę pierwsza wpisana seria będzie miała 8, to kolejna seria tego samego dnia ma już domyślnie podpowiadać 8. 

### Wybór ćwiczenia z cyklu

W widoku dodawania serii użytkownik może wybrać ćwiczenie w zwykły sposób lub skorzystać z listy pozycji pozostałych do wykonania w aktywnych cyklach. Taki wybór jest tylko skrótem do wygodniejszego wskazania ćwiczenia lub celu i nie oznacza ręcznego przypisania serii do cyklu. 

Każda zapisana seria jest automatycznie dopasowywana przez system do wszystkich pasujących cykli. 

## Kalendarz

Aplikacja ma zawierać widok kalendarza z widokiem miesiąca i tygodnia. W kafelku dnia ma być widoczna liczba zapisanych serii dla tego dnia.  [play.google](https://play.google.com/store/apps/details?id=com.github.jamesgay.fitnotes&hl=en_US)

Po wejściu w konkretny dzień użytkownik przechodzi do widoku dodawania i przeglądania serii dla wybranej daty. Jest to ten sam wzorzec interfejsu co dla bieżącego dnia. 

Nie jest wymagany osobny widok osi czasu jako lista historii niezależna od kalendarza. 

## Cykle

Cykl to zdefiniowany przez użytkownika cel realizowany w określonym czasie. Cykl może zawierać wiele pozycji celu i ma własny zakres dat. 

Każda pozycja celu w cyklu może być zdefiniowana jako:
- określona liczba serii dla wskazanego tagu,
- określona liczba serii dla wskazanego ćwiczenia,
- określona suma czasu dla wskazanego ćwiczenia lub tagu,
- określona suma dystansu dla wskazanego ćwiczenia lub tagu.

Przykłady:
- 12 serii na biceps,
- 6 serii podciągnięć,
- 10 km biegu.

Jeżeli seria pasuje do kilku aktywnych cykli, ma zaliczać się do wszystkich pasujących cykli jednocześnie. 

W przypadku cykli opartych o tagi uwzględniany jest tylko główny tag ćwiczenia. Dodatkowe tagi nie są brane pod uwagę przy zaliczaniu serii do cyklu. 

Cykl może zostać zresetowany przez ustawienie nowej daty początku liczenia. Reset nie usuwa historii poprzednich realizacji. System ma umożliwiać później sprawdzenie, na jakim poziomie użytkownik zrealizował cykl w poprzednich okresach, na przykład że miesiąc wcześniej osiągnął 90 procent celu. 

Cykle mogą być aktywne i archiwalne. Użytkownik musi mieć możliwość przeglądania także historycznych realizacji cykli. 

## Rekordy indywidualne

Każde ćwiczenie posiada swoje rekordy indywidualne użytkownika. Rekord jest liczony na podstawie frontu Pareto odpowiednich wartości, a wszystkie historyczne serie są brane pod uwagę.  [getfitnotes](https://www.getfitnotes.com/docs/records.html)

Dla ćwiczeń typu ciężar + powtórzenia rekordami są punkty niedominowane w przestrzeni:
- obciążenie,
- liczba powtórzeń.

Przykład: 15 kg × 10 i 10 kg × 20 mogą jednocześnie być rekordami, jeśli żaden wynik nie jest jednocześnie cięższy i na większą liczbę powtórzeń od drugiego. 

Dla ćwiczeń typu ciężar + czas rekordami są punkty niedominowane w przestrzeni:
- obciążenie,
- czas.

Dla ćwiczeń typu masa ciała + powtórzenia rekordami są punkty niedominowane według liczby powtórzeń. Masa ciała wpisana przy serii nie wpływa na rekord. 

Dla ćwiczeń typu masa ciała + czas rekordami są punkty niedominowane według czasu. Masa ciała wpisana przy serii nie wpływa na rekord. 

Dla ćwiczeń typu dystans + czas rekordami są punkty niedominowane w przestrzeni:
- dystans,
- czas,
gdzie dalszy i dłuższy bieg mogą jednocześnie być rekordami zgodnie z przyjętą regułą biznesową użytkownika.

Jeżeli użytkownik zapisze serię, która:
- dodaje nowy punkt do frontu Pareto,
- albo dominuje wcześniej istniejący rekord,
system ma wyświetlić informację o rekordzie przy zapisie serii, analogicznie do prostego wzorca znanego z FitNotes.  [getfitnotes](https://www.getfitnotes.com/docs/records.html)

Jeśli nowa seria jest dokładnym remisem z istniejącym rekordem, aplikacja nie pokazuje specjalnej informacji. 

Po edycji lub usunięciu serii rekordy muszą zostać przeliczone historycznie od nowa dla danego ćwiczenia. 

## Rekordy globalne ćwiczeń

System ma wyznaczać dla każdego ćwiczenia także rekordy globalne, liczone na podstawie serii wszystkich użytkowników. Rekordy globalne są liczone tym samym mechanizmem co rekordy indywidualne, czyli z użyciem frontu Pareto dla danego ćwiczenia. 

Globalny rekord ćwiczenia ma prezentować:
- wartość,
- nick autora,
- datę,
- notatkę przypisaną do serii.

## Wykresy

Każde ćwiczenie ma własny ekran analityczny z prostymi, minimalistycznymi wykresami. Wykresy są prezentowane per ćwiczenie, bez rozbudowanych dashboardów przekrojowych.  [fitnotesapp](http://www.fitnotesapp.com/progress_tracking/)

W zależności od typu ćwiczenia wykresy pokazują odpowiednie metryki, takie jak:
- ciężar,
- liczba powtórzeń,
- czas,
- dystans.

Interfejs wykresów ma być prosty i nieprzeładowany. Dopuszczalne jest proste przełączanie metryk na ekranie ćwiczenia. 

## Rankingi

Aplikacja ma zawierać globalne rankingi użytkowników obejmujące wszystkich użytkowników aplikacji, przy założeniu że aplikacja jest używana przez jedną grupę znajomych. 

W MVP wymagane są co najmniej następujące rankingi:
- suma objętości ciężaru liczona jako $$kg \times powtórzenia$$,
- suma dystansu biegów,
- liczba rekordów lub inne podstawowe zestawienia osiągnięć, o ile wynikają bezpośrednio z ustalonych danych.

Ranking ma być globalny, a nie ograniczony do przedziału czasu. 

## Biblioteka ćwiczeń i filtrowanie

Użytkownik musi móc przeglądać bibliotekę ćwiczeń filtrowaną po tagach. Przykładowy przepływ: użytkownik wybiera tag “biceps”, widzi listę ćwiczeń na biceps, może wybrać istniejące ćwiczenie lub dodać nowe ćwiczenie z tego obszaru. 

Filtrowanie ma być proste i oparte tylko na tagach. Nie są wymagane dodatkowe filtry typu sprzęt, poziom trudności czy typ ruchu. 

## API

Aplikacja ma posiadać API dostępne w VPN. API służy głównie do logowania serii i podstawowej automatyzacji poza UI. 

W MVP API ma obejmować:
- autoryzację tokenem,
- CRUD serii.

API nie musi w MVP wspierać pełnej administracji cyklami, tagami i ćwiczeniami. Głównym celem jest umożliwienie zewnętrznemu narzędziu, np. botowi Discord, dodawania i odczytywania serii użytkownika. 

Każdy użytkownik może posiadać wiele tokenów API. 

## Offline i synchronizacja

Aplikacja ma działać w pełni offline i zachowywać pełną szybkość działania niezależnie od jakości połączenia. Brak internetu nie może blokować:
- logowania serii,
- przeglądania historii,
- korzystania z biblioteki ćwiczeń zapisanej lokalnie,
- dodawania nowych ćwiczeń i tagów,
- pracy z cyklami,
- odczytu wykresów,
- przeglądania kalendarza.

Lokalna baza danych jest głównym źródłem prawdy dla interfejsu, a synchronizacja z siecią ma być tylko mechanizmem uzupełniania i wymiany danych. To jest zgodne z zaleceniem, aby w architekturze offline-first lokalne źródło było canonical source of truth i jedynym źródłem odczytu dla wyższych warstw UI.  [developer.android](https://developer.android.com/topic/architecture/data-layer/offline-first)

Synchronizacja ma uruchamiać się, gdy internet jest dostępny, i działać w tle. Użytkownik może pracować dalej bez oczekiwania na zakończenie synchronizacji.  [youtube](https://www.youtube.com/watch?v=vpJIH1vSv0g)

### Status synchronizacji

Interfejs może pokazywać dyskretny status synchronizacji, na przykład:
- online,
- offline,
- synchronizacja w toku,
- oczekujące zmiany,
- błąd synchronizacji.

Szczegółowe informacje mogą być dostępne po tapnięciu ikony statusu. Brak aktualnej synchronizacji biblioteki ćwiczeń nie musi być eksponowany jako osobny komunikat o przestarzałości danych. 

### Konflikty synchronizacji

Każda seria otrzymuje globalnie unikalny identyfikator w momencie utworzenia, także bez połączenia z siecią. Dzięki temu dodanie serii na dwóch urządzeniach offline nie jest konfliktem - są to dwa odrębne zapisy, które po synchronizacji trafiają do systemu razem.

Konflikt może powstać wyłącznie wtedy, gdy ten sam zapis zostanie zmieniony niezależnie na dwóch urządzeniach.  [codememory](https://codememory.com/blog/building-offline-first-mobile-apps)

Rozstrzyganie konfliktów jest automatyczne i nie wymaga decyzji użytkownika:
- dodanie różnych serii na wielu urządzeniach - zachowywane są wszystkie serie,
- edycja tej samej serii na wielu urządzeniach - obowiązuje wersja zapisana później,
- usunięcie serii na jednym urządzeniu i edycja na drugim - obowiązuje usunięcie.

Te same zasady obowiązują dla cykli, ćwiczeń i tagów.

MVP nie zawiera widoku ręcznego rozwiązywania konfliktów. Użytkownik nigdy nie jest proszony o wybór między wersją lokalną a serwerową.

## UX i UI

Interfejs ma spełniać następujące zasady:
- ma być minimalistyczny,
- ma być bardzo szybki,
- ma być spójny,
- ma być wygodny do użycia jedną ręką na telefonie,
- ma mieć dark theme,
- ma unikać przeładowania informacjami.

Widok główny po wejściu do aplikacji to widok dodawania serii dla bieżącego dnia.  [play.google](https://play.google.com/store/apps/details?id=com.github.jamesgay.fitnotes&hl=en_US)

Najważniejsze wymagania UX:
- możliwie najmniejsza liczba kroków do zapisania serii,
- reużywanie tych samych wzorców formularzy i list w całej aplikacji,
- ten sam widok dodawania dla dnia bieżącego i historycznego,
- natychmiastowa reakcja UI na zapis lokalny,
- wygodne filtrowanie ćwiczeń po tagach,
- możliwość przejścia do szczegółu dnia z kalendarza,
- możliwość szybkiego wejścia w już dodaną serię i rozpoczęcia kolejnej.

Inspiracją dla przepływu logowania serii jest FitNotes, zwłaszcza w zakresie szybkości zapisu, prostoty formularza i pracy na kontekście dnia oraz ćwiczenia.  [play.google](https://play.google.com/store/apps/details?id=com.github.jamesgay.fitnotes&hl=en_US)

## Eksport i import

Aplikacja musi pozwalać na łatwy eksport i import danych w formacie JSON.

Eksport obejmuje serie, ćwiczenia, tagi i cykle użytkownika. Import odtwarza te dane z pliku. Ta sama ścieżka jest wykorzystywana przez systemowy mechanizm kopii zapasowych, dzięki czemu pozostaje regularnie sprawdzana w praktyce.

## Panel administracyjny

MVP zawiera prosty panel administracyjny. Panel służy do podstawowego zarządzania systemem i nie ma być rozbudowany. 

Zakres panelu administracyjnego obejmuje:
- zarządzanie użytkownikami,
- podstawowe zarządzanie bazą ćwiczeń,
- podstawowe zarządzanie tagami,
- podstawowy wgląd w dane systemowe,
- ręczne wyzwolenie przeglądu zgłoszeń zwrotnych (sprawdzenie, klasyfikacja, założenie issue na
  GitHubie albo otwarcie dyskusji na Discordzie) — ten sam przebieg, który dzieje się codziennie
  automatycznie.

Nie są wymagane rozbudowane workflow moderacyjne ani zaawansowane narzędzia analityczne dla administratora. 

## Prywatność i widoczność danych

Serie użytkownika są prywatne. Inni użytkownicy nie mają dostępu do pełnej historii serii danego użytkownika. 

Publicznie widoczne są:
- ćwiczenia,
- globalne rekordy ćwiczeń,
- dane rankingowe użytkowników wynikające z agregacji.

W przypadku globalnych rekordów widoczne są wartość, nick, data i notatka serii. 

## Reguły biznesowe

Najważniejsze reguły biznesowe:
- konto jest obowiązkowe,
- każdy użytkownik ma jeden profil,
- każde ćwiczenie ma dokładnie jeden główny tag,
- główny tag decyduje o zaliczaniu serii do cykli tagowych,
- jedna seria może zaliczać się do wielu cykli jednocześnie,
- typ logowania ćwiczenia po utworzeniu jest niezmienny,
- usunięcie lub edycja serii przelicza rekordy, cykle, wykresy i rankingi,
- dodanie serii historycznej działa tak samo jak dodanie serii bieżącej,
- ćwiczenie może edytować tylko jego autor lub administrator,
- konflikty synchronizacji rozstrzygane są automatycznie, bez udziału użytkownika,
- usunięcie tagu używanego przez ćwiczenia jest zabronione,
- usunięcie encji nie może naruszać spójności danych.

## Wymagania niefunkcjonalne

Aplikacja musi:
- działać szybko lokalnie także bez internetu,
- nie blokować interfejsu na operacjach sieciowych,
- zachowywać spójność interfejsu między ekranami,
- działać poprawnie w dark theme,
- być wygodna na telefonie,
- wspierać pełną pracę w warunkach słabego lub zerowego internetu,
- synchronizować dane po odzyskaniu połączenia,
- zachowywać dane lokalnie jako podstawę działania UI.  [developer.android](https://developer.android.com/topic/architecture/data-layer/offline-first)

## Kryteria akceptacyjne

Przykładowe kryteria akceptacyjne dla MVP:
- użytkownik może zalogować się przez Google lub e-mail + hasło,
- użytkownik może dodać ćwiczenie z jednym głównym tagiem i wieloma dodatkowymi tagami,
- użytkownik może dodać serię w mniej niż kilku prostych krokach z poziomu dnia,
- użytkownik może dodać serię dla dowolnej daty z kalendarza,
- aplikacja działa bez internetu i pozwala zapisywać serie, ćwiczenia, tagi oraz odczytywać historię,
- po powrocie internetu dane synchronizują się bez blokowania pracy,
- równoległa praca na dwóch urządzeniach offline nie powoduje po synchronizacji ani utraty serii, ani duplikatów,
- cykl poprawnie zlicza serie, czas lub dystans zgodnie z definicją celu,
- po usunięciu serii postęp cyklu zmniejsza się odpowiednio,
- po dodaniu serii rekordowej użytkownik dostaje informację o rekordzie,
- wykres ćwiczenia pokazuje historię odpowiednich metryk,
- kalendarz pokazuje liczbę serii dla każdego dnia,
- ranking pokazuje globalną sumę $$kg \times powtórzenia$$ i dystansu,
- API z tokenem pozwala wykonać CRUD serii,
- panel admina pozwala zarządzać użytkownikami oraz bazą ćwiczeń i tagów.

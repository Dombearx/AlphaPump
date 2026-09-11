/*
 * Telefonowa połowa aplikacji na Pebble.
 *
 * Kod chodzi w piaskowce PebbleKit JS **wewnątrz aplikacji Pebble na telefonie**,
 * bo zegarek nie ma własnej sieci. Stąd wychodzą wszystkie żądania do API
 * AlphaPump i tutaj mieszka wszystko, czego zegarek nie musi wiedzieć: adres,
 * token, format dat i to, że rozpoznanie serii to dwa osobne wywołania.
 *
 * ## Dlaczego dwa wywołania, a nie jedno „zapisz to, co usłyszałeś"
 *
 * Bo obydwa już istnieją i żadne nie powstało dla zegarka. `POST /voice/text`
 * zamienia zdanie w serię (to samo wejście, z którego korzysta pole tekstowe
 * w aplikacji), a `POST /sets` zapisuje serię tokenem API (to samo wejście, dla
 * którego powstały tokeny — „dla bota Discord"). Endpoint łączący jedno z drugim
 * byłby trzecią drogą do rzeczy, która ma dwie działające.
 *
 * Rozpoznawanie **nie zapisuje** samo z siebie i to jest ta sama reguła, co
 * w aplikacji na telefonie: seria dopisana do nie tego ćwiczenia psuje rekord
 * i wykres, a widać to tygodnie później. Zegarek daje na to jedno naciśnięcie
 * potwierdzenia — a kto uzna je za zbędne, wyłącza je w ustawieniach.
 *
 * Napisane w ES5 (`var`, żadnych strzałek i szablonów) świadomie, i to jest
 * wymóg **dwóch** rzeczy naraz, a nie ostrożność: piaskowka PKJS bywa starsza
 * niż przeglądarka na tym samym telefonie, a pakowarka SDK (webpack 1
 * z acornem w trybie ES5) odmawia zbudowania czegokolwiek nowszego. Transpilacji
 * po drodze nie ma żadnej.
 *
 * Łatwo to złamać nie pisząc ani linijki: **przecinek na końcu listy argumentów**
 * jest ES2017, a dokłada go Prettier. Dlatego `.prettierrc.json` ma dla tego
 * katalogu nadpisanie `trailingComma: "es5"` — bez niego formatowanie psuje
 * budowanie, a komunikat („Unexpected token") wskazuje nawias zamykający,
 * czyli nie to miejsce, w którym jest problem.
 */

var configPage = require('./config-page');

/** Te same wartości czyta `src/c/main.c`. */
var STATUS = {
  SETUP: 0,
  READY: 1,
  WORKING: 2,
  CONFIRM: 3,
  SAVED: 4,
  UNKNOWN: 5,
  ERROR: 6,
  /** Błąd, który minie sam — zegarek pokazuje przy nim ponowienie. */
  RETRY: 7,
};

var COMMAND = { SAVE: 1, DISCARD: 2, CHECK: 3, RETRY: 4 };

var SETTINGS_KEY = 'alphapump-settings';

/**
 * Ćwiczenia z biblioteki, po identyfikatorze: nazwa i tag główny.
 *
 * `GET /sets` oddaje same identyfikatory, a `GET /exercises` nie umie filtrować
 * po nich — więc biblioteka jedzie w całości i zostaje tutaj. Dociągamy ją
 * dopiero wtedy, gdy wśród potrzebnych ćwiczeń jest takie, którego nie znamy:
 * ekran spoczynku pokazuje się przy każdym otwarciu aplikacji i całej biblioteki
 * co otwarcie nikt nie potrzebuje. Kosztem jest nazwa zmieniona w bibliotece,
 * która na zegarku zostaje stara — do pierwszego ćwiczenia spoza pamięci.
 *
 * Tag główny leży tu razem z nazwą, bo to on rozstrzyga cele tagowe cyklu —
 * dokładnie tak samo jak w rdzeniu, gdzie tagi dodatkowe serii nie zaliczają.
 */
var NAMES_KEY = 'alphapump-exercise-names';

/** Nazwy tagów, po identyfikatorze — pod te same cele tagowe, tą samą drogą. */
var TAGS_KEY = 'alphapump-tag-names';

/** Ile wierszy mieści się na ekranie zegarka bez przewijania. */
var BODY_LINES = 3;

/** Tyle samo znaków bierze `s_body` w `src/c/main.c`; reszta jest ucinana. */
var BODY_CHARS = 128;

/**
 * Ile ćwiczeń pokazać przy celu tagowym. Cel wskazujący tag nie mówi, czym ten
 * tag zrobić — więc mówi to za niego kilka ćwiczeń, które w tym cyklu padały
 * najczęściej.
 */
var TAG_EXAMPLES = 2;

/**
 * Ile bajtów treści przyjmie zegarek — tyle, ile ma `MAX_BODY` w `src/c/main.c`,
 * bez miejsca na kończące zero. Liczą się **bajty**, a nie znaki: komunikaty
 * serwera są po polsku, a każde „ż" zajmuje w UTF-8 dwa.
 *
 * Przycięcie jest tu ostatnią deską ratunku dla treści, które nie mają końca
 * (strona błędu z proxy potrafi mieć kilobajty) — wiadomość większa niż skrzynka
 * zegarka nie doszłaby wcale, a wtedy zamiast długiego błędu widać byłoby jego
 * brak.
 */
var MAX_BODY_BYTES = 511;

/**
 * Limit czasu jednego żądania. Krótszy niż limit zegarka (40 s), żeby to **my**
 * powiedzieli, co się stało — komunikat „serwer nie odpowiada" jest wart więcej
 * niż cisza, po której zegarek sam się poddaje.
 */
var TIMEOUT_MS = 30000;

/** Seria rozpoznana i czekająca na potwierdzenie z zegarka. */
var pending = null;

/**
 * Ostatnia wysyłka, która nie udała się nie z winy użytkownika — gotowa do
 * powtórzenia jednym naciśnięciem. Trzymamy samą operację (domknięcie), a nie
 * jej dane, bo powtórzeniem rozpoznania jest to samo zdanie, a powtórzeniem
 * zapisu — ta sama seria; jedno i drugie leży już w domknięciu, które je
 * wywołało.
 */
var retry = null;

/* --------------------------------------------------------------- ustawienia */

function readSettings() {
  var raw = localStorage.getItem(SETTINGS_KEY);
  var stored = {};

  if (raw) {
    try {
      stored = JSON.parse(raw) || {};
    } catch (_error) {
      stored = {};
    }
  }

  return {
    apiUrl: typeof stored.apiUrl === 'string' ? stored.apiUrl : '',
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
    // Potwierdzanie jest domyślnie **włączone**: pomyłka w tę stronę kosztuje
    // jedno naciśnięcie, a w drugą — serię, o którą nikt nie prosił.
    confirm: stored.confirm !== false,
  };
}

function writeSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function configured(settings) {
  return settings.apiUrl.length > 0 && settings.apiKey.length > 0;
}

/** Pamięć podręczna spod podanego klucza; zepsuty wpis jest pustą pamięcią. */
function readCache(key) {
  var raw = localStorage.getItem(key);
  if (!raw) return {};

  try {
    return JSON.parse(raw) || {};
  } catch (_error) {
    return {};
  }
}

/* ------------------------------------------------------------------ zegarek */

/**
 * Licznik wysłanych ekranów. Po nim poznajemy, że odpowiedź, na którą czekamy,
 * dotyczy ekranu, którego już nie ma — patrz `replyIdle`.
 */
var screens = 0;

/** Ile bajtów zajmie znak w UTF-8. Pary zastępcze liczą się z zapasem. */
function charBytes(code) {
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  return 3;
}

/**
 * Treść skrojona do skrzynki zegarka — w jednym przebiegu, bo po drugiej stronie
 * bywa cała strona HTML od proxy.
 */
function fit(text) {
  var total = 0;

  for (var i = 0; i < text.length; i++) {
    total += charBytes(text.charCodeAt(i));
    // Trzy bajty zostawiamy na wielokropek, który mówi, że to jeszcze nie koniec.
    if (total > MAX_BODY_BYTES - 3) return text.slice(0, i) + '…';
  }

  return text;
}

function reply(status, title, body) {
  screens += 1;
  Pebble.sendAppMessage({ STATUS: status, TITLE: title, BODY: body ? fit(body) : '' });
}

/**
 * Stan spoczynku zależy od tego, czy jest dokąd wysyłać.
 *
 * Gotowość idzie **od razu**, a podsumowanie dochodzi drugą wiadomością, kiedy
 * przyjdzie: dyktowanie ma być dokładnie tak samo szybkie jak przedtem, więc
 * nic w tym przepływie nie czeka na listę — a jak nie przyjdzie, zostaje ekran
 * sprzed tej zmiany.
 */
function replyIdle() {
  // Powrót do spoczynku znaczy, że nie ma już czego powtarzać: ekran
  // z ponowieniem zniknął, a stare domknięcie czekałoby tylko na przypadek.
  retry = null;

  var settings = readSettings();
  if (!configured(settings)) {
    reply(STATUS.SETUP, 'Set me up', 'Open the app settings in the Pebble phone app.');
    return;
  }

  reply(STATUS.READY, 'Ready', 'Hold the watch close and say the exercise with the numbers.');
  var shown = screens;

  idleSummary(function (title, body) {
    // Ekran zdążył się zmienić — użytkownik już dyktuje albo potwierdza serię,
    // a spóźniona lista nie ma prawa zabrać mu tego, co widzi.
    if (title === null || screens !== shown) return;
    reply(STATUS.READY, title, body);
  });
}

/* ------------------------------------------------------------------ format */

/** Gramy na kilogramy, bez zer na końcu: 82500 → „82.5". */
function kilograms(grams) {
  var value = grams / 1000;
  return (Math.round(value * 100) / 100).toString();
}

/** Sekundy na `m:ss`, bo „90 s" czyta się gorzej niż „1:30". */
function duration(seconds) {
  var minutes = Math.floor(seconds / 60);
  var rest = seconds % 60;
  return minutes + ':' + (rest < 10 ? '0' : '') + rest;
}

/**
 * Seria jednym zdaniem na ekran zegarka.
 *
 * Jest to druga — po `formatSet` w aplikacji — implementacja tego samego
 * formatu i wiemy o tym. Sprowadzenie ich do jednej znaczyłoby wciągnięcie
 * `@alphapump/core` do paczki, która nie ma bundlera i chodzi w cudzej
 * piaskowce; a rozjazd kosztuje tu wyłącznie to, że napis na zegarku wygląda
 * inaczej niż ten sam napis na telefonie.
 */
function describe(match) {
  var parts = [];

  if (match.weightG !== null) parts.push(kilograms(match.weightG) + ' kg');
  // Powtórzenia po ciężarze czyta się jako mnożenie („80 kg x 8"), a same —
  // jako liczbę, która bez jednostki nic nie znaczy.
  if (match.reps !== null) parts.push(parts.length > 0 ? 'x ' + match.reps : match.reps + ' reps');
  if (match.distanceM !== null) parts.push(match.distanceM + ' m');
  if (match.durationS !== null) parts.push(duration(match.durationS));

  return match.name + ': ' + parts.join(' ');
}

/**
 * Które pomiary wymaga dany typ logowania — trzecia implementacja tej samej
 * reguły, co `requiredMeasurements` w `@alphapump/core` i `RECORD_AXES` w API.
 * Ten sam powód co przy `describe`: pakiet bez bundlera w cudzej piaskowce nie
 * dociągnie zależności, więc tabelka zostaje duplikatem, a nie importem.
 */
var REQUIRED_MEASUREMENTS = {
  weight_reps: ['weightG', 'reps'],
  weight_time: ['weightG', 'durationS'],
  bodyweight_reps: ['reps'],
  bodyweight_time: ['durationS'],
  distance_time: ['distanceM', 'durationS'],
};

var MEASUREMENT_LABELS = {
  weightG: 'weight',
  reps: 'reps',
  durationS: 'time',
  distanceM: 'distance',
};

/**
 * Nazwy pomiarów, których modelowi zabrakło — po to, żeby „Missing numbers"
 * mówiło **co** dopowiedzieć, a nie tylko, że czegoś brakuje. Bez tego seria
 * z samymi powtórzeniami przy ćwiczeniu na ciężar wygląda dla użytkownika jak
 * kompletna, bo `describe` pomija pola o wartości `null` bez śladu.
 */
function missingMeasurements(match) {
  var required = REQUIRED_MEASUREMENTS[match.loggingType] || [];
  var names = [];

  for (var i = 0; i < required.length; i++) {
    if (match[required[i]] === null) names.push(MEASUREMENT_LABELS[required[i]]);
  }

  return names.join(' and ');
}

/** Dzień kalendarzowy jako `RRRR-MM-DD` — porównywalny zwykłym `<`. */
function isoDay(year, month, day) {
  return year + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
}

/** Dzień kalendarzowy telefonu — seria należy do dnia, nie do chwili. */
function today() {
  var now = new Date();
  return isoDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Dzień przesunięty o tyle dni. Liczone w UTC, bo dzień treningowy jest bez
 * strefy — inaczej zmiana czasu przesuwałaby granicę okresu cyklu o dobę.
 */
function addDays(day, count) {
  var parts = day.split('-');
  var shifted = new Date(
    Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + count)
  );
  return isoDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Ile dni dzieli dwa dni kalendarzowe; ujemnie, gdy drugi jest wcześniejszy. */
function daysBetween(from, to) {
  var a = from.split('-');
  var b = to.split('-');
  var start = Date.UTC(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
  var end = Date.UTC(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
  return Math.round((end - start) / 86400000);
}

/** Tytuł ekranu spoczynku: ile serii dziś już jest. */
function headline(count) {
  return 'Today: ' + count + (count === 1 ? ' set' : ' sets');
}

/**
 * Nazwa ćwiczenia z pamięci podręcznej. Ćwiczenia spoza niej nie da się nazwać,
 * ale liczby z serii są wtedy wciąż warte pokazania.
 */
function nameOf(names, exerciseId) {
  var known = names[exerciseId];
  return known && known.name ? known.name : 'Exercise';
}

/**
 * Kilka ostatnich serii dnia, od najnowszej, po jednej w wierszu.
 *
 * Kolejnością jest `createdAt`, a nie `position` z odpowiedzi: pozycja numeruje
 * serie **w obrębie jednego ćwiczenia**, więc posortowana po niej lista miesza
 * przysiady z wyciskaniem i „ostatnia" nie jest tą ostatnio zrobioną.
 *
 * Wierszy jest tyle, ile mieści ekran zegarka — przewijania tu nie ma, bo
 * ekran spoczynku ma się czytać jednym rzutem oka, a nie być dziennikiem.
 * Ile serii jest naprawdę, mówi tytuł.
 */
function latest(sets, names) {
  var sorted = sets.slice().sort(function (a, b) {
    if (a.createdAt === b.createdAt) return 0;
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  var lines = [];
  for (var i = 0; i < sorted.length && i < BODY_LINES; i++) {
    lines.push(
      describe({
        name: nameOf(names, sorted[i].exerciseId),
        weightG: sorted[i].weightG,
        reps: sorted[i].reps,
        distanceM: sorted[i].distanceM,
        durationS: sorted[i].durationS,
      })
    );
  }

  return lines.join('\n');
}

/* -------------------------------------------------------------------- cykl */

/*
 * Co zostało do zrobienia w bieżącym cyklu.
 *
 * Jest to czwarta implementacja reguł z `cycles.ts` w rdzeniu — po telefonie,
 * serwerze i panelu — i ten sam powód, co przy `describe`: paczka bez bundlera,
 * chodząca w cudzej piaskowce, nie dociągnie `@alphapump/core`. Liczymy tu więc
 * dokładnie tyle, ile ekran pokazuje: ile zostało do celu i czym ten cel bywa
 * robiony. Rozjazd kosztuje napis na zegarku, a nie zapisaną serię — postępu
 * nigdzie nie zapisujemy.
 */

/**
 * Bieżący okres cyklu — to samo, co `currentCyclePeriod` w rdzeniu. Cykl
 * o stałej długości liczy się sam: gdy minie jego koniec, kolejny okres tej
 * samej długości zaczyna się bez żadnego resetu, a zapisany początek zostaje
 * kotwicą. Cykl bez daty końca nie ma czego przewijać.
 */
function currentPeriod(cycle, day) {
  if (cycle.endsOn === null || day <= cycle.endsOn) {
    return { startsOn: cycle.startsOn, endsOn: cycle.endsOn };
  }

  var length = daysBetween(cycle.startsOn, cycle.endsOn) + 1;
  var elapsed = Math.floor(daysBetween(cycle.startsOn, day) / length);
  var startsOn = addDays(cycle.startsOn, elapsed * length);
  return { startsOn: startsOn, endsOn: addDays(startsOn, length - 1) };
}

/**
 * Cykle obejmujące dany dzień, każdy ze swoim bieżącym okresem. Cykl jeszcze
 * nierozpoczęty odpada — nie ma czego przewijać do przodu — a cykl bez pozycji
 * celu nie ma czego zliczać. Zarchiwizowanych `GET /cycles` nie oddaje.
 */
function activePeriods(cycles, day) {
  var active = [];

  for (var i = 0; i < cycles.length; i++) {
    var cycle = cycles[i];
    if (!cycle.goals || cycle.goals.length === 0) continue;

    var period = currentPeriod(cycle, day);
    if (day < period.startsOn) continue;
    active.push({ cycle: cycle, period: period });
  }

  return active;
}

/** Zakres dat jednym żądaniem o serie — od najwcześniejszego okresu po dziś. */
function setsRange(active, day) {
  var from = day;
  var to = day;

  for (var i = 0; i < active.length; i++) {
    var period = active[i].period;
    if (period.startsOn < from) from = period.startsOn;
    if (period.endsOn !== null && period.endsOn > to) to = period.endsOn;
  }

  return { from: from, to: to };
}

function withinPeriod(period, set) {
  if (set.performedOn < period.startsOn) return false;
  return period.endsOn === null || set.performedOn <= period.endsOn;
}

/**
 * Ile dana seria wnosi do pozycji celu; zero znaczy „nie zalicza się".
 *
 * W celach tagowych liczy się wyłącznie **tag główny** ćwiczenia — tagi
 * dodatkowe są etykietami biblioteki i serii nie zaliczają.
 */
function contribution(period, goal, set, names) {
  if (!withinPeriod(period, set)) return 0;

  if (goal.exerciseId !== null) {
    if (goal.exerciseId !== set.exerciseId) return 0;
  } else {
    var exercise = names[set.exerciseId];
    if (!exercise || exercise.tagId !== goal.tagId) return 0;
  }

  if (goal.metric === 'duration') return set.durationS || 0;
  if (goal.metric === 'distance') return set.distanceM || 0;
  return 1;
}

/**
 * Ćwiczenia, którymi ten tag bywał robiony w tym okresie — od najczęstszego.
 *
 * Cel tagowy nie wskazuje ćwiczenia, więc sam napis „klatka: 2 serie" nie mówi,
 * co właściwie podyktować. Podpowiedź bierze się z własnych serii użytkownika
 * z bieżącego cyklu, a nie z biblioteki: ćwiczenie, które ktoś w tym cyklu robi,
 * jest lepszą propozycją niż pierwsze alfabetycznie w tagu.
 */
function tagExamples(tagId, period, sets, names) {
  var counted = {};

  for (var i = 0; i < sets.length; i++) {
    var set = sets[i];
    if (!withinPeriod(period, set)) continue;

    var exercise = names[set.exerciseId];
    if (!exercise || exercise.tagId !== tagId) continue;
    counted[set.exerciseId] = (counted[set.exerciseId] || 0) + 1;
  }

  var ids = Object.keys(counted);
  ids.sort(function (a, b) {
    if (counted[a] !== counted[b]) return counted[b] - counted[a];
    return nameOf(names, a) < nameOf(names, b) ? -1 : 1;
  });

  var picked = [];
  for (var j = 0; j < ids.length && j < TAG_EXAMPLES; j++) picked.push(nameOf(names, ids[j]));
  return picked;
}

/**
 * Pozycje celu, w których coś jeszcze zostało — od najbliższej ukończenia.
 *
 * Kolejność jest ta sama, co w `remainingTargets` na telefonie: najpierw to, co
 * zostało dokończyć, bo z trzech wierszy na ekranie najwięcej warta jest pozycja,
 * którą da się domknąć jedną serią.
 */
function remainingWork(active, sets, names, tagNames) {
  var work = [];

  for (var i = 0; i < active.length; i++) {
    var goals = active[i].cycle.goals;
    var period = active[i].period;

    for (var g = 0; g < goals.length; g++) {
      var goal = goals[g];
      var current = 0;
      for (var s = 0; s < sets.length; s++) current += contribution(period, goal, sets[s], names);
      if (current >= goal.target) continue;

      work.push({
        label:
          goal.exerciseId !== null
            ? nameOf(names, goal.exerciseId)
            : tagNames[goal.tagId] || 'Goal',
        metric: goal.metric,
        remaining: goal.target - current,
        examples: goal.exerciseId !== null ? [] : tagExamples(goal.tagId, period, sets, names),
      });
    }
  }

  return work.sort(function (a, b) {
    if (a.remaining !== b.remaining) return a.remaining - b.remaining;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
}

/** Ile zostało, w jednostce metryki: „3 sets", „12:00", „800 m". */
function amountLeft(metric, value) {
  if (metric === 'duration') return duration(value);
  if (metric === 'distance') return value + ' m';
  return value + (value === 1 ? ' set' : ' sets');
}

/** Tytuł ekranu spoczynku, gdy w cyklu coś jeszcze zostało. */
function cycleHeadline(count) {
  return 'Cycle: ' + count + ' to do';
}

/**
 * Pozostałe pozycje, po jednej w wierszu. Wierszy jest tyle, ile mieści ekran,
 * a wiersz, który by się na nim nie zmieścił w całości, nie wchodzi wcale —
 * zegarek ucina treść w pół słowa i pół pozycji celu nie mówi nic.
 */
function cycleLines(work) {
  var lines = [];
  var used = 0;

  for (var i = 0; i < work.length && i < BODY_LINES; i++) {
    var line = work[i].label + ': ' + amountLeft(work[i].metric, work[i].remaining);
    if (work[i].examples.length > 0) line += ' (' + work[i].examples.join(', ') + ')';
    if (lines.length > 0 && used + line.length > BODY_CHARS) break;

    lines.push(line);
    used += line.length + 1;
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------- sieć */

/**
 * Nieudana odpowiedź serwera, słowo w słowo.
 *
 * Na zegarku stoi **cała** treść błędu — kod stanu, stabilny kod błędu, zdanie
 * od serwera i szczegóły, jeśli je dołożył. Aplikacji używają sami piszący ten
 * serwer, więc komunikat techniczny jest tu wart więcej niż uproszczony: samo
 * „The server answered 500." mówiło tylko tyle, że coś padło, choć odpowiedź
 * wiedziała, co dokładnie.
 *
 * Gdy odpowiedź nie jest naszym błędem — nie da się jej przeczytać jako JSON,
 * bo to strona od proxy albo pusta treść — zostaje kod stanu i surowe ciało.
 * Też mówi więcej niż nic: po nim widać, że odpowiedział ktoś inny niż API.
 */
function serverProblem(status, body, raw) {
  var error = body && body.error;
  var problem = 'HTTP ' + status;

  if (error && typeof error.code === 'string') problem += ' ' + error.code;

  if (error && typeof error.message === 'string' && error.message.length > 0) {
    problem += ': ' + error.message;
  } else if (body === null && typeof raw === 'string' && raw.length > 0) {
    problem += ': ' + raw;
  }

  // Szczegóły niosą to, czego nie da się powiedzieć zdaniem — np. które pole
  // odrzuciła walidacja.
  if (error && error.details !== undefined) problem += ' ' + JSON.stringify(error.details);

  return problem;
}

/**
 * Jedno żądanie do API.
 *
 * `done(problem, body, retryable)` — `problem` jest gotową treścią dla
 * użytkownika albo `null`. Tłumaczenie kodów na zdania jest tutaj, a nie
 * w wołających, bo to samo 401 znaczy wszędzie to samo: token do wymiany.
 *
 * `retryable` mówi, czy powtórzenie **tego samego** żądania ma szansę się udać:
 * cisza w sieci, przekroczony czas i awaria serwera (5xx) mijają same, więc
 * warto spróbować jeszcze raz. Reszta nie mija — zła liczba w zdaniu, martwy
 * token, wyłączone dyktowanie i zły adres oddadzą przy powtórzeniu dokładnie to
 * samo, a przycisk obiecywałby wtedy coś, czego nie ma.
 */
function request(method, path, payload, done) {
  var settings = readSettings();
  var xhr = new XMLHttpRequest();

  xhr.open(method, settings.apiUrl + path, true);
  xhr.timeout = TIMEOUT_MS;
  // Token tylko wtedy, gdy jest: `GET /health` stoi przed uwierzytelnieniem
  // i ma odpowiadać także z pustą konfiguracją — to jego jedyne zadanie.
  if (settings.apiKey.length > 0) xhr.setRequestHeader('x-api-key', settings.apiKey);
  if (payload) xhr.setRequestHeader('Content-Type', 'application/json');

  xhr.onload = function () {
    var body = null;
    try {
      body = JSON.parse(xhr.responseText);
    } catch (_error) {
      body = null;
    }

    if (xhr.status >= 200 && xhr.status < 300) {
      done(null, body, false);
      return;
    }

    var problem = serverProblem(xhr.status, body, xhr.responseText);

    // Do pełnej treści dochodzi zdanie o tym, co z nią zrobić — bo dwa kody
    // stanu znaczą tu coś, czego z nich samych nie widać.
    if (xhr.status === 401 || xhr.status === 403) {
      done(
        problem + ' — the API token was rejected, make a new one in the phone app.',
        null,
        false
      );
      return;
    }
    // 503 jest tu decyzją administratora („dyktowanie wyłączone"), a nie awarią,
    // która minie — dlatego jedyne 5xx bez ponowienia.
    if (xhr.status === 503) {
      done(problem + ' — dictation is switched off on the server.', null, false);
      return;
    }

    done(problem, null, xhr.status >= 500);
  };

  xhr.ontimeout = function () {
    done('The server took too long to answer.', null, true);
  };

  xhr.onerror = function () {
    done('No answer from the server — is the phone on the VPN?', null, true);
  };

  xhr.send(payload ? JSON.stringify(payload) : null);
}

/* ---------------------------------------------------------------- przepływ */

/**
 * Ćwiczenia o podanych identyfikatorach — nazwa i tag główny.
 *
 * Biblioteka dociąga się wyłącznie wtedy, gdy wśród nich jest identyfikator,
 * którego pamięć podręczna nie zna — czyli raz na nowe ćwiczenie, a nie raz na
 * otwarcie aplikacji. Gdy dociągnięcie się nie uda, oddajemy to, co mamy:
 * seria bez nazwy jest gorsza niż z nazwą, ale lepsza niż pusty ekran.
 */
function withNames(exerciseIds, done) {
  var names = readCache(NAMES_KEY);

  // Wpis bez nazwy to także wpis w starym kształcie — pamięć podręczna trzymała
  // kiedyś samą nazwę, bez tagu głównego. Wtedy biblioteka jedzie raz jeszcze
  // i przepisuje ją całą, zamiast zostawiać ekran cyklu bez tagów do końca życia
  // instalacji.
  var known = true;
  for (var i = 0; i < exerciseIds.length; i++) {
    var cached = names[exerciseIds[i]];
    if (!cached || !cached.name) known = false;
  }
  if (known) {
    done(names);
    return;
  }

  request('GET', '/exercises', null, function (problem, body) {
    if (problem || !body || !body.length) {
      done(names);
      return;
    }

    var fresh = {};
    for (var j = 0; j < body.length; j++) {
      fresh[body[j].id] = { name: body[j].name, tagId: body[j].primaryTagId };
    }
    localStorage.setItem(NAMES_KEY, JSON.stringify(fresh));
    done(fresh);
  });
}

/** Nazwy tagów — tą samą drogą i z tego samego powodu, co nazwy ćwiczeń. */
function withTagNames(tagIds, done) {
  var tagNames = readCache(TAGS_KEY);

  var known = true;
  for (var i = 0; i < tagIds.length; i++) {
    if (!tagNames[tagIds[i]]) known = false;
  }
  if (known) {
    done(tagNames);
    return;
  }

  request('GET', '/tags', null, function (problem, body) {
    if (problem || !body || !body.length) {
      done(tagNames);
      return;
    }

    var fresh = {};
    for (var j = 0; j < body.length; j++) fresh[body[j].id] = body[j].name;
    localStorage.setItem(TAGS_KEY, JSON.stringify(fresh));
    done(fresh);
  });
}

function setExercises(sets) {
  var ids = [];
  for (var i = 0; i < sets.length; i++) ids.push(sets[i].exerciseId);
  return ids;
}

/** Ćwiczenia, których ekran potrzebuje nazwać albo dopasować do celu tagowego. */
function neededExercises(active, sets) {
  var ids = setExercises(sets);

  for (var c = 0; c < active.length; c++) {
    var goals = active[c].cycle.goals;
    for (var g = 0; g < goals.length; g++) {
      if (goals[g].exerciseId !== null) ids.push(goals[g].exerciseId);
    }
  }

  return ids;
}

/** Tagi wskazane przez cele — tylko one potrzebują nazwy. */
function goalTags(active) {
  var ids = [];

  for (var c = 0; c < active.length; c++) {
    var goals = active[c].cycle.goals;
    for (var g = 0; g < goals.length; g++) {
      if (goals[g].tagId !== null) ids.push(goals[g].tagId);
    }
  }

  return ids;
}

function setsOn(sets, day) {
  var kept = [];
  for (var i = 0; i < sets.length; i++) {
    if (sets[i].performedOn === day) kept.push(sets[i]);
  }
  return kept;
}

/**
 * Dzisiejsze serie — te same, które widać w aplikacji na telefonie, a nie tylko
 * podyktowane z zegarka: dzień treningowy jest jeden, niezależnie od tego,
 * którym urządzeniem został zapisany.
 */
function todaysSummary(day, done) {
  request('GET', '/sets?from=' + day + '&to=' + day, null, function (problem, body) {
    if (problem || !body || !body.length) {
      done(null, null);
      return;
    }
    withNames(setExercises(body), function (names) {
      done(headline(body.length), latest(body, names));
    });
  });
}

/**
 * Co postawić pod gotowością na ekranie głównym.
 *
 * Najpierw **to, co w bieżącym cyklu jeszcze zostało**: ekran ma odpowiadać na
 * pytanie „co teraz zrobić", a lista zrobionego odpowiada tylko na „co już
 * zrobiłem". Gdy cyklu nie ma albo jest domknięty w całości, zostają dzisiejsze
 * serie — czyli dokładnie to, co ekran pokazywał przedtem.
 *
 * O serie pytamy raz, zakresem obejmującym wszystkie bieżące okresy: dzisiejsze
 * serie są w nim zawarte, więc wariant zapasowy nie kosztuje drugiego żądania.
 *
 * `done(null)` znaczy „nie ma czego pokazać" — pusty dzień, pusty cykl albo
 * nieudane żądanie. Każde z nich zostawia ekran spoczynku takim, jaki był, bo
 * lista jest tu dodatkiem, a nie warunkiem dyktowania.
 */
function idleSummary(done) {
  var day = today();

  request('GET', '/cycles', null, function (problem, cycles) {
    var active = problem || !cycles || !cycles.length ? [] : activePeriods(cycles, day);
    if (active.length === 0) {
      todaysSummary(day, done);
      return;
    }

    var range = setsRange(active, day);
    var path = '/sets?from=' + range.from + '&to=' + range.to;

    request('GET', path, null, function (setsProblem, sets) {
      if (setsProblem || !sets) {
        done(null, null);
        return;
      }

      withNames(neededExercises(active, sets), function (names) {
        withTagNames(goalTags(active), function (tagNames) {
          var work = remainingWork(active, sets, names, tagNames);
          if (work.length > 0) {
            done(cycleHeadline(work.length), cycleLines(work));
            return;
          }

          var todays = setsOn(sets, day);
          if (todays.length === 0) {
            done(null, null);
            return;
          }
          done(headline(todays.length), latest(todays, names));
        });
      });
    });
  });
}

/**
 * Nieudana wysyłka na ekranie zegarka.
 *
 * Gdy zawiódł serwer albo sieć, zapamiętujemy samą operację i zegarek dostaje
 * ekran z ponowieniem: powtórzenie za chwilę ma szansę przejść, a bez niego
 * trzeba było dyktować serię od nowa, chociaż nikt nie pomylił się w zdaniu.
 * Przy błędzie, który powtórzenie oddałoby słowo w słowo, zostaje zwykły ekran
 * błędu — obiecany, a nic nie zmieniający przycisk jest gorszy niż jego brak.
 *
 * Co dokładnie robi ponowienie, mówi hasło pod ekranem („SELECT retry"), więc
 * treść zostaje sama nieskrócona — na zegarku jest jej na tyle mało, że każde
 * zdanie zabiera miejsce temu, co się naprawdę zepsuło.
 */
function failed(title, problem, retryable, again) {
  if (!retryable) {
    retry = null;
    reply(STATUS.ERROR, title, problem);
    return;
  }

  retry = again;
  reply(STATUS.RETRY, title, problem);
}

function save(match) {
  reply(STATUS.WORKING, 'Saving…', describe(match));

  request(
    'POST',
    '/sets',
    {
      exerciseId: match.exerciseId,
      performedOn: today(),
      // Pomiary jadą tak, jak przyszły: rdzeń wyciął już te, których ten typ
      // logowania nie ma, a `POST /sets` odrzuca każdy nadmiarowy.
      weightG: match.weightG,
      reps: match.reps,
      durationS: match.durationS,
      distanceM: match.distanceM,
      bodyweightG: match.bodyweightG,
      note: match.note,
    },
    function (problem, _body, retryable) {
      pending = null;
      if (problem) {
        // Serię trzyma domknięcie ponowienia, więc nieudany zapis nie kosztuje
        // już podyktowania jej od nowa.
        failed('Not saved', problem, retryable, function () {
          save(match);
        });
        return;
      }
      reply(STATUS.SAVED, 'Saved', describe(match));
    }
  );
}

function recognise(text) {
  var settings = readSettings();
  if (!configured(settings)) {
    reply(STATUS.SETUP, 'Set me up', 'Open the app settings in the Pebble phone app.');
    return;
  }

  pending = null;
  retry = null;
  reply(STATUS.WORKING, 'Recognising…', text);

  // Dzień jedzie razem ze zdaniem, a nie dopiero przy zapisie: po nim serwer
  // poznaje, czy sama liczba powtórzeń („osiem") należy jeszcze do tego samego
  // treningu, co poprzednia seria — i tylko wtedy dopisuje do niej ćwiczenie
  // i ciężar. Jest to ten sam dzień, który za chwilę pojedzie w `POST /sets`.
  var heard = { text: text, performedOn: today() };

  request('POST', '/voice/text', heard, function (problem, body, retryable) {
    if (problem) {
      // Zdanie jest już podyktowane i nic mu nie brakuje — powtarzamy samo
      // żądanie, zamiast odsyłać użytkownika do mikrofonu.
      failed('No answer', problem, retryable, function () {
        recognise(text);
      });
      return;
    }

    var match = body && body.match;
    if (!match) {
      // Powód od modelu jest w języku, w którym mówił użytkownik — i mówi
      // konkretnie, czego zabrakło. Lepszy niż nasze „nie udało się".
      reply(STATUS.UNKNOWN, 'Which exercise?', (body && body.reason) || 'I could not match it.');
      return;
    }

    if (!match.complete) {
      // Serii bez kompletu pól nie da się zapisać, a formularza na zegarku nie
      // ma — więc jedyne sensowne wyjście to powtórzyć zdanie z liczbami. Samo
      // „say the whole set again" nie mówiło, czego zabrakło (np. wagi przy
      // ćwiczeniu na obciążenie ze wspomaganiem) — stąd nazwanie brakującego
      // pomiaru wprost.
      reply(
        STATUS.UNKNOWN,
        'Missing numbers',
        describe(match) + ' — missing ' + missingMeasurements(match) + '. Say the whole set again.'
      );
      return;
    }

    if (settings.confirm) {
      pending = match;
      reply(STATUS.CONFIRM, 'Save this?', describe(match));
      return;
    }

    save(match);
  });
}

/**
 * Sprawdzenie połączenia — dwa żądania, bo są dwie różne rzeczy do zepsucia.
 *
 * `GET /health` idzie **bez tokenu** i odpowiada na pytanie „czy telefon w ogóle
 * dosięga serwera": VPN, adres, cleartext HTTP. Dopiero potem `GET /me`
 * sprawdza sam token. Rozdzielenie tych dwóch jest całym sensem tego przycisku —
 * „nie działa" bez wskazania, która połowa nie działa, nie prowadzi donikąd.
 */
function check() {
  var settings = readSettings();
  if (settings.apiUrl.length === 0) {
    reply(STATUS.SETUP, 'No address', 'Set the API address in the Pebble phone app first.');
    return;
  }

  reply(STATUS.WORKING, 'Checking…', settings.apiUrl);

  request('GET', '/health', null, function (problem) {
    if (problem) {
      reply(STATUS.ERROR, 'Server: no', problem);
      return;
    }

    if (settings.apiKey.length === 0) {
      reply(STATUS.SETUP, 'Server: OK', 'The address works. Now paste an API token.');
      return;
    }

    request('GET', '/me', null, function (tokenProblem) {
      if (tokenProblem) {
        reply(STATUS.ERROR, 'Token: no', tokenProblem);
        return;
      }
      reply(STATUS.READY, 'All good', 'Server and token both answer. Press SELECT to dictate.');
    });
  });
}

/* ------------------------------------------------------------------ wejścia */

Pebble.addEventListener('ready', function () {
  replyIdle();
});

Pebble.addEventListener('appmessage', function (event) {
  var payload = event.payload || {};

  if (typeof payload.TRANSCRIPT === 'string' && payload.TRANSCRIPT.length > 0) {
    recognise(payload.TRANSCRIPT);
    return;
  }

  if (payload.COMMAND === COMMAND.SAVE) {
    if (pending) {
      save(pending);
    } else {
      // Zegarek prosi o zapis czegoś, czego już nie trzymamy — po restarcie
      // aplikacji telefonu albo po odrzuceniu. Cofnięcie do spoczynku jest
      // uczciwsze niż zapisanie „czegoś".
      replyIdle();
    }
    return;
  }

  if (payload.COMMAND === COMMAND.RETRY) {
    if (retry) {
      var again = retry;
      // Zdejmujemy je przed wywołaniem, bo powtórzenie ustawia je sobie samo,
      // gdy znów się nie uda — inaczej nieudane ponowienie zostawiałoby dwa.
      retry = null;
      again();
    } else {
      // Zegarek prosi o powtórzenie czegoś, czego już nie trzymamy — tak samo
      // jak przy zapisie bez czekającej serii, wracamy do spoczynku.
      replyIdle();
    }
    return;
  }

  if (payload.COMMAND === COMMAND.DISCARD) {
    pending = null;
    replyIdle();
    return;
  }

  if (payload.COMMAND === COMMAND.CHECK) check();
});

Pebble.addEventListener('showConfiguration', function () {
  Pebble.openURL(configPage(readSettings()));
});

Pebble.addEventListener('webviewclosed', function (event) {
  if (!event.response) return;

  var data;
  try {
    // Android i iOS oddają odpowiedź raz zakodowaną, raz nie — próbujemy obu
    // dróg, zamiast zgadywać platformę.
    data = JSON.parse(event.response);
  } catch (_error) {
    try {
      data = JSON.parse(decodeURIComponent(event.response));
    } catch (_secondError) {
      return;
    }
  }

  writeSettings({
    apiUrl: typeof data.apiUrl === 'string' ? data.apiUrl.replace(/\/+$/, '') : '',
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
    confirm: data.confirm !== false,
  });

  pending = null;
  replyIdle();
});

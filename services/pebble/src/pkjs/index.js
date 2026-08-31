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
};

var COMMAND = { SAVE: 1, DISCARD: 2, CHECK: 3 };

var SETTINGS_KEY = 'alphapump-settings';

/**
 * Limit czasu jednego żądania. Krótszy niż limit zegarka (40 s), żeby to **my**
 * powiedzieli, co się stało — komunikat „serwer nie odpowiada" jest wart więcej
 * niż cisza, po której zegarek sam się poddaje.
 */
var TIMEOUT_MS = 30000;

/** Seria rozpoznana i czekająca na potwierdzenie z zegarka. */
var pending = null;

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

/* ------------------------------------------------------------------ zegarek */

function reply(status, title, body) {
  Pebble.sendAppMessage({ STATUS: status, TITLE: title, BODY: body || '' });
}

/** Stan spoczynku zależy od tego, czy jest dokąd wysyłać. */
function replyIdle() {
  var settings = readSettings();
  if (!configured(settings)) {
    reply(STATUS.SETUP, 'Set me up', 'Open the app settings in the Pebble phone app.');
    return;
  }
  reply(STATUS.READY, 'Ready', 'Hold the watch close and say the exercise with the numbers.');
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

/** Dzień kalendarzowy telefonu — seria należy do dnia, nie do chwili. */
function today() {
  var now = new Date();
  var month = now.getMonth() + 1;
  var day = now.getDate();
  return (
    now.getFullYear() + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day
  );
}

/* ------------------------------------------------------------------- sieć */

/**
 * Jedno żądanie do API.
 *
 * `done(problem, body)` — `problem` jest gotowym zdaniem dla użytkownika albo
 * `null`. Tłumaczenie kodów na zdania jest tutaj, a nie w wołających, bo to samo
 * 401 znaczy wszędzie to samo: token do wymiany.
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
      done(null, body);
      return;
    }
    if (xhr.status === 401 || xhr.status === 403) {
      done('The API token was rejected — make a new one in the phone app.', null);
      return;
    }
    if (xhr.status === 503) {
      done('Dictation is switched off on the server.', null);
      return;
    }

    // Komunikat serwera jest po polsku i pisany dla ludzi, więc przy błędzie
    // walidacji mówi więcej niż sam kod. Przy pozostałych zostaje kod.
    var message = body && body.error && body.error.message;
    done(xhr.status === 400 && message ? message : 'The server answered ' + xhr.status + '.', null);
  };

  xhr.ontimeout = function () {
    done('The server took too long to answer.', null);
  };

  xhr.onerror = function () {
    done('No answer from the server — is the phone on the VPN?', null);
  };

  xhr.send(payload ? JSON.stringify(payload) : null);
}

/* ---------------------------------------------------------------- przepływ */

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
    function (problem) {
      pending = null;
      if (problem) {
        reply(STATUS.ERROR, 'Not saved', problem);
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
  reply(STATUS.WORKING, 'Recognising…', text);

  request('POST', '/voice/text', { text: text }, function (problem, body) {
    if (problem) {
      reply(STATUS.ERROR, 'No answer', problem);
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

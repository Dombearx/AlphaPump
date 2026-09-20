/**
 * Telefonowa połowa aplikacji na zegarek.
 *
 * Watchappa nie sprawdza w tym repozytorium nic — do zbudowania potrzebuje SDK
 * Pebble, a do działania mikrofonu i zegarka. Ale **cała decyzyjność** tej
 * funkcji siedzi po stronie telefonu: co jest błędem, a co brakiem konfiguracji,
 * kiedy wolno zapisać serię, jaki dzień wpisać i który z dwóch dostawców nie
 * odpowiada. To da się sprawdzić bez sprzętu i dlatego jest sprawdzone.
 *
 * Piaskowka PebbleKit JS jest podstawiona trzema atrapami — `Pebble`,
 * `localStorage`, `XMLHttpRequest` — bo dokładnie tyle daje kodowi gospodarz.
 * Testy jadą na `node --test`, czyli na tym, co i tak jest potrzebne do
 * zbudowania reszty repozytorium: osobnego łańcucha narzędzi ta paczka nie
 * dostaje.
 */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const ENTRY = path.join(import.meta.dirname, '../src/pkjs/index.js');

const MATCH = {
  exerciseId: '00000000-0000-7000-8000-000000000001',
  name: 'Bench press',
  loggingType: 'weight_reps',
  weightG: 82_500,
  reps: 8,
  durationS: null,
  distanceM: null,
  bodyweightG: null,
  note: null,
  complete: true,
};

const SETTINGS = { apiUrl: 'http://api.test', apiKey: 'ap_token', confirm: true };

/** Dzień kalendarzowy telefonu — liczony tak samo jak `today()` w kodzie. */
const TODAY = (() => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
})();

/** Dzień oddalony o tyle dni od dziś — okresy cyklu liczą się względem niego. */
const shift = (days) => {
  const [year, month, day] = TODAY.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value) => String(value).padStart(2, '0');
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
};

/** O dzisiejsze serie ekran spoczynku pyta obustronnie domkniętym zakresem. */
const SETS_TODAY = `GET http://api.test/sets?from=${TODAY}&to=${TODAY}`;

/** Odpowiedzi, na których stoi większość testów: rozpoznanie i zapis się udają. */
const HAPPY_ROUTES = () => ({
  'POST http://api.test/voice/text': {
    status: 200,
    body: { transcript: 'bench press 82.5 for 8', match: MATCH, reason: null },
  },
  'POST http://api.test/sets': { status: 201, body: { id: 'set-1' } },
  'GET http://api.test/health': { status: 200, body: { status: 'ok' } },
  'GET http://api.test/me': { status: 200, body: { id: 'user-1' } },
  // Ekran spoczynku pyta najpierw o cykle, a gdy żadnego nie ma — o dzisiejsze
  // serie. Domyślnie nie ma ani cyklu, ani serii, więc ekran wygląda tak, jak
  // przed obiema listami.
  'GET http://api.test/cycles': { status: 200, body: [] },
  [SETS_TODAY]: { status: 200, body: [] },
  'GET http://api.test/exercises': {
    status: 200,
    body: [{ id: MATCH.exerciseId, name: MATCH.name }],
  },
});

/**
 * Świeża piaskowka na każdy test.
 *
 * Moduł trzyma stan (czekającą serię i podpiętych słuchaczy), więc dwa testy
 * na jednej instancji sprawdzałyby siebie nawzajem — stąd czyszczenie cache'u
 * `require` zamiast jednego ładowania na plik.
 */
function sandbox(stored = null) {
  const store = new Map();
  if (stored !== null) store.set('alphapump-settings', JSON.stringify(stored));

  const sent = [];
  const calls = [];
  const listeners = {};
  const state = { routes: HAPPY_ROUTES() };

  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
  };

  globalThis.Pebble = {
    addEventListener: (name, handler) => {
      listeners[name] = listeners[name] ?? [];
      listeners[name].push(handler);
    },
    sendAppMessage: (payload) => sent.push(payload),
    openURL: (url) => sent.push({ OPEN: url }),
  };

  globalThis.XMLHttpRequest = class {
    open(method, url) {
      this.method = method;
      this.url = url;
      this.headers = {};
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    send(body) {
      const key = `${this.method} ${this.url}`;
      const route = state.routes[key];
      assert.ok(route, `brak atrapy dla ${key}`);
      calls.push({ key, body: body ? JSON.parse(body) : null, headers: this.headers });

      // Atrapa umie też **nie** odpowiedzieć: `fail` odpala tę samą ścieżkę,
      // którą XHR wybiera przy ciszy w sieci i przy przekroczonym czasie —
      // czyli oba przypadki, w których winy nie ma po stronie użytkownika.
      if (route.fail) {
        void Promise.resolve().then(() =>
          route.fail === 'timeout' ? this.ontimeout() : this.onerror(),
        );
        return;
      }

      this.status = route.status;
      // `text` jest dla odpowiedzi, których nie da się przeczytać jako JSON —
      // strony błędu od proxy stojącego przed API.
      this.responseText = route.text ?? JSON.stringify(route.body ?? {});
      // Odpowiedź przychodzi po zdaniu sterowania, tak jak prawdziwa.
      void Promise.resolve().then(() => this.onload());
    }
  };

  delete require.cache[require.resolve(ENTRY)];
  require(ENTRY);

  return {
    sent,
    calls,
    store,
    routes: state.routes,
    last: () => sent[sent.length - 1],
    lastCall: () => calls[calls.length - 1],
    /** Ile razy poszedł zapis serii — ekran spoczynku pyta o swoje osobno. */
    saves: () => calls.filter((call) => call.key === 'POST http://api.test/sets').length,
    fire: (name, event) => (listeners[name] ?? []).forEach((handler) => handler(event)),
    /**
     * Domyka łańcuch żądań. Wszystko, co robi atrapa, jest mikrozadaniem, więc
     * kilka obrotów pętli wystarcza na najdłuższy łańcuch, jaki tu bywa
     * (rozpoznanie, a po nim zapis) — i nie wymaga zegara.
     */
    settle: async () => {
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    },
  };
}

/** Stany czytane przez `src/c/main.c`. */
const STATUS = {
  SETUP: 0,
  READY: 1,
  WORKING: 2,
  CONFIRM: 3,
  SAVED: 4,
  UNKNOWN: 5,
  ERROR: 6,
  RETRY: 7,
};
const COMMAND = { SAVE: 1, DISCARD: 2, CHECK: 3, RETRY: 4 };

/* ------------------------------------------ biblioteka i serie do obu ekranów */

const SQUAT_ID = '00000000-0000-7000-8000-000000000002';
const DIP_ID = '00000000-0000-7000-8000-000000000003';
const CHEST_TAG = '00000000-0000-7000-8000-0000000000c1';
const LEGS_TAG = '00000000-0000-7000-8000-0000000000c2';

/** Ćwiczenia w kształcie, w jakim oddaje je `GET /exercises`. */
const LIBRARY = [
  { id: MATCH.exerciseId, name: 'Bench press', primaryTagId: CHEST_TAG },
  { id: SQUAT_ID, name: 'Squat', primaryTagId: LEGS_TAG },
  { id: DIP_ID, name: 'Dip', primaryTagId: CHEST_TAG },
];

const TAGS = [
  { id: CHEST_TAG, name: 'Chest' },
  { id: LEGS_TAG, name: 'Legs' },
];

/** Seria w kształcie, w jakim oddaje ją `GET /sets` — bez nazwy ćwiczenia. */
const set = (fields) => ({
  id: 'set-1',
  userId: 'user-1',
  exerciseId: MATCH.exerciseId,
  performedOn: TODAY,
  position: 0,
  weightG: 82_500,
  reps: 8,
  durationS: null,
  distanceM: null,
  bodyweightG: null,
  note: null,
  createdAt: '2026-09-08T10:00:00.000Z',
  updatedAt: '2026-09-08T10:00:00.000Z',
  deletedAt: null,
  ...fields,
});

describe('ustawienia', () => {
  it('bez adresu i tokenu prosi o konfigurację, a nie udaje gotowości', () => {
    const phone = sandbox();
    phone.fire('ready');
    assert.equal(phone.last().STATUS, STATUS.SETUP);
  });

  it('zapisuje ustawienia ze strony konfiguracji i ucina ukośnik z adresu', () => {
    // Adres z ukośnikiem na końcu dawałby `http://api.test//sets` — serwer
    // odpowiada wtedy 404 na trasę, która istnieje.
    const phone = sandbox();
    phone.fire('webviewclosed', {
      response: JSON.stringify({ apiUrl: 'http://api.test/', apiKey: 'ap_token', confirm: true }),
    });

    assert.equal(JSON.parse(phone.store.get('alphapump-settings')).apiUrl, 'http://api.test');
    assert.equal(phone.last().STATUS, STATUS.READY);
  });

  it('czyta odpowiedź konfiguratora także wtedy, gdy przyszła zakodowana', () => {
    // Android i iOS oddają ją różnie i nie mamy jak rozpoznać platformy.
    const phone = sandbox();
    phone.fire('webviewclosed', {
      response: encodeURIComponent(JSON.stringify({ ...SETTINGS, confirm: false })),
    });

    assert.equal(JSON.parse(phone.store.get('alphapump-settings')).confirm, false);
  });

  it('strona konfiguracji jedzie z wypełnionymi wartościami', () => {
    const phone = sandbox(SETTINGS);
    phone.fire('showConfiguration');

    const url = phone.last().OPEN;
    assert.ok(url.startsWith('data:text/html;charset=utf-8,'));
    const html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
    assert.ok(html.includes('"apiUrl":"http://api.test"'));
    assert.ok(html.includes('pebblejs://close#'));
  });
});

describe('rozpoznanie serii', () => {
  let phone;

  beforeEach(() => {
    phone = sandbox(SETTINGS);
  });

  it('pyta o rozpoznanie tokenem i czeka na potwierdzenie', async () => {
    phone.fire('appmessage', { payload: { TRANSCRIPT: 'bench press 82.5 for 8' } });
    await phone.settle();

    assert.equal(phone.lastCall().key, 'POST http://api.test/voice/text');
    assert.equal(phone.lastCall().headers['x-api-key'], 'ap_token');
    // Dzień jedzie już przy rozpoznaniu: po nim serwer poznaje, czy sama liczba
    // powtórzeń ma z czego dopisać ćwiczenie i ciężar poprzedniej serii.
    assert.match(phone.lastCall().body.performedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(phone.last().STATUS, STATUS.CONFIRM);
    assert.equal(phone.last().BODY, 'Bench press: 82.5 kg x 8');
  });

  it('zapisuje dopiero po potwierdzeniu z zegarka', async () => {
    phone.fire('appmessage', { payload: { TRANSCRIPT: 'bench press 82.5 for 8' } });
    await phone.settle();
    const beforeConfirm = phone.calls.length;

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.SAVE } });
    await phone.settle();

    assert.equal(phone.calls.length, beforeConfirm + 1);
    const saved = phone.lastCall();
    assert.equal(saved.key, 'POST http://api.test/sets');
    assert.match(saved.body.performedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(saved.body.weightG, 82_500);
    // Pole spoza typu logowania jedzie jako `null`, bo `POST /sets` odrzuca
    // każdą wartość, której to ćwiczenie nie ma.
    assert.equal(saved.body.durationS, null);
    assert.equal(phone.last().STATUS, STATUS.SAVED);
  });

  it('drugie potwierdzenie nie zapisuje serii po raz drugi', async () => {
    phone.fire('appmessage', { payload: { TRANSCRIPT: 'bench press 82.5 for 8' } });
    await phone.settle();
    phone.fire('appmessage', { payload: { COMMAND: COMMAND.SAVE } });
    await phone.settle();
    const afterSave = phone.saves();

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.SAVE } });
    await phone.settle();

    assert.equal(phone.saves(), afterSave);
    assert.equal(phone.last().STATUS, STATUS.READY);
  });

  it('odrzucenie zabiera czekającą serię', async () => {
    phone.fire('appmessage', { payload: { TRANSCRIPT: 'bench press 82.5 for 8' } });
    await phone.settle();

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.DISCARD } });
    const afterDiscard = phone.saves();
    phone.fire('appmessage', { payload: { COMMAND: COMMAND.SAVE } });
    await phone.settle();

    assert.equal(phone.saves(), afterDiscard);
  });

  it('bez potwierdzania zapisuje od razu', async () => {
    const eager = sandbox({ ...SETTINGS, confirm: false });
    eager.fire('appmessage', { payload: { TRANSCRIPT: 'bench press 82.5 for 8' } });
    await eager.settle();

    assert.equal(eager.lastCall().key, 'POST http://api.test/sets');
    assert.equal(eager.last().STATUS, STATUS.SAVED);
  });

  it('brak dopasowania pokazuje powód od modelu i niczego nie zapisuje', async () => {
    phone.routes['POST http://api.test/voice/text'] = {
      status: 200,
      body: { transcript: 'coś', match: null, reason: 'Nie wiem, o które ćwiczenie chodzi' },
    };

    phone.fire('appmessage', { payload: { TRANSCRIPT: 'coś tam' } });
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.UNKNOWN);
    assert.equal(phone.last().BODY, 'Nie wiem, o które ćwiczenie chodzi');
    assert.equal(phone.calls.length, 1);
  });

  it('serii bez kompletu liczb nie zapisuje w żadnym trybie', async () => {
    // Formularza na zegarku nie ma, więc jedyne wyjście to powtórzyć zdanie.
    const eager = sandbox({ ...SETTINGS, confirm: false });
    eager.routes['POST http://api.test/voice/text'] = {
      status: 200,
      body: { transcript: 'x', match: { ...MATCH, reps: null, complete: false }, reason: null },
    };

    eager.fire('appmessage', { payload: { TRANSCRIPT: 'bench press 82.5' } });
    await eager.settle();

    assert.equal(eager.last().STATUS, STATUS.UNKNOWN);
    assert.equal(eager.calls.length, 1);
    assert.match(eager.last().BODY, /missing reps/);
  });

  it('komunikat o brakujących liczbach nazywa konkretny brakujący pomiar', async () => {
    // Zgłoszenie #94: „assisted pull up 5 reps" nie podaje wagi, a poprzedni
    // komunikat („say the whole set again") nie mówił, czego zabrakło.
    const eager = sandbox({ ...SETTINGS, confirm: false });
    eager.routes['POST http://api.test/voice/text'] = {
      status: 200,
      body: {
        transcript: 'assisted pull up 5 reps',
        match: { ...MATCH, name: 'Assisted pull up', weightG: null, reps: 5, complete: false },
        reason: null,
      },
    };

    eager.fire('appmessage', { payload: { TRANSCRIPT: 'assisted pull up 5 reps' } });
    await eager.settle();

    assert.equal(eager.last().STATUS, STATUS.UNKNOWN);
    assert.match(eager.last().BODY, /missing weight/);
  });

  it('wyłączone dyktowanie na serwerze mówi wprost, że to nie awaria sieci', async () => {
    phone.routes['POST http://api.test/voice/text'] = { status: 503, body: {} };

    phone.fire('appmessage', { payload: { TRANSCRIPT: 'cokolwiek' } });
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.ERROR);
    assert.match(phone.last().BODY, /switched off/);
  });

  it('unieważniony token prowadzi do wymiany tokenu, a nie do powtarzania', async () => {
    phone.routes['POST http://api.test/voice/text'] = { status: 401, body: {} };

    phone.fire('appmessage', { payload: { TRANSCRIPT: 'cokolwiek' } });
    await phone.settle();

    assert.match(phone.last().BODY, /token/i);
  });
});

describe('ponowienie nieudanej wysyłki', () => {
  /** Doprowadza do ekranu potwierdzenia — stąd zaczyna się każdy zapis. */
  const recognised = async (phone) => {
    phone.fire('appmessage', { payload: { TRANSCRIPT: 'bench press 82.5 for 8' } });
    await phone.settle();
    return phone;
  };

  it('zapis przewrócony przez serwer daje ponowienie, a nie koniec drogi', async () => {
    // Zgłoszenie #115: przy błędzie nie z winy użytkownika trzeba było dyktować
    // serię od nowa, chociaż w zdaniu nikt się nie pomylił.
    const phone = await recognised(sandbox(SETTINGS));
    phone.routes['POST http://api.test/sets'] = { status: 500, body: {} };

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.SAVE } });
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.RETRY);
    assert.equal(phone.last().TITLE, 'Not saved');
  });

  it('powtarza tę samą serię, bez dyktowania jej jeszcze raz', async () => {
    const phone = await recognised(sandbox(SETTINGS));
    phone.routes['POST http://api.test/sets'] = { status: 502, body: {} };
    phone.fire('appmessage', { payload: { COMMAND: COMMAND.SAVE } });
    await phone.settle();

    // Serwer wstał — powtórzenie idzie tą samą serią, której nikt nie wpisywał
    // po raz drugi.
    phone.routes['POST http://api.test/sets'] = { status: 201, body: { id: 'set-1' } };
    phone.fire('appmessage', { payload: { COMMAND: COMMAND.RETRY } });
    await phone.settle();

    assert.equal(phone.saves(), 2);
    assert.equal(phone.lastCall().body.weightG, 82_500);
    assert.equal(phone.lastCall().body.reps, 8);
    assert.equal(phone.last().STATUS, STATUS.SAVED);
    // Rozpoznanie poszło raz, na początku: mikrofon w tym przepływie nie wraca.
    assert.equal(
      phone.calls.filter((call) => call.key === 'POST http://api.test/voice/text').length,
      1,
    );
  });

  it('cisza w sieci przy rozpoznaniu powtarza to samo zdanie', async () => {
    const phone = sandbox(SETTINGS);
    phone.routes['POST http://api.test/voice/text'] = { fail: 'network' };

    phone.fire('appmessage', { payload: { TRANSCRIPT: 'bench press 82.5 for 8' } });
    await phone.settle();
    assert.equal(phone.last().STATUS, STATUS.RETRY);

    phone.routes['POST http://api.test/voice/text'] =
      HAPPY_ROUTES()['POST http://api.test/voice/text'];
    phone.fire('appmessage', { payload: { COMMAND: COMMAND.RETRY } });
    await phone.settle();

    const voice = phone.calls.filter((call) => call.key === 'POST http://api.test/voice/text');
    assert.equal(voice.length, 2);
    assert.equal(voice[1].body.text, 'bench press 82.5 for 8');
    assert.equal(phone.last().STATUS, STATUS.CONFIRM);
  });

  it('przekroczony czas serwera też jest do powtórzenia', async () => {
    const phone = await recognised(sandbox(SETTINGS));
    phone.routes['POST http://api.test/sets'] = { fail: 'timeout' };

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.SAVE } });
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.RETRY);
    assert.match(phone.last().BODY, /too long/);
  });

  it('błędu walidacji nie ma po co powtarzać — odpowiedź byłaby ta sama', async () => {
    const phone = await recognised(sandbox(SETTINGS));
    phone.routes['POST http://api.test/sets'] = {
      status: 400,
      body: { error: { code: 'bad_request', message: 'Ćwiczenie nie przyjmuje ciężaru' } },
    };

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.SAVE } });
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.ERROR);
    assert.equal(phone.last().BODY, 'HTTP 400 bad_request: Ćwiczenie nie przyjmuje ciężaru');
  });

  it('martwy token i wyłączone dyktowanie prowadzą do ustawień, a nie do ponowień', async () => {
    const rejected = sandbox(SETTINGS);
    rejected.routes['POST http://api.test/voice/text'] = { status: 401, body: {} };
    rejected.fire('appmessage', { payload: { TRANSCRIPT: 'cokolwiek' } });
    await rejected.settle();
    assert.equal(rejected.last().STATUS, STATUS.ERROR);

    // 503 jest tu decyzją administratora, a nie awarią, która minie sama.
    const off = sandbox(SETTINGS);
    off.routes['POST http://api.test/voice/text'] = { status: 503, body: {} };
    off.fire('appmessage', { payload: { TRANSCRIPT: 'cokolwiek' } });
    await off.settle();
    assert.equal(off.last().STATUS, STATUS.ERROR);
  });

  it('po błędzie bez ponowienia przycisk nie wskrzesza starej wysyłki', async () => {
    const phone = await recognised(sandbox(SETTINGS));
    phone.routes['POST http://api.test/sets'] = { status: 500, body: {} };
    phone.fire('appmessage', { payload: { COMMAND: COMMAND.SAVE } });
    await phone.settle();

    // Nowe zdanie kończy się błędem, którego powtarzać nie ma sensu — a stary
    // zapis nie może się po nim odezwać.
    phone.routes['POST http://api.test/voice/text'] = { status: 400, body: {} };
    phone.fire('appmessage', { payload: { TRANSCRIPT: 'coś tam' } });
    await phone.settle();
    const afterSecond = phone.saves();

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.RETRY } });
    await phone.settle();

    assert.equal(phone.saves(), afterSecond);
    assert.equal(phone.last().TITLE, 'Ready');
  });

  it('odrzucenie ponowienia wraca do spoczynku i niczego nie wysyła', async () => {
    const phone = await recognised(sandbox(SETTINGS));
    phone.routes['POST http://api.test/sets'] = { status: 500, body: {} };
    phone.fire('appmessage', { payload: { COMMAND: COMMAND.SAVE } });
    await phone.settle();
    const afterFailure = phone.saves();

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.DISCARD } });
    await phone.settle();
    phone.fire('appmessage', { payload: { COMMAND: COMMAND.RETRY } });
    await phone.settle();

    assert.equal(phone.saves(), afterFailure);
    assert.equal(phone.last().STATUS, STATUS.READY);
  });
});

describe('pełna treść błędu na zegarku', () => {
  /** Tyle bajtów treści przyjmuje `MAX_BODY` w `src/c/main.c`. */
  const MAX_BODY_BYTES = 511;

  const failing = async (route) => {
    const phone = sandbox(SETTINGS);
    phone.routes['POST http://api.test/voice/text'] = route;
    phone.fire('appmessage', { payload: { TRANSCRIPT: 'bench press 82.5 for 8' } });
    await phone.settle();
    return phone.last();
  };

  it('awaria serwera mówi, co się stało, a nie samo „answered 500"', async () => {
    // Zgłoszenie #119: aplikacji używają sami piszący ten serwer, więc kod błędu
    // i zdanie od serwera są tu warte więcej niż uproszczony komunikat.
    const screen = await failing({
      status: 500,
      body: { error: { code: 'internal', message: 'Model nie odpowiedział w czasie' } },
    });

    assert.equal(screen.STATUS, STATUS.RETRY);
    assert.equal(screen.BODY, 'HTTP 500 internal: Model nie odpowiedział w czasie');
  });

  it('szczegóły odpowiedzi jadą razem ze zdaniem', async () => {
    const screen = await failing({
      status: 400,
      body: {
        error: { code: 'bad_request', message: 'Nieprawidłowe dane', details: { field: 'reps' } },
      },
    });

    assert.equal(screen.BODY, 'HTTP 400 bad_request: Nieprawidłowe dane {"field":"reps"}');
  });

  it('odrzucony token pokazuje odpowiedź serwera i to, co z nią zrobić', async () => {
    const screen = await failing({
      status: 401,
      body: { error: { code: 'unauthorized', message: 'Token API jest nieważny' } },
    });

    assert.match(screen.BODY, /^HTTP 401 unauthorized: Token API jest nieważny/);
    assert.match(screen.BODY, /new one in the phone app/);
  });

  it('odpowiedź nie od API pokazuje się tak, jak przyszła', async () => {
    // Przed API stoi Caddy, a jego strona błędu nie jest JSON-em — bez surowej
    // treści zostałby sam kod stanu i pytanie, kto właściwie odpowiedział.
    const screen = await failing({ status: 502, text: '<html>502 Bad Gateway</html>' });

    assert.equal(screen.BODY, 'HTTP 502: <html>502 Bad Gateway</html>');
  });

  it('treść dłuższa niż skrzynka zegarka dojeżdża przycięta, a nie wcale', async () => {
    // Wiadomość większa niż bufor zegarka nie doszłaby w całości — a wtedy
    // zamiast długiego błędu widać byłoby jego brak.
    const screen = await failing({
      status: 500,
      body: { error: { code: 'internal', message: 'żółć '.repeat(400) } },
    });

    assert.ok(Buffer.byteLength(screen.BODY, 'utf8') <= MAX_BODY_BYTES);
    assert.ok(screen.BODY.endsWith('…'));
    assert.match(screen.BODY, /^HTTP 500 internal: żółć/);
  });
});

describe('sprawdzenie połączenia', () => {
  it('rozdziela „serwer nie odpowiada" od „token nie działa"', async () => {
    const phone = sandbox(SETTINGS);

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.CHECK } });
    await phone.settle();
    assert.equal(phone.last().TITLE, 'All good');

    phone.routes['GET http://api.test/me'] = { status: 401, body: {} };
    phone.fire('appmessage', { payload: { COMMAND: COMMAND.CHECK } });
    await phone.settle();
    assert.equal(phone.last().TITLE, 'Token: no');

    phone.routes['GET http://api.test/health'] = { status: 502, body: {} };
    phone.fire('appmessage', { payload: { COMMAND: COMMAND.CHECK } });
    await phone.settle();
    assert.equal(phone.last().TITLE, 'Server: no');
  });

  it('pyta o zdrowie bez tokenu — to jego jedyne zadanie', async () => {
    // `GET /health` stoi przed uwierzytelnieniem, więc token wysłany przy nim
    // niczego nie sprawdza, a jego brak nie może zablokować diagnostyki.
    const phone = sandbox({ apiUrl: 'http://api.test', apiKey: '', confirm: true });

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.CHECK } });
    await phone.settle();

    assert.equal(phone.lastCall().key, 'GET http://api.test/health');
    assert.equal(phone.lastCall().headers['x-api-key'], undefined);
    assert.equal(phone.last().STATUS, STATUS.SETUP);
  });

  it('bez adresu nie ma czego sprawdzać', async () => {
    const phone = sandbox();

    phone.fire('appmessage', { payload: { COMMAND: COMMAND.CHECK } });
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.SETUP);
    assert.equal(phone.calls.length, 0);
  });
});

describe('opis serii na ekranie zegarka', () => {
  const describeSet = async (match) => {
    const phone = sandbox(SETTINGS);
    phone.routes['POST http://api.test/voice/text'] = {
      status: 200,
      body: { transcript: 'x', match, reason: null },
    };
    phone.fire('appmessage', { payload: { TRANSCRIPT: 'x' } });
    await phone.settle();
    return phone.last().BODY;
  };

  it('ciężar z powtórzeniami czyta się jak mnożenie', async () => {
    assert.equal(await describeSet(MATCH), 'Bench press: 82.5 kg x 8');
  });

  it('same powtórzenia dostają jednostkę', async () => {
    const pullUp = {
      ...MATCH,
      name: 'Pull-up',
      loggingType: 'bodyweight_reps',
      weightG: null,
      reps: 12,
    };
    assert.equal(await describeSet(pullUp), 'Pull-up: 12 reps');
  });

  it('czas pokazuje się jako `m:ss`', async () => {
    const plank = {
      ...MATCH,
      name: 'Plank',
      loggingType: 'bodyweight_time',
      weightG: null,
      reps: null,
      durationS: 90,
    };
    assert.equal(await describeSet(plank), 'Plank: 1:30');
  });

  it('dystans stoi przed czasem, bo tak brzmi zdanie o biegu', async () => {
    const run = {
      ...MATCH,
      name: 'Run',
      loggingType: 'distance_time',
      weightG: null,
      reps: null,
      distanceM: 5000,
      durationS: 1500,
    };
    assert.equal(await describeSet(run), 'Run: 5000 m 25:00');
  });
});

describe('dzisiejsze serie na ekranie spoczynku', () => {
  const withSets = (sets) => {
    const phone = sandbox(SETTINGS);
    phone.routes[SETS_TODAY] = { status: 200, body: sets };
    phone.routes['GET http://api.test/exercises'] = { status: 200, body: LIBRARY };
    return phone;
  };

  it('pokazuje serie zapisane dziś, bez naciskania czegokolwiek', async () => {
    const phone = withSets([
      set({}),
      set({ id: 'set-2', reps: 6, position: 1, createdAt: '2026-09-08T10:04:00.000Z' }),
    ]);

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.READY);
    assert.equal(phone.last().TITLE, 'Today: 2 sets');
    assert.equal(phone.last().BODY, 'Bench press: 82.5 kg x 6\nBench press: 82.5 kg x 8');
  });

  it('gotowość jest na ekranie od razu, a lista dochodzi dopiero po niej', () => {
    // Dyktowanie ma być tak samo szybkie jak przedtem: ekran gotowości nie
    // czeka na żadne żądanie, bo bez sieci nadal wolno mówić.
    const phone = withSets([set({})]);

    phone.fire('ready');

    assert.equal(phone.last().STATUS, STATUS.READY);
    assert.equal(phone.last().TITLE, 'Ready');
  });

  it('od najnowszej, bo pozycja numeruje serie w obrębie ćwiczenia', async () => {
    // Obie serie mają pozycję 0 — są pierwsze, każda w swoim ćwiczeniu.
    const phone = withSets([
      set({ createdAt: '2026-09-08T10:00:00.000Z' }),
      set({
        id: 'set-2',
        exerciseId: SQUAT_ID,
        createdAt: '2026-09-08T11:00:00.000Z',
        weightG: 100_000,
        reps: 5,
      }),
    ]);

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().BODY, 'Squat: 100 kg x 5\nBench press: 82.5 kg x 8');
  });

  it('mieści tyle serii, ile mieści ekran — resztę mówi tytuł', async () => {
    const phone = withSets([1, 2, 3, 4, 5].map((n) => set({ id: 'set-' + n, reps: n })));

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().TITLE, 'Today: 5 sets');
    assert.equal(phone.last().BODY.split('\n').length, 3);
  });

  it('pusty dzień zostawia ekran spoczynku takim, jaki był', async () => {
    const phone = withSets([]);

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().TITLE, 'Ready');
    assert.equal(phone.sent.length, 1);
  });

  it('nieudane pytanie o serie niczego nie psuje', async () => {
    // Lista jest dodatkiem, a nie warunkiem dyktowania — błąd na ekranie
    // spoczynku wyglądałby jak awaria aplikacji, którą można normalnie użyć.
    const phone = withSets([]);
    phone.routes[SETS_TODAY] = { status: 500, body: {} };

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.READY);
    assert.equal(phone.last().TITLE, 'Ready');
    assert.equal(phone.sent.length, 1);
  });

  it('biblioteka jedzie raz, a nie przy każdym wejściu na ekran', async () => {
    const phone = withSets([set({})]);

    phone.fire('ready');
    await phone.settle();
    phone.fire('ready');
    await phone.settle();

    const library = phone.calls.filter((call) => call.key === 'GET http://api.test/exercises');
    assert.equal(library.length, 1);
    assert.equal(phone.last().TITLE, 'Today: 1 set');
  });

  it('ćwiczenie spoza biblioteki pokazuje same liczby, zamiast znikać', async () => {
    const phone = withSets([set({})]);
    phone.routes['GET http://api.test/exercises'] = { status: 500, body: {} };

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().BODY, 'Exercise: 82.5 kg x 8');
  });

  it('pamięć podręczna sprzed tagów odświeża się, zamiast gubić nazwy', async () => {
    const phone = withSets([set({})]);
    // Kształt sprzed dołożenia tagu głównego: pod identyfikatorem sama nazwa.
    phone.store.set(
      'alphapump-exercise-names',
      JSON.stringify({ [MATCH.exerciseId]: 'Bench press' }),
    );

    phone.fire('ready');
    await phone.settle();

    const library = phone.calls.filter((call) => call.key === 'GET http://api.test/exercises');
    assert.equal(library.length, 1);
    assert.equal(phone.last().BODY, 'Bench press: 82.5 kg x 8');
  });

  it('spóźniona lista nie zabiera ekranu temu, kto już dyktuje', async () => {
    const phone = withSets([set({})]);

    phone.fire('ready');
    phone.fire('appmessage', { payload: { TRANSCRIPT: 'bench press 82.5 for 8' } });
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.CONFIRM);
    assert.equal(phone.last().BODY, 'Bench press: 82.5 kg x 8');
  });
});

describe('pozostała robota z cyklu na ekranie głównym', () => {
  const goal = (fields) => ({
    id: 'goal-1',
    metric: 'sets',
    target: 4,
    exerciseId: null,
    tagId: null,
    position: 0,
    ...fields,
  });

  /** Cykl w kształcie, w jakim oddaje go `GET /cycles` — domyślnie trwający. */
  const cycle = (goals, fields) => ({
    id: 'cycle-1',
    userId: 'user-1',
    name: 'September',
    startsOn: shift(-3),
    endsOn: shift(3),
    archivedAt: null,
    goals,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    deletedAt: null,
    ...fields,
  });

  const setsIn = (from, to) => `GET http://api.test/sets?from=${from}&to=${to}`;

  /** O serie bieżącego okresu ekran pyta jednym żądaniem, a nie po cyklu. */
  const PERIOD_SETS = setsIn(shift(-3), shift(3));

  const withCycle = (cycles, sets) => {
    const phone = sandbox(SETTINGS);
    phone.routes['GET http://api.test/cycles'] = { status: 200, body: cycles };
    phone.routes[PERIOD_SETS] = { status: 200, body: sets };
    phone.routes['GET http://api.test/exercises'] = { status: 200, body: LIBRARY };
    phone.routes['GET http://api.test/tags'] = { status: 200, body: TAGS };
    return phone;
  };

  it('cel na ćwiczenie mówi, ile serii zostało do zrobienia', async () => {
    const phone = withCycle(
      [cycle([goal({ exerciseId: MATCH.exerciseId, target: 4 })])],
      [set({}), set({ id: 'set-2', performedOn: shift(-1) })],
    );

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.READY);
    assert.equal(phone.last().TITLE, 'Cycle: 1 to do');
    assert.equal(phone.last().BODY, 'Bench press: 2 sets');
  });

  it('cel tagowy podpowiada ćwiczenia, którymi ten tag w cyklu bywa robiony', async () => {
    // Przysiad ma inny tag główny, więc ani nie zalicza celu, ani nie trafia
    // między podpowiedzi — tag dodatkowy serii nie zalicza, tak samo jak w rdzeniu.
    const phone = withCycle(
      [cycle([goal({ tagId: CHEST_TAG, target: 6 })])],
      [
        set({ id: 'set-1' }),
        set({ id: 'set-2' }),
        set({ id: 'set-3' }),
        set({ id: 'set-4', exerciseId: DIP_ID }),
        set({ id: 'set-5', exerciseId: SQUAT_ID }),
      ],
    );

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().TITLE, 'Cycle: 1 to do');
    assert.equal(phone.last().BODY, 'Chest: 2 sets (Bench press, Dip)');
  });

  it('najbliżej ukończenia najpierw — z trzech wierszy najwięcej warta jest ta pozycja', async () => {
    const phone = withCycle(
      [
        cycle([
          goal({ id: 'goal-1', exerciseId: MATCH.exerciseId, target: 4 }),
          goal({ id: 'goal-2', exerciseId: SQUAT_ID, target: 2 }),
        ]),
      ],
      [set({}), set({ id: 'set-2', exerciseId: SQUAT_ID })],
    );

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().TITLE, 'Cycle: 2 to do');
    assert.equal(phone.last().BODY, 'Squat: 1 set\nBench press: 3 sets');
  });

  it('cel czasowy mówi, ile czasu zostało', async () => {
    const phone = withCycle(
      [cycle([goal({ metric: 'duration', exerciseId: MATCH.exerciseId, target: 1800 })])],
      [set({ durationS: 600 })],
    );

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().BODY, 'Bench press: 20:00');
  });

  it('cykl o stałej długości liczy bieżący okres, a nie miniony', async () => {
    // Koniec minął cztery dni temu, więc kolejny okres tej samej długości
    // zaczął się sam — seria z poprzedniego okresu już się do niego nie zalicza.
    const phone = withCycle(
      [
        cycle([goal({ exerciseId: MATCH.exerciseId, target: 3 })], {
          startsOn: shift(-10),
          endsOn: shift(-4),
        }),
      ],
      [set({}), set({ id: 'set-old', performedOn: shift(-5) })],
    );

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().BODY, 'Bench press: 2 sets');
  });

  it('domknięty cykl wraca do dzisiejszych serii, bez drugiego pytania o serie', async () => {
    const phone = withCycle(
      [cycle([goal({ exerciseId: MATCH.exerciseId, target: 1 })])],
      [set({})],
    );

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().TITLE, 'Today: 1 set');
    assert.equal(phone.last().BODY, 'Bench press: 82.5 kg x 8');
    assert.equal(phone.calls.filter((call) => call.key === SETS_TODAY).length, 0);
  });

  it('cykl, który się jeszcze nie zaczął, nie wchodzi na ekran', async () => {
    const phone = withCycle(
      [cycle([goal({ exerciseId: MATCH.exerciseId })], { startsOn: shift(3), endsOn: shift(10) })],
      [set({})],
    );

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().TITLE, 'Ready');
  });

  it('nieudane pytanie o cykle zostawia ekran z dzisiejszymi seriami', async () => {
    const phone = withCycle([cycle([goal({ exerciseId: MATCH.exerciseId })])], [set({})]);
    phone.routes['GET http://api.test/cycles'] = { status: 500, body: {} };
    phone.routes[SETS_TODAY] = { status: 200, body: [set({})] };

    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.last().STATUS, STATUS.READY);
    assert.equal(phone.last().TITLE, 'Today: 1 set');
  });

  it('nazwy tagów jadą raz, a nie przy każdym wejściu na ekran', async () => {
    const phone = withCycle([cycle([goal({ tagId: CHEST_TAG })])], [set({})]);

    phone.fire('ready');
    await phone.settle();
    phone.fire('ready');
    await phone.settle();

    assert.equal(phone.calls.filter((call) => call.key === 'GET http://api.test/tags').length, 1);
    assert.equal(phone.last().BODY, 'Chest: 3 sets (Bench press)');
  });
});

/*
 * AlphaPump na Pebble — jeden ekran i trzy przyciski.
 *
 * Zegarek **nie wysyła dźwięku i nie umie go wysłać**: Pebble nie daje aplikacji
 * dostępu do surowego nagrania, tylko do gotowej transkrypcji z Dictation API.
 * Ta aplikacja jest więc mikrofonem, który oddaje zdanie — a całą resztę robi
 * `src/pkjs/index.js` po stronie telefonu i API AlphaPump.
 *
 * Ekran ma być czytelny przy zmęczonych oczach i jednym rzucie oka, więc jest
 * na nim wyłącznie: co się właśnie stało (tytuł), czego to dotyczy (treść)
 * i co można nacisnąć (podpowiedź na dole). Wibracja mówi to samo bez patrzenia:
 * jedno pulsnięcie — zapisane, dwa — coś poszło nie tak.
 *
 * ## Dlaczego potwierdzenie dyktowania zostaje włączone
 *
 * Pebble domyślnie pokazuje po dyktowaniu ekran „tak zrozumiałem, poprawić?".
 * Można go wyłączyć i zaoszczędzić jedno naciśnięcie — ale to jedyne miejsce
 * w całym przepływie, w którym źle usłyszane zdanie da się złapać za darmo,
 * zanim pojedzie do modelu i do bazy. Zostaje.
 */

#include <pebble.h>

/** Najdłuższe zdanie, jakie przyjmujemy z dyktowania. Seria to jedno zdanie. */
#define MAX_TRANSCRIPT 200

/** Tytuł i treść przychodzą z telefonu; dłuższe i tak nie zmieszczą się na ekranie. */
#define MAX_TITLE 48
#define MAX_BODY 128

/**
 * Po tylu milisekundach bez odpowiedzi telefonu uznajemy, że nie przyjdzie.
 * Hojnie, bo po drugiej stronie stoi model językowy — a rozpoznanie, które
 * przyszło po dziesięciu sekundach, wciąż jest odpowiedzią.
 */
#define REPLY_TIMEOUT_MS 40000

/** Stany ekranu. Te same wartości wysyła `index.js` w polu STATUS. */
typedef enum {
  /** Brak konfiguracji — bez adresu i tokenu nie ma dokąd wysłać zdania. */
  StatusSetup = 0,
  StatusReady = 1,
  StatusWorking = 2,
  /** Rozpoznane, czeka na potwierdzenie przyciskiem. */
  StatusConfirm = 3,
  StatusSaved = 4,
  /** Model nie wskazał ćwiczenia albo zabrakło liczb — trzeba powtórzyć. */
  StatusUnknown = 5,
  StatusError = 6,
} Status;

/** Polecenia w drugą stronę: telefon trzyma rozpoznaną serię, zegarek decyduje. */
typedef enum {
  CommandSave = 1,
  CommandDiscard = 2,
  CommandCheck = 3,
} Command;

static Window *s_window;
static TextLayer *s_title_layer;
static TextLayer *s_body_layer;
static TextLayer *s_hint_layer;
static AppTimer *s_timeout;

#if defined(PBL_MICROPHONE)
static DictationSession *s_dictation;
#endif

static Status s_status = StatusReady;
static char s_title[MAX_TITLE];
static char s_body[MAX_BODY];
static char s_hint[48];

/* ------------------------------------------------------------------- ekran */

/**
 * Stan bywa ustawiany, **zanim** okno wjedzie na stos — pierwszy komunikat
 * powstaje w `init()`, a warstwy tekstu dopiero w `window_load`. Wtedy nie ma
 * czego przerysowywać i nie jest to błąd: `window_load` domknie to samo, gdy
 * warstwy już będą.
 */
static void render(void) {
  if (s_title_layer == NULL) return;

  text_layer_set_text(s_title_layer, s_title);
  text_layer_set_text(s_body_layer, s_body);
  text_layer_set_text(s_hint_layer, s_hint);
}

/**
 * Podpowiedź zależy od stanu, bo w każdym stanie przyciski znaczą co innego —
 * a zegarek nie ma miejsca na legendę wszystkich naraz.
 */
static void update_hint(void) {
  switch (s_status) {
    case StatusConfirm:
      strncpy(s_hint, "SELECT save  BACK drop", sizeof(s_hint) - 1);
      break;
    case StatusWorking:
      strncpy(s_hint, "waiting for the phone", sizeof(s_hint) - 1);
      break;
    case StatusSetup:
      strncpy(s_hint, "UP check connection", sizeof(s_hint) - 1);
      break;
    default:
      strncpy(s_hint, "SELECT talk  UP check", sizeof(s_hint) - 1);
      break;
  }
  s_hint[sizeof(s_hint) - 1] = '\0';
}

static void set_state(Status status, const char *title, const char *body) {
  s_status = status;

  strncpy(s_title, title, sizeof(s_title) - 1);
  s_title[sizeof(s_title) - 1] = '\0';
  strncpy(s_body, body == NULL ? "" : body, sizeof(s_body) - 1);
  s_body[sizeof(s_body) - 1] = '\0';

  update_hint();
  render();
}

/* -------------------------------------------------------------- oczekiwanie */

static void timeout_expired(void *context) {
  s_timeout = NULL;
  set_state(StatusError, "No answer", "The phone stayed quiet. Check the connection with UP.");
  vibes_double_pulse();
}

static void start_timeout(void) {
  if (s_timeout != NULL) app_timer_cancel(s_timeout);
  s_timeout = app_timer_register(REPLY_TIMEOUT_MS, timeout_expired, NULL);
}

static void cancel_timeout(void) {
  if (s_timeout == NULL) return;
  app_timer_cancel(s_timeout);
  s_timeout = NULL;
}

/* ------------------------------------------------------------- komunikacja */

static void send_failed(void) {
  cancel_timeout();
  set_state(StatusError, "Phone unreachable", "The watch could not talk to the phone app.");
  vibes_double_pulse();
}

static void send_transcript(const char *text) {
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) {
    send_failed();
    return;
  }

  dict_write_cstring(out, MESSAGE_KEY_TRANSCRIPT, text);
  if (app_message_outbox_send() != APP_MSG_OK) {
    send_failed();
    return;
  }

  set_state(StatusWorking, "Recognising…", text);
  start_timeout();
}

static void send_command(Command command, const char *title) {
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) {
    send_failed();
    return;
  }

  dict_write_uint8(out, MESSAGE_KEY_COMMAND, (uint8_t)command);
  if (app_message_outbox_send() != APP_MSG_OK) {
    send_failed();
    return;
  }

  set_state(StatusWorking, title, "");
  start_timeout();
}

static void inbox_received(DictionaryIterator *iterator, void *context) {
  Tuple *status = dict_find(iterator, MESSAGE_KEY_STATUS);
  if (status == NULL) return;

  Tuple *title = dict_find(iterator, MESSAGE_KEY_TITLE);
  Tuple *body = dict_find(iterator, MESSAGE_KEY_BODY);

  cancel_timeout();
  set_state((Status)status->value->uint8, title == NULL ? "" : title->value->cstring,
            body == NULL ? NULL : body->value->cstring);

  // Wibracja niesie tę samą informację co ekran, tylko do kieszeni: seria
  // zapisana w trakcie serii następnej nie wymaga wtedy spojrzenia na zegarek.
  if (s_status == StatusSaved) {
    vibes_short_pulse();
  } else if (s_status == StatusError || s_status == StatusUnknown) {
    vibes_double_pulse();
  }
}

static void outbox_failed(DictionaryIterator *iterator, AppMessageResult reason, void *context) {
  send_failed();
}

/* -------------------------------------------------------------- dyktowanie */

#if defined(PBL_MICROPHONE)

static const char *dictation_problem(DictationSessionStatus status) {
  switch (status) {
    case DictationSessionStatusFailureTranscriptionRejected:
    case DictationSessionStatusFailureTranscriptionRejectedWithError:
      return "Nothing was recognised — say it again.";
    case DictationSessionStatusFailureSystemAborted:
      return "The system stopped the dictation.";
    case DictationSessionStatusFailureNoSpeechDetected:
      return "I heard silence.";
    case DictationSessionStatusFailureConnectivityError:
      return "The watch has no connection to the phone.";
    case DictationSessionStatusFailureDisabled:
      return "Dictation is switched off on this watch.";
    case DictationSessionStatusFailureInternalError:
      return "The dictation service failed.";
    case DictationSessionStatusFailureRecognizerError:
      return "The speech service could not be reached.";
    default:
      return "Dictation did not finish.";
  }
}

static void dictation_finished(DictationSession *session, DictationSessionStatus status,
                               char *transcription, void *context) {
  if (status != DictationSessionStatusSuccess) {
    set_state(StatusError, "No dictation", dictation_problem(status));
    vibes_double_pulse();
    return;
  }

  send_transcript(transcription);
}

static void start_dictation(void) {
  if (s_dictation == NULL) {
    // Potwierdzenie zostaje włączone (wartość domyślna) — patrz nagłówek pliku.
    s_dictation = dictation_session_create(MAX_TRANSCRIPT, dictation_finished, NULL);
  }
  if (s_dictation == NULL) {
    set_state(StatusError, "No dictation", "This watch cannot start a dictation session.");
    return;
  }

  dictation_session_start(s_dictation);
}

#else

/**
 * Zegarek bez mikrofonu — Pebble Classic i Steel. Aplikacja i tak się instaluje,
 * bo sprawdzenie połączenia działa wszędzie i jest tu najbardziej przydatne:
 * mówi, czy problemem jest sprzęt, czy sieć.
 */
static void start_dictation(void) {
  set_state(StatusError, "No microphone", "This Pebble has no microphone — dictate from the phone.");
  vibes_double_pulse();
}

#endif

/* ---------------------------------------------------------------- przyciski */

static void select_clicked(ClickRecognizerRef recognizer, void *context) {
  if (s_status == StatusWorking) return;

  if (s_status == StatusConfirm) {
    send_command(CommandSave, "Saving…");
    return;
  }

  start_dictation();
}

static void up_clicked(ClickRecognizerRef recognizer, void *context) {
  if (s_status == StatusWorking) return;
  send_command(CommandCheck, "Checking…");
}

/**
 * `BACK` w stanie potwierdzenia **odrzuca** rozpoznaną serię zamiast wyjść
 * z aplikacji: wyjście zostawiłoby ją wiszącą po stronie telefonu, a użytkownik
 * i tak nacisnął ten przycisk, żeby powiedzieć „nie to".
 */
static void back_clicked(ClickRecognizerRef recognizer, void *context) {
  if (s_status == StatusConfirm) {
    send_command(CommandDiscard, "Dropping…");
    return;
  }

  window_stack_pop_all(true);
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_clicked);
  window_single_click_subscribe(BUTTON_ID_UP, up_clicked);
  window_single_click_subscribe(BUTTON_ID_BACK, back_clicked);
}

/* --------------------------------------------------------------------- okno */

static TextLayer *make_layer(Layer *parent, GRect frame, const char *font, GColor color) {
  TextLayer *layer = text_layer_create(frame);
  text_layer_set_background_color(layer, GColorClear);
  text_layer_set_text_color(layer, color);
  text_layer_set_font(layer, fonts_get_system_font(font));
  text_layer_set_text_alignment(layer, GTextAlignmentCenter);
  layer_add_child(parent, text_layer_get_layer(layer));
  return layer;
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);

  // Okrągły ekran (chalk) obcina rogi, więc treść dostaje tam większy margines.
  const int16_t inset = PBL_IF_ROUND_ELSE(18, 6);
  const int16_t width = bounds.size.w - inset * 2;

  s_title_layer = make_layer(root, GRect(inset, PBL_IF_ROUND_ELSE(24, 12), width, 28),
                             FONT_KEY_GOTHIC_24_BOLD, GColorWhite);
  s_body_layer = make_layer(root, GRect(inset, PBL_IF_ROUND_ELSE(54, 44), width, 80),
                            FONT_KEY_GOTHIC_18, GColorWhite);
  s_hint_layer = make_layer(root, GRect(inset, bounds.size.h - PBL_IF_ROUND_ELSE(34, 24), width, 20),
                            FONT_KEY_GOTHIC_14, PBL_IF_COLOR_ELSE(GColorLightGray, GColorWhite));

  text_layer_set_overflow_mode(s_body_layer, GTextOverflowModeTrailingEllipsis);
  render();
}

static void window_unload(Window *window) {
  text_layer_destroy(s_title_layer);
  text_layer_destroy(s_body_layer);
  text_layer_destroy(s_hint_layer);
  s_title_layer = NULL;
  s_body_layer = NULL;
  s_hint_layer = NULL;
}

/* --------------------------------------------------------------------- start */

static void init(void) {
  // Stan startowy jest **oczekiwaniem**, a nie gotowością: telefon odezwie się
  // za chwilę i dopiero on wie, czy aplikacja jest skonfigurowana.
  set_state(StatusWorking, "AlphaPump", "Talking to the phone…");

  app_message_register_inbox_received(inbox_received);
  app_message_register_outbox_failed(outbox_failed);
  // Wejście musi pomieścić tytuł i treść; wyjście — jedno zdanie z dyktowania.
  app_message_open(512, 256);

  s_window = window_create();
  window_set_background_color(s_window, PBL_IF_COLOR_ELSE(GColorFromHEX(0x232327), GColorBlack));
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
                                           .load = window_load,
                                           .unload = window_unload,
                                       });
  window_stack_push(s_window, true);

  start_timeout();
}

static void deinit(void) {
  cancel_timeout();
#if defined(PBL_MICROPHONE)
  if (s_dictation != NULL) dictation_session_destroy(s_dictation);
#endif
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
  return 0;
}

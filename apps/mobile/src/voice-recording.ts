/**
 * Ustawienia nagrywania.
 *
 * Osobno od ekranu, bo to są **liczby z uzasadnieniem**, a nie widok — i osobno
 * od reszty dyktowania, bo jako jedyny moduł tej funkcji sięga po `expo-audio`,
 * czyli po warstwę natywną. Wszystko, co da się sprawdzić bez mikrofonu, leży
 * poza tym plikiem.
 */

import { RecordingPresets, type RecordingOptions } from 'expo-audio';

/**
 * Jakość nagrania dobrana pod **mowę**, a nie pod muzykę.
 *
 * Presety `expo-audio` celują w nagranie dźwięku: 44,1 kHz, stereo, 128 kbit/s.
 * Dla zdania „wyciskanie osiemdziesiąt na osiem" jest to kilkanaście razy więcej
 * bajtów, niż niesie informacji — a płaci za nie telefon stojący na cudzym wi-fi
 * albo na LTE, w chwili, w której użytkownik czeka na odpowiedź. 16 kHz mono to
 * pasmo, na którym pracują modele rozpoznawania mowy; wyższe i tak schodzi u nich
 * do tego samego.
 *
 * Piętnaście sekund waży wtedy około sześćdziesięciu kilobajtów — czyli mieści
 * się w limicie ciała żądania (`BODY_LIMIT_BYTES` w API) z zapasem rzędu
 * wielkości.
 */
export const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
};

/**
 * Po tylu sekundach nagranie kończy się samo.
 *
 * Nie po to, żeby oszczędzić bajty, tylko żeby telefon wsadzony do kieszeni
 * z włączonym mikrofonem nie nagrywał całego treningu — a potem nie wysyłał go
 * do transkrypcji. Jedna seria to zdanie, nie monolog.
 */
export const VOICE_MAX_SECONDS = 30;

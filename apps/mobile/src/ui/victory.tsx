/**
 * Animacja zwycięstwa — pełnoekranowy overlay po serii „więcej niż mason".
 *
 * Zgłoszenie mówi wprost, czego ma to **nie** być: dyskretnego komunikatu
 * sukcesu. Stąd `Modal` nad całym ekranem, a nie zielona linijka w karcie
 * formularza obok „Record improved!" — ta już tam jest i to ona jest tonem,
 * od którego ten overlay ma odstawać.
 *
 * Co się rusza: całość wjeżdża jednym skokiem (`enter`), trofeum i nagłówek
 * pulsują w pętli (`pump`), a wokół nich wybucha okrąg fajerwerków — jedna pętla
 * `burst` dla wszystkich glifów, w której każdy ma swoje okno. Jedna wartość
 * zamiast dwunastu własnych animacji, więc nic nie wymaga synchronizowania
 * i nic nie przerysowuje Reacta w trakcie: pętle chodzą po stronie `Animated`,
 * a komponent renderuje się raz.
 *
 * Kiedy overlay leci i co dokładnie wybucha, rozstrzyga `src/victory.ts`.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, Text, View } from 'react-native';
import {
  VICTORY_BURST_MS,
  VICTORY_HEADLINE,
  VICTORY_MS,
  victoryShout,
  victorySparks,
} from '../victory';

/** Promień okręgu fajerwerków w punktach — tyle, żeby zmieścił się na wąskim telefonie. */
const BURST_RADIUS = 132;

/** Bok glifu wybuchu. */
const SPARK_SIZE = 34;

/**
 * Bok kwadratu, w którym leży cały wybuch: średnica okręgu plus glif, który
 * z niego wystaje. Kwadrat ma jawny rozmiar, a nie zerowy, bo Android przycina
 * to, co dziecko narysuje poza rodzicem — przy zerowym nie byłoby widać nic.
 */
const BURST_FIELD = BURST_RADIUS * 2 + SPARK_SIZE * 2;

/** Długość pętli wybuchu. Dosypywanie glifów plus chwila ciszy, zanim wybuchnie znowu. */
const BURST_LOOP_MS = VICTORY_BURST_MS + 500;

/** Szerokość okna jednego glifu w pętli, w ułamku jej długości. */
const SPARK_WINDOW = 0.3;

/**
 * Sterownik natywny jest wyłączony w testach, bo te jadą na `react-native-web`,
 * gdzie modułu natywnego nie ma i każda animacja dorzucałaby ostrzeżenie.
 * Na telefonie przesunięcia i przezroczystości liczy warstwa natywna.
 */
const NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * `round` rośnie z każdą animacją i wybiera okrzyk; `onDone` musi być stabilne,
 * bo od niego wisi odliczanie do samoczynnego zejścia overlayu.
 */
export function VictoryOverlay({ round, onDone }: { round: number; onDone: () => void }) {
  const enter = useRef(new Animated.Value(0)).current;
  const pump = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const sparks = useMemo(() => victorySparks(), []);

  useEffect(() => {
    const entrance = Animated.timing(enter, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.back(2.2)),
      useNativeDriver: NATIVE_DRIVER,
    });
    const pumping = Animated.loop(
      Animated.sequence([
        Animated.timing(pump, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.quad),
          useNativeDriver: NATIVE_DRIVER,
        }),
        Animated.timing(pump, {
          toValue: 0,
          duration: 340,
          easing: Easing.in(Easing.quad),
          useNativeDriver: NATIVE_DRIVER,
        }),
      ]),
    );
    const bursting = Animated.loop(
      Animated.timing(burst, {
        toValue: 1,
        duration: BURST_LOOP_MS,
        easing: Easing.linear,
        useNativeDriver: NATIVE_DRIVER,
      }),
    );

    entrance.start();
    pumping.start();
    bursting.start();
    const timer = setTimeout(onDone, VICTORY_MS);

    return () => {
      entrance.stop();
      pumping.stop();
      bursting.stop();
      clearTimeout(timer);
    };
  }, [enter, pump, burst, onDone]);

  const pumped = pump.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onDone}>
      {/* Tapnięcie gdziekolwiek zamyka animację od razu — kto jest w połowie
          następnego podejścia, nie ma czekać na fajerwerki. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss the celebration"
        className="flex-1 items-center justify-center bg-black/85 p-6"
        onPress={onDone}
      >
        {/* Układ animowanych warstw idzie przez `style`, a nie przez `className`:
            NativeWind tłumaczy klasy na komponentach, które zna, a `Animated.View`
            jest opakowaniem spoza tej listy — klasa przeszłaby tu bez efektu. */}
        <Animated.View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            opacity: enter,
            transform: [
              { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
            ],
          }}
        >
          {/* Okrąg fajerwerków leży pod napisami, w warstwie bezwzględnej, więc
              nie rozpycha karty i nie przesuwa nagłówka, gdy glify rosną. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              width: BURST_FIELD,
              height: BURST_FIELD,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {sparks.map((spark, index) => {
              const start = spark.delayMs / BURST_LOOP_MS;
              const peak = start + SPARK_WINDOW / 2;
              const end = start + SPARK_WINDOW;
              const radians = (spark.angle * Math.PI) / 180;
              const radius = BURST_RADIUS * spark.radiusRatio;

              return (
                <Animated.Text
                  key={`${spark.glyph}-${String(index)}`}
                  style={{
                    position: 'absolute',
                    fontSize: SPARK_SIZE,
                    opacity: burst.interpolate({
                      inputRange: [0, start, peak, end, 1],
                      outputRange: [0, 0, 1, 0, 0],
                    }),
                    transform: [
                      { translateX: Math.sin(radians) * radius },
                      { translateY: -Math.cos(radians) * radius },
                      {
                        scale: burst.interpolate({
                          inputRange: [0, start, peak, end, 1],
                          outputRange: [0.4, 0.4, 1.3, 0.7, 0.7],
                        }),
                      },
                    ],
                  }}
                >
                  {spark.glyph}
                </Animated.Text>
              );
            })}
          </View>

          <Animated.View style={{ alignItems: 'center', transform: [{ scale: pumped }] }}>
            <Text className="text-6xl">🏆</Text>
            <Text className="text-center text-4xl font-black uppercase text-accent">
              {VICTORY_HEADLINE}
            </Text>
          </Animated.View>

          <Text className="mt-2 text-center text-lg font-semibold text-text">
            {victoryShout(round)}
          </Text>
          <Text className="mt-3 text-3xl">🎺 💪 🎆 💪 🎺</Text>
          <Text className="mt-4 text-xs text-muted">tap to carry on</Text>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

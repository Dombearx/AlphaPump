/**
 * Babel.
 *
 * Trzy rzeczy muszą tu być i każda z innego powodu:
 *
 * - `jsxImportSource: 'nativewind'` — bez niego `className` na komponentach
 *   React Native jest zwykłym, ignorowanym propsem i style po prostu nie
 *   działają, bez żadnego błędu.
 * - preset `nativewind/babel` — przetwarza `global.css` na style.
 * - `react-native-worklets/plugin` — Reanimated 4 przeniósł swój plugin do
 *   pakietu worklets. Musi być **ostatni** na liście.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: ['react-native-worklets/plugin'],
  };
};

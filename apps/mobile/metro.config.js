/**
 * Metro w monorepo.
 *
 * Domyślna konfiguracja patrzy wyłącznie w katalog aplikacji, a pakiety
 * `@alphapump/core` i `@alphapump/db` leżą piętro wyżej. Bez `watchFolders`
 * zmiana w rdzeniu nie odświeżyłaby aplikacji, a bez `nodeModulesPaths`
 * bundler nie znalazłby zależności podniesionych do korzenia workspace'a.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = withNativeWind(config, { input: './global.css' });

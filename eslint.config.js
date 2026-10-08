const js = require('@eslint/js');
const globals = require('globals');

const rules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'prefer-const': 'error',
  'no-var': 'error',
  eqeqeq: ['error', 'smart'],
  'no-throw-literal': 'off', // la interfaz lanza { code } a propósito para los errores conocidos
};

module.exports = [
  { ignores: ['node_modules/', 'coverage/', 'dist/', 'out/'] },
  js.configs.recommended,
  {
    // Proceso principal, preload, hooks, scripts y pruebas: Node con CommonJS.
    files: ['**/*.js'],
    ignores: ['renderer/**'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
  {
    // Interfaz: módulos ES en el navegador de Electron.
    files: ['renderer/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
    rules,
  },
];

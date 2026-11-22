import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['log', 'error'] }],
    },
  },
  // Server, script e test: Node.js
  {
    files: ['server/**/*.js', 'scripts/**/*.js', 'test/**/*.js', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  // Client: browser, con la libreria Socket.IO caricata dal server come variabile globale `io`
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.browser, io: 'readonly' } },
  },
  // Dati condivisi: devono funzionare sia nel browser sia in Node, senza globali specifici
  {
    files: ['shared/**/*.js'],
    languageOptions: { globals: {} },
  },
  prettier,
];

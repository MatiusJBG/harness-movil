// Configuración ESLint (flat config) del puente seguro PC-telefono.
// Recoge las reglas del plan de arquitectura limpia: capas estrictas en
// src/domain, src/application, src/adapters, src/config, src/composition y
// src/cli, y reglas de tamaño/complejidad solo para esas capas nuevas.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/** TypeScript de producción del puente. */
const BRIDGE_SRC = ['apps/bridge/src/**/*.ts']

/** Pruebas. */
const BRIDGE_TESTS = ['apps/bridge/tests/**/*.ts']

/** Capas nuevas con arquitectura estricta. */
const BRIDGE_NEW_LAYERS = [
  'apps/bridge/src/domain/**/*.ts',
  'apps/bridge/src/application/**/*.ts',
  'apps/bridge/src/adapters/**/*.ts',
  'apps/bridge/src/config/**/*.ts',
  'apps/bridge/src/composition/**/*.ts',
  'apps/bridge/src/cli/**/*.ts',
]

/** JavaScript servido al navegador. */
const BRIDGE_PUBLIC_JS = ['apps/bridge/public/**/*.js']

/** Scripts y configuración del propio repo. */
const TOOLING_JS = ['*.mjs', '*.cjs', 'scripts/**/*.mjs']

/** Aplica un conjunto de configs solo a los archivos indicados. */
const scopeTo = (files, configs) => configs.map((config) => ({ ...config, files }))

const NODE_GLOBALS = {
  __dirname: 'readonly',
  __filename: 'readonly',
  AbortController: 'readonly',
  Buffer: 'readonly',
  clearImmediate: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  exports: 'writable',
  fetch: 'readonly',
  module: 'writable',
  performance: 'readonly',
  process: 'readonly',
  queueMicrotask: 'readonly',
  require: 'readonly',
  setImmediate: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  WebSocket: 'readonly',
}

const BROWSER_GLOBALS = {
  AbortController: 'readonly',
  alert: 'readonly',
  Blob: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  confirm: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  CustomEvent: 'readonly',
  document: 'readonly',
  EventSource: 'readonly',
  fetch: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  getComputedStyle: 'readonly',
  Headers: 'readonly',
  history: 'readonly',
  HTMLElement: 'readonly',
  Image: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  navigator: 'readonly',
  Node: 'readonly',
  performance: 'readonly',
  prompt: 'readonly',
  queueMicrotask: 'readonly',
  requestAnimationFrame: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  sessionStorage: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  WebSocket: 'readonly',
  window: 'readonly',
}

/** Paquetes vetados en dominio y aplicación: son detalles de infraestructura. */
const FORBIDDEN_IMPORTS = [
  { group: ['node:*'], message: 'Dominio y aplicación no dependen del runtime de Node.' },
  { group: ['zod', 'zod/*'], message: 'La validación con zod corresponde a los adaptadores.' },
  { group: ['http-proxy', 'http-proxy/*'], message: 'http-proxy es un detalle de adaptador.' },
  { group: ['qrcode', 'qrcode/*'], message: 'qrcode es un detalle de adaptador.' },
  { group: ['node-forge', 'node-forge/*'], message: 'node-forge es un detalle de adaptador.' },
]

export default [
  {
    ignores: [
      'node_modules/**',
      'apps/bridge/dist/**',
      'test-dist/**',
      'coverage/**',
      'android/**',
      '.tmp/**',
      'docs/**',
    ],
  },
  // Producción: reglas estrictas con tipos.
  ...scopeTo(BRIDGE_SRC, [
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
  ]),
  {
    files: BRIDGE_SRC,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: NODE_GLOBALS,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Límites de diseño transversales.
      'max-depth': ['error', 4],
      'max-params': ['error', 5],

      // Contratos explícitos y manejo de promesas.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: BRIDGE_NEW_LAYERS,
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      complexity: ['error', 15],
    },
  },
  // Pruebas: se relajan las reglas que no aportan valor en pruebas.
  ...scopeTo(BRIDGE_TESTS, [js.configs.recommended, ...tseslint.configs.recommended]),
  {
    files: BRIDGE_TESTS,
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // testkit es una fachada mínima de node:test que mantiene @ts-nocheck.
    files: ['apps/bridge/tests/helpers/testkit.ts'],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  {
    files: ['apps/bridge/src/domain/**/*.ts', 'apps/bridge/src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: FORBIDDEN_IMPORTS }],
    },
  },
  {
    files: BRIDGE_PUBLIC_JS,
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: BROWSER_GLOBALS,
    },
    rules: {
      'no-useless-assignment': 'off',
    },
  },
  {
    files: TOOLING_JS,
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: NODE_GLOBALS,
    },
  },
  {
    files: ['*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
]

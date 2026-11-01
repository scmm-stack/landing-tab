import tseslint from 'typescript-eslint';

const NETWORK_MESSAGE =
  'Network access is only allowed in src/lib/favicon.ts. This extension keeps data on the device.';

const networkGlobals = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker'];

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'public/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...networkGlobals.map((name) => ({ name, message: NETWORK_MESSAGE })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'sendBeacon', message: NETWORK_MESSAGE },
        { object: 'window', property: 'fetch', message: NETWORK_MESSAGE },
        { object: 'globalThis', property: 'fetch', message: NETWORK_MESSAGE },
        { object: 'self', property: 'fetch', message: NETWORK_MESSAGE },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Image']",
          message: 'new Image() with a remote src is a network request. Use an object URL only.',
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['src/lib/favicon.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/lib/color.ts', 'src/lib/images.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);

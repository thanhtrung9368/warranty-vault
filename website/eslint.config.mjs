import coreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    // Service-worker code runs outside the Next bundle and is tested by
    // `src/lib/__tests__/offline-sw.test.ts` through a vm sandbox.
    ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'public/sw-core.js'],
  },
  ...coreWebVitals,
];

export default config;

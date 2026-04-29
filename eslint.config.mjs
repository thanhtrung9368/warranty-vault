import coreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'public/sw.js'] },
  ...coreWebVitals,
];

export default config;

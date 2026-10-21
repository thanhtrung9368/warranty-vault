import coreWebVitals from 'eslint-config-next/core-web-vitals';

// Typography guard. The app had 18 rendered font sizes, 14 of them arbitrary
// `text-[Npx]` classes; a card title alone rendered at five different sizes.
// The scale lives in `tailwind.config.ts` (12/14/16/18/24/30/36). New code
// must use it. Two files are deliberately exempt:
//
//   * `src/app/page.tsx` + `landing-product.tsx` — the landing page has its own
//     hand-tuned display type and is out of scope for this consolidation.
//   * `components/charts/**` — recharts passes `fontSize` as an SVG attribute
//     (a number, not a class), so the rule would not see it anyway; the
//     exemption documents that those sizes are chart internals, not UI type.
//
// CSS custom-property sizes in `globals.css` are outside ESLint's scope; that
// file was migrated by hand and should stay on the same scale.
const NO_ARBITRARY_TYPE = [
  {
    selector: 'Literal[value=/text-\\[\\d+px\\]/]',
    message:
      'Arbitrary text-[Npx] is banned. Use the fontSize scale (text-xs/sm/base/lg/2xl/3xl/4xl); add a step in tailwind.config.ts if the design genuinely needs one.',
  },
  {
    selector: 'TemplateElement[value.raw=/text-\\[\\d+px\\]/]',
    message:
      'Arbitrary text-[Npx] is banned. Use the fontSize scale (text-xs/sm/base/lg/2xl/3xl/4xl); add a step in tailwind.config.ts if the design genuinely needs one.',
  },
];

const config = [
  {
    // Service-worker code runs outside the Next bundle and is tested by
    // `src/lib/__tests__/offline-sw.test.ts` through a vm sandbox.
    ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'public/sw-core.js'],
  },
  ...coreWebVitals,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/app/page.tsx',
      'src/components/landing-product.tsx',
      'src/components/charts/**',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...NO_ARBITRARY_TYPE],
    },
  },
];

export default config;

// Pure-JS unit tests for the data / format / classifier / chart-plugin
// layers. Lit DOM / Chart.js orchestration / editor paths are out of
// scope until v1.3 (Playwright E2E + visual regression — issue #14);
// see TESTING.md.
//
// Coverage thresholds are gated in CI (npm run coverage in build.yml).
// Failing any threshold fails the build — we don't want silent
// regressions in the modules we DO claim test coverage for.
export default {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      include: [
        'src/condition-classifier.js',
        'src/data-source.js',
        'src/format-utils.js',
        'src/forecast-utils.js',
        'src/sunshine-source.js',
        'src/openmeteo-source.js',
        'src/chart/plugins.js',
        'src/scroll-ux.js',
        'src/action-handler.js',
        'src/teardown-registry.js',
        'src/utils/safe-query.js',
        'src/utils/numeric.js',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
};

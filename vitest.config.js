// Unit tests for the data / format / classifier / chart-plugin layers.
// Lit DOM / Chart.js orchestration / editor render paths covered by
// Playwright E2E (#14); see TESTING.md.
//
// Coverage thresholds gated in CI (npm run coverage in build.yml).
// Pre-v1.4.2 the include array listed .js paths after the v1.2 .ts
// migration; v8 matched zero files and the gate was silently inert.
// Paths are .ts now.
export default {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'lcov'],
      include: [
        'src/condition-classifier.ts',
        'src/data-source.ts',
        'src/format-utils.ts',
        'src/forecast-utils.ts',
        'src/sunshine-source.ts',
        'src/openmeteo-source.ts',
        'src/chart/plugins.ts',
        'src/scroll-ux.ts',
        'src/action-handler.ts',
        'src/teardown-registry.ts',
        'src/utils/safe-query.ts',
        'src/utils/numeric.ts',
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

// Pure-JS unit tests for the data layer and formatting helpers. Lit / DOM /
// Chart.js paths are out of scope (see TESTING.md). Node environment is
// enough for the modules we cover.
export default {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: [
        'src/condition-classifier.js',
        'src/data-source.js',
        'src/format-utils.js',
      ],
    },
  },
};

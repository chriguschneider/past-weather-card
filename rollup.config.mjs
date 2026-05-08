import resolve from 'rollup-plugin-node-resolve';
import serve from 'rollup-plugin-serve';
import copy from 'rollup-plugin-copy';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const dev = process.env.ROLLUP_WATCH;

// Inline plugin: substitutes the literal '__CARD_VERSION__' in main.ts
// with the package.json version at build time. Avoids the manual
// release-time bump dance for the console banner — package.json is the
// single source of truth. Tests run on the unsubstituted source where
// the banner reads "v__CARD_VERSION__"; harmless because no test
// inspects that string.
const injectCardVersion = {
  name: 'inject-card-version',
  transform(code, id) {
    if (!id.endsWith('main.ts')) return null;
    const replaced = code.replaceAll("'__CARD_VERSION__'", JSON.stringify(pkg.version));
    return replaced === code ? null : { code: replaced, map: null };
  },
};

const serveopts = {
  contentBase: ['./dist'],
  host: '0.0.0.0',
  port: 5000,
  allowCrossOrigin: true,
  headers: {
    'Access-Control-Allow-Origin': '*',
  },
};

export default {
  input: 'src/main.ts',
  output: {
    file: 'dist/weather-station-card.js',
    format: 'cjs',
    name: 'WeatherStationCard',
    sourcemap: dev ? true : false,
  },
  plugins: [
    // Version-string substitution runs before TS so the placeholder
    // disappears before any downstream pass sees it. Idempotent — only
    // touches main.ts, only matches the exact placeholder literal.
    injectCardVersion,
    // TypeScript first so it sees raw .ts/.tsx and emits ESM JS for
    // the rest of the pipeline. allowJs=true (in tsconfig) lets us
    // migrate one file at a time during v1.2 — .js files pass through
    // unchanged. noEmitOnError stays false so a type error is a CI
    // signal but doesn't stall a local watch build.
    typescript({
      tsconfig: './tsconfig.json',
      noEmitOnError: false,
      // Rollup emits the bundle; we only want type checking + transpile
      // here, no separate .d.ts output.
      compilerOptions: {
        noEmit: false,
        declaration: false,
        sourceMap: dev ? true : false,
      },
    }),
    resolve(),
    dev && serve(serveopts),
    copy({
      targets: [
        { src: 'src/icons/*', dest: 'dist/icons' },
      ]
    }),
    // Production minification (skipped in dev/watch so source maps stay
    // readable). Drops bundle from ~800 KB unminified to ~250-300 KB —
    // halves bytes-on-the-wire even after HA's gzip layer. Class names
    // preserved so HA's "Add card from Lovelace UI" finds the custom
    // element registration; function names are mangled.
    !dev && terser({
      format: { comments: false },
      compress: { passes: 2 },
      mangle: { keep_classnames: true, keep_fnames: false },
    }),
  ].filter(Boolean),
};

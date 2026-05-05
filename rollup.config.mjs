import resolve from 'rollup-plugin-node-resolve';
import serve from 'rollup-plugin-serve';
import copy from 'rollup-plugin-copy';
import terser from '@rollup/plugin-terser';

const dev = process.env.ROLLUP_WATCH;

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
  input: 'src/main.js',
  output: {
    file: 'dist/weather-station-card.js',
    format: 'cjs',
    name: 'WeatherStationCard',
    sourcemap: dev ? true : false,
  },
  plugins: [
    resolve(),
    dev && serve(serveopts),
    copy({
      targets: [
        { src: 'src/icons/*', dest: 'dist/icons' },
        { src: 'src/icons2/*', dest: 'dist/icons2' }
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

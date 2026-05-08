// One-off helper: extract violations of a given ESLint rule grouped by file.
// Removed after the v1.10 mechanical sweep.
import { execSync } from 'node:child_process';

const rule = process.argv[2] || '@typescript-eslint/prefer-nullish-coalescing';
const raw = execSync('npx eslint src/ -f json', { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
const data = JSON.parse(raw);
const byFile = {};
for (const f of data) {
  for (const m of f.messages) {
    if (m.ruleId !== rule) continue;
    const rel = f.filePath.split(/[\\/]src[\\/]/).pop();
    const file = 'src/' + rel.replace(/\\/g, '/');
    byFile[file] = byFile[file] || [];
    byFile[file].push({ line: m.line, col: m.column });
  }
}
for (const f of Object.keys(byFile).sort()) {
  const locs = byFile[f].map(x => `${x.line}:${x.col}`).join(', ');
  console.log(`${f} (${byFile[f].length}): ${locs}`);
}

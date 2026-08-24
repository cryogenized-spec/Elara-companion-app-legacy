import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedProcessEnvFiles = new Set([
  'server/services/lockbox.ts',
  'background-runtime/lockbox.ts',
  'scripts/automation-lockbox.mjs',
]);
const approvedPublicBrowserCompatibilityFiles = new Set([
  // googleApi keeps a guarded legacy fallback for the public Google OAuth client id.
  'src/lib/googleApi.ts',
]);
const ignoredDirectories = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

const violations = [];
for (const file of walk(root)) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  if (allowedProcessEnvFiles.has(relative) || approvedPublicBrowserCompatibilityFiles.has(relative)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/\bprocess\.env\s*(?:\.|\[)/.test(line)) {
      violations.push(`${relative}:${index + 1}: direct process.env access outside Lockbox adapters`);
    }
  });
}

if (violations.length) {
  console.error('Lockbox audit failed. Direct environment access must use an approved adapter:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Lockbox source audit passed: no direct process.env access outside approved adapters.');

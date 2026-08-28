import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md', '.env']);
const allowedPublicConfigFiles = new Set([
  // Firebase Web SDK config intentionally contains a client-side API key.
  'firebase-applet-config.json',
]);
const patterns = [
  { name: 'Google API key', regex: /AIza[0-9A-Za-z_-]{30,}/g },
  { name: 'GitHub token', regex: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
  { name: 'Google OAuth secret marker', regex: /GOCSPX-[A-Za-z0-9_-]{20,}/g },
  { name: 'Private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (extensions.has(path.extname(entry.name)) || entry.name.startsWith('.env')) files.push(full);
  }
  return files;
}

const findings = [];
for (const file of walk(root)) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  if (relative === '.env.example' || allowedPublicConfigFiles.has(relative)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    if (pattern.regex.test(text)) findings.push(`${relative}: potential ${pattern.name} detected`);
    pattern.regex.lastIndex = 0;
  }
}

if (findings.length) {
  console.error('Lockbox secret scan failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('Lockbox secret scan passed: no known credential material detected in tracked source/config text.');

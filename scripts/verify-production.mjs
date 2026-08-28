import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const required = ['dist/index.html', 'dist/server.cjs'];

for (const file of required) {
  try {
    await access(file);
  } catch {
    console.error(`[verify:production] Missing build output: ${file}`);
    process.exit(1);
  }
}

const server = spawn(process.execPath, ['dist/server.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', (chunk) => { output += chunk.toString(); });
server.stderr.on('data', (chunk) => { output += chunk.toString(); });

const deadline = Date.now() + 15_000;
let healthy = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch('http://127.0.0.1:3000/');
    if (response.ok) {
      healthy = true;
      break;
    }
  } catch {
    // Server is still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

server.kill('SIGTERM');

if (!healthy) {
  console.error('[verify:production] Production server did not become ready on port 3000.');
  if (output.trim()) console.error(output.trim());
  process.exit(1);
}

console.log('[verify:production] Build outputs present and production server responded successfully.');

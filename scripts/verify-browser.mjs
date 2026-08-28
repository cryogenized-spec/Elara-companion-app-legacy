import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['dist/server.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', (chunk) => { output += chunk.toString(); });
server.stderr.on('data', (chunk) => { output += chunk.toString(); });

try {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:3000/');
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await desktop.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const selector = desktop.locator('button[aria-haspopup="listbox"]');
    await selector.waitFor({ state: 'visible', timeout: 10_000 });

    const selectorBox = await selector.boundingBox();
    const composerFooter = desktop.locator('textarea[placeholder="Message Elara..."]').locator('..').locator('..').locator('..');
    const footerBox = await composerFooter.boundingBox();
    if (!selectorBox || !footerBox) throw new Error('Model selector/footer was not measurable.');
    if (selectorBox.x < footerBox.x || selectorBox.x + selectorBox.width > footerBox.x + footerBox.width) {
      throw new Error('Model selector is outside the composer footer bounds.');
    }

    await selector.click();
    const menu = desktop.locator('[role="listbox"][aria-label="Preferred models"]');
    await menu.waitFor({ state: 'visible' });
    const menuBox = await menu.boundingBox();
    if (!menuBox) throw new Error('Model menu was not measurable.');
    if (menuBox.y + menuBox.height > selectorBox.y + 2) throw new Error('Model menu did not open upward.');
    if (menuBox.x < 0 || menuBox.x + menuBox.width > 1440) throw new Error('Desktop model menu exceeds viewport bounds.');
    await desktop.keyboard.press('Escape');
    if (await menu.isVisible()) throw new Error('Escape did not close model menu.');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await mobile.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    const mobileSelector = mobile.locator('button[aria-haspopup="listbox"]');
    await mobileSelector.waitFor({ state: 'visible', timeout: 10_000 });
    const mobileBox = await mobileSelector.boundingBox();
    if (!mobileBox || mobileBox.x < 0 || mobileBox.x + mobileBox.width > 390) throw new Error('Mobile model selector exceeds viewport bounds.');
    await mobileSelector.click();
    const mobileMenu = mobile.locator('[role="listbox"][aria-label="Preferred models"]');
    await mobileMenu.waitFor({ state: 'visible' });
    const mobileMenuBox = await mobileMenu.boundingBox();
    if (!mobileMenuBox || mobileMenuBox.x < 0 || mobileMenuBox.x + mobileMenuBox.width > 390) throw new Error('Mobile model menu exceeds viewport bounds.');

    const configuredLabels = await mobile.locator('[role="option"]').allTextContents();
    if (!configuredLabels.some((label) => label.includes('Gemini 3.7 Flash'))) throw new Error('Preferred model label is not visible.');

    console.log('[verify:browser] Desktop/mobile model selector geometry and upward menu behavior passed.');
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error('[verify:browser] Browser proving failed:', error?.message || error);
  if (output.trim()) console.error(output.trim());
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
}

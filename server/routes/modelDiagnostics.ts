import type express from 'express';

const GOOGLE_STATUS_URL = 'https://status.cloud.google.com/';
const REQUEST_TIMEOUT_MS = 6000;

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || 'Google Cloud status page';
}

export function setupModelDiagnosticsRoutes(app: express.Express) {
  app.get('/api/model-diagnostics/online', async (_req, res) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(GOOGLE_STATUS_URL, {
        headers: { 'user-agent': 'Elara-Companion-Diagnostics/1.0' },
        signal: controller.signal,
      });
      const html = await response.text();
      const title = extractTitle(html);
      return res.json({
        ok: response.ok,
        source: GOOGLE_STATUS_URL,
        summary: response.ok
          ? `Provider status page reachable (${response.status}). Page title: ${title}.`
          : `Provider status page responded with HTTP ${response.status}. Page title: ${title}.`,
      });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        source: GOOGLE_STATUS_URL,
        summary: `Provider status check failed: ${error instanceof Error ? error.message : 'unknown network error'}.`,
      });
    } finally {
      clearTimeout(timer);
    }
  });
}

import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMultimodalFactCheck } from './server/factCheckService.ts';
import { handleTelegramWebhookUpdate, registerTelegramWebhook } from './server/telegramService.ts';
import { extractUrlMediaInMemory } from './server/urlMediaExtractor.ts';
import type { FactCheckApiRequest } from './src/types/factCheck.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrapTelegramWebhookIfConfigured() {
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const appUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');

  if (!botToken || !appUrl || appUrl === 'MY_APP_URL') {
    return;
  }

  try {
    const webhookUrl = `${appUrl}/api/telegram/webhook`;
    const res = await registerTelegramWebhook(botToken, webhookUrl);
    console.log(
      `[SaringFakta Server] Telegram Bot @${res.botUsername || 'bot'} automatically linked to ${webhookUrl}`
    );
  } catch (err) {
    console.warn(
      '[SaringFakta Server] Auto-registration of Telegram webhook skipped/failed:',
      err instanceof Error ? err.message : err
    );
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '28mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
    });
  });

  app.post('/api/url-preview', async (req: Request, res: Response) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Parameter URL wajib diisi.' });
        return;
      }
      const extracted = await extractUrlMediaInMemory(url);
      res.json({ metadata: extracted.metadata });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal membaca metadata URL.';
      console.error('[/api/url-preview] Error:', message);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/fact-check', async (req: Request, res: Response) => {
    try {
      const payload = req.body as FactCheckApiRequest;
      if (!payload.text?.trim() && !payload.url?.trim() && !payload.media?.data) {
        res.status(400).json({
          error: 'Masukkan tautan URL (Reels/TikTok/Berita), klaim teks, atau unggah foto/video untuk diperiksa.',
        });
        return;
      }

      const result = await runMultimodalFactCheck({
        text: payload.text,
        url: payload.url,
        media: payload.media,
        mode: payload.mode || 'deep',
        previousContext: payload.previousContext,
      });

      res.json(result);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Terjadi gangguan saat memproses pemeriksaan fakta. Silakan coba lagi.';
      console.error('[/api/fact-check] Error:', err);
      res.status(500).json({ error: message });
    }
  });

  // Server-side Telegram Webhook Endpoint (configured strictly via TELEGRAM_BOT_TOKEN secret)
  app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
    try {
      const outcome = await handleTelegramWebhookUpdate(req.body);
      res.status(200).json(outcome);
    } catch (err) {
      console.error('[/api/telegram/webhook] Error:', err);
      res.status(200).json({ ok: false });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SaringFakta Server] Running on http://0.0.0.0:${PORT}`);
    void bootstrapTelegramWebhookIfConfigured();
  });
}

startServer().catch((err) => {
  console.error('[SaringFakta Server] Fatal startup error:', err);
  process.exit(1);
});

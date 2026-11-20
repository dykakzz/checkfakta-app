import { runMultimodalFactCheck } from './factCheckService.ts';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_size?: number }>;
    video?: { file_id: string; mime_type?: string; file_size?: number };
    voice?: { file_id: string; mime_type?: string; file_size?: number };
  };
}

const MAX_TELEGRAM_FILE_BYTES = 18 * 1024 * 1024; // 18 MB RAM cap

/**
 * Processes an incoming Telegram Bot webhook update in-memory (0 MB disk usage)
 * and replies directly to the user's Telegram chat.
 */
export async function handleTelegramWebhookUpdate(
  update: TelegramUpdate,
  botTokenOverride?: string
): Promise<{ ok: boolean; handled: boolean; note?: string }> {
  const token = (botTokenOverride || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    return {
      ok: false,
      handled: false,
      note: 'TELEGRAM_BOT_TOKEN belum disetel.',
    };
  }

  const msg = update?.message;
  if (!msg || !msg.chat?.id) {
    return { ok: true, handled: false, note: 'Bukan pesan teks/media standar.' };
  }

  const chatId = msg.chat.id;
  const rawText = (msg.text || msg.caption || '').trim();

  if (rawText === '/start' || rawText === '/help') {
    await sendTelegramTextMessage(
      token,
      chatId,
      [
        'Halo! Saya *SaringFakta Bot* — Asisten Cek Fakta & Detektor Deepfake 24/7.',
        '',
        'Cara pakai (0 MB Storage / Diproses instan di RAM):',
        '1. Forward pesan berantai atau klaim teks ke sini.',
        '2. Kirim link *TikTok / Instagram Reels / Berita*.',
        '3. Kirim *Foto / Screenshot / Video pendek* untuk dicek kebenaran ucapan & keaslian AI-nya.',
      ].join('\n'),
      msg.message_id
    );
    return { ok: true, handled: true };
  }

  // Send immediate typing/progress message
  await sendTelegramChatAction(token, chatId, 'typing');

  try {
    const urlMatch = rawText.match(/https?:\/\/[^\s]+/i);
    const detectedUrl = urlMatch ? urlMatch[0] : undefined;
    const textWithoutUrl = detectedUrl ? rawText.replace(detectedUrl, '').trim() : rawText;

    // Check if the user attached or forwarded a photo, video, or voice note in Telegram
    let inlineMedia: { mimeType: string; data: string } | undefined;
    if (msg.video && (!msg.video.file_size || msg.video.file_size <= MAX_TELEGRAM_FILE_BYTES)) {
      inlineMedia = await downloadTelegramFileToRam(token, msg.video.file_id, msg.video.mime_type || 'video/mp4');
    } else if (msg.voice && (!msg.voice.file_size || msg.voice.file_size <= MAX_TELEGRAM_FILE_BYTES)) {
      inlineMedia = await downloadTelegramFileToRam(token, msg.voice.file_id, msg.voice.mime_type || 'audio/ogg');
    } else if (msg.photo && msg.photo.length > 0) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      inlineMedia = await downloadTelegramFileToRam(token, largestPhoto.file_id, 'image/jpeg');
    }

    const result = await runMultimodalFactCheck({
      text: textWithoutUrl || undefined,
      url: detectedUrl,
      media: inlineMedia,
      mode: 'deep',
    });

    // Clear RAM reference immediately
    inlineMedia = undefined;

    const replyBody =
      result.accessStatus === 'blocked_login_wall'
        ? [
            '*KONTEN TERKUNCI / TIDAK DAPAT DIAKSES*',
            '',
            result.blockedReason ||
              'Tautan media sosial ini dibatasi oleh halaman login sehingga video dan caption aslinya tidak dapat dibaca otomatis.',
            '',
            'Agar hasilnya tetap akurat (tidak menebak), silakan *kirim/forward langsung file videonya*, *kirim screenshot*, atau *tuliskan klaim dari video tersebut* ke chat ini.',
          ].join('\n')
        : result.whatsappShareText;

    await sendTelegramTextMessage(token, chatId, replyBody, msg.message_id);
    return { ok: true, handled: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses cek fakta.';
    await sendTelegramTextMessage(
      token,
      chatId,
      `Maaf, gagal memproses permintaan cek fakta: ${errMsg}`,
      msg.message_id
    );
    return { ok: false, handled: true, note: errMsg };
  }
}

/**
 * Registers the Cloud Run webhook URL with Telegram's Bot API.
 */
export async function registerTelegramWebhook(
  botToken: string,
  webhookUrl: string
): Promise<{ ok: boolean; description?: string; botUsername?: string }> {
  const cleanToken = botToken.trim();
  const meRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
  const meJson = (await meRes.json()) as { ok: boolean; description?: string; result?: { username?: string } };
  if (!meJson.ok) {
    throw new Error(meJson.description || 'Token Bot Telegram tidak valid.');
  }

  const setRes = await fetch(`https://api.telegram.org/bot${cleanToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    }),
  });
  const setJson = (await setRes.json()) as { ok: boolean; description?: string };
  if (!setJson.ok) {
    throw new Error(setJson.description || 'Gagal mengatur webhook Telegram.');
  }

  return {
    ok: true,
    description: setJson.description,
    botUsername: meJson.result?.username,
  };
}

async function downloadTelegramFileToRam(
  botToken: string,
  fileId: string,
  mimeType: string
): Promise<{ mimeType: string; data: string } | undefined> {
  try {
    const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!infoRes.ok) return undefined;
    const infoJson = (await infoRes.json()) as { ok: boolean; result?: { file_path?: string } };
    const filePath = infoJson.result?.file_path;
    if (!filePath) return undefined;

    const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!fileRes.ok) return undefined;
    const arrayBuffer = await fileRes.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_TELEGRAM_FILE_BYTES) return undefined;

    return {
      mimeType,
      data: Buffer.from(arrayBuffer).toString('base64'),
    };
  } catch {
    return undefined;
  }
}

async function sendTelegramChatAction(botToken: string, chatId: number, action: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // Ignore non-critical chat action errors
  }
}

async function sendTelegramTextMessage(
  botToken: string,
  chatId: number,
  text: string,
  replyToMessageId?: number
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_to_message_id: replyToMessageId,
      disable_web_page_preview: true,
    }),
  });
}

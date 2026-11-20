/**
 * ============================================================================
 * SARINGFAKTA BOT — STANDALONE GOOGLE APPS SCRIPT (Code.gs)
 * ============================================================================
 * File ini disimpan khusus di dalam folder internal project (/scripts) untuk
 * pemilik aplikasi dan TIDAK ditampilkan di halaman web publik.
 *
 * Arsitektur: 100% Berdiri Sendiri (Independen dari Web Server)
 * Biaya Hosting: Rp 0 (Berjalan 24/7 di akun Google Apps Script Anda)
 *
 * CARA PAKAI (KHUSUS PEMILIK PROJECT):
 * 1. Buka https://script.google.com -> Buat Project Baru -> Tempel isi file ini.
 * 2. Isi TELEGRAM_BOT_TOKEN (dari @BotFather) dan GEMINI_API_KEY di bawah.
 * 3. Klik Deploy -> New Deployment -> Pilih "Web app":
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Salin Web App URL hasil deploy ke variabel WEB_APP_URL di bawah, lalu
 *    jalankan fungsi setTelegramWebhook() satu kali dari menu atas editor.
 * ============================================================================
 */

const TELEGRAM_BOT_TOKEN = 'ISI_TOKEN_BOTFATHER_DI_SINI';
const GEMINI_API_KEY = 'ISI_GEMINI_API_KEY_DI_SINI';
const WEB_APP_URL = 'ISI_URL_WEB_APP_GAS_SETELAH_DEPLOY';

// Urutan model diselaraskan dengan Web App (mode Mendalam):
// Lapis 1 (Utama): gemini-4-hydrogen (thinkingLevel LOW) + Google Search
// Lapis 2 (Cadangan 1): gemini-3.1-flash-lite + Google Search
// Lapis 3 (Cadangan 2): gemini-4-hydrogen (thinkingLevel LOW) tanpa Search
// Lapis 4 (Cadangan 3): gemini-3.1-flash-lite tanpa Search
const GEMINI_FALLBACK_CHAIN = [
  { model: 'gemini-4-hydrogen', useSearch: true, thinkingLevel: 'LOW' },
  { model: 'gemini-3.1-flash-lite', useSearch: true, thinkingLevel: null },
  { model: 'gemini-4-hydrogen', useSearch: false, thinkingLevel: 'LOW' },
  { model: 'gemini-3.1-flash-lite', useSearch: false, thinkingLevel: null },
];

/**
 * Jalankan fungsi ini 1x setelah Deploy untuk menautkan Webhook Telegram.
 */
function setTelegramWebhook() {
  const url =
    'https://api.telegram.org/bot' +
    TELEGRAM_BOT_TOKEN +
    '/setWebhook?url=' +
    encodeURIComponent(WEB_APP_URL);
  const res = UrlFetchApp.fetch(url);
  Logger.log(res.getContentText());
}

/**
 * Handler utama Webhook Telegram (berjalan otomatis 24/7 saat ada pesan masuk).
 */
function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    const msg = update.message;
    if (!msg || !msg.chat) return ContentService.createTextOutput('OK');

    const chatId = msg.chat.id;
    const text = (msg.text || msg.caption || '').trim();

    if (text === '/start' || text === '/help') {
      sendTelegramMessage(
        chatId,
        '*Halo! Saya SaringFakta Bot*\\n\\n' +
          'Kirimkan klaim teks, tautan TikTok/Instagram Reels/Berita, atau foto/video pendek untuk diperiksa kebenaran dan keasliannya.',
        msg.message_id
      );
      return ContentService.createTextOutput('OK');
    }

    let inlineMediaPart = null;
    if (msg.photo && msg.photo.length > 0) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      inlineMediaPart = fetchTelegramMediaAsInlinePart(largestPhoto.file_id, 'image/jpeg');
    } else if (msg.video && (!msg.video.file_size || msg.video.file_size <= 15 * 1024 * 1024)) {
      inlineMediaPart = fetchTelegramMediaAsInlinePart(
        msg.video.file_id,
        msg.video.mime_type || 'video/mp4'
      );
    }

    const replyText = verifyWithGeminiWithSearch(text, inlineMediaPart);
    sendTelegramMessage(chatId, replyText, msg.message_id);
  } catch (err) {
    Logger.log('Webhook error: ' + err);
  }
  return ContentService.createTextOutput('OK');
}

function verifyWithGeminiWithSearch(userClaim, inlineMediaPart) {
  const parts = [];
  if (inlineMediaPart) {
    parts.push(inlineMediaPart);
  }

  parts.push({
    text:
      'Anda adalah asisten cek fakta & detektor Deepfake berbahasa Indonesia.\n' +
      'Jika ada video/audio terlampir, dengarkan langsung penjelasan pembicara di dalam video dan baca teks visualnya.\n' +
      'Jika isi konten merupakan pendapat pribadi/komentar subjektif (bukan klaim berita), gunakan status OPINI / PENDAPAT PRIBADI dan pisahkan bagian opini subjektif dari klaim data/angka/peristiwa faktual yang mungkin diselipkan di dalamnya.\n' +
      'Periksa klaim berikut menggunakan Google Search:\n"' +
      (userClaim || 'Periksa kebenaran dan keaslian media ini') +
      '"\n\n' +
      'Format balasan dengan rapi:\n' +
      '1. STATUS VONIS: (FAKTA TERVERIFIKASI / HOAKS / OPINI / PENDAPAT PRIBADI / INDIKASI AI DEEPFAKE / KONTEKS TIDAK UTUH)\n' +
      '2. INTI KLAIM / PANDANGAN PEMBICARA:\n' +
      '3. PEMISAHAN OPINI VS CEK KLAIM DATA (jika ada opini pribadi):\n' +
      '4. FAKTA SEBENARNYA & ANALISIS:\n' +
      '5. DETEKSI AI / DEEPFAKE:\n' +
      '6. SUMBER REFERENSI:',
  });

  let lastStatusCode = 0;
  let lastErrorMessage = '';

  for (let i = 0; i < GEMINI_FALLBACK_CHAIN.length; i++) {
    const tier = GEMINI_FALLBACK_CHAIN[i];
    const endpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      tier.model +
      ':generateContent?key=' +
      GEMINI_API_KEY;

    const payload = {
      contents: [{ role: 'user', parts: parts }],
    };

    if (tier.useSearch) {
      payload.tools = [{ googleSearch: {} }];
    }

    if (tier.thinkingLevel) {
      payload.generationConfig = {
        thinkingConfig: { thinkingLevel: tier.thinkingLevel },
      };
    }

    try {
      const res = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      const statusCode = res.getResponseCode();
      const bodyText = res.getContentText();
      lastStatusCode = statusCode;

      if (statusCode >= 200 && statusCode < 300) {
        const json = JSON.parse(bodyText);
        const candidate = json.candidates && json.candidates[0];
        const answerParts = candidate && candidate.content && candidate.content.parts;
        const answer = answerParts
          ? answerParts
              .map(function (p) {
                return p.text || '';
              })
              .join('\n')
              .trim()
          : '';

        if (answer) {
          return answer;
        }
      } else {
        lastErrorMessage = bodyText;
        Logger.log('Tier ' + (i + 1) + ' (' + tier.model + ') gagal HTTP ' + statusCode + ': ' + bodyText);
        // Jeda singkat sebelum mencoba model cadangan berikutnya bila kena limit 429 / 503
        if (i < GEMINI_FALLBACK_CHAIN.length - 1 && (statusCode === 429 || statusCode === 503)) {
          Utilities.sleep(500 * (i + 1));
        }
      }
    } catch (err) {
      lastErrorMessage = String(err);
      Logger.log('Tier ' + (i + 1) + ' (' + tier.model + ') exception: ' + err);
    }
  }

  if (lastStatusCode === 429 || lastErrorMessage.indexOf('RESOURCE_EXHAUSTED') !== -1) {
    return 'Layanan analisis sedang menerima banyak permintaan bersamaan. Mohon tunggu sekitar 30 detik lalu kirim ulang pesanmu.';
  }
  if (lastStatusCode === 403 || lastErrorMessage.indexOf('API_KEY_INVALID') !== -1) {
    return 'Konfigurasi API Key Gemini pada bot belum valid. Silakan periksa kembali GEMINI_API_KEY di script GAS.';
  }

  return 'Maaf, belum dapat menganalisis klaim saat ini. Silakan coba beberapa saat lagi.';
}

function fetchTelegramMediaAsInlinePart(fileId, mimeType) {
  try {
    const infoUrl =
      'https://api.telegram.org/bot' +
      TELEGRAM_BOT_TOKEN +
      '/getFile?file_id=' +
      encodeURIComponent(fileId);
    const infoJson = JSON.parse(UrlFetchApp.fetch(infoUrl).getContentText());
    if (!infoJson.ok || !infoJson.result.file_path) return null;

    const fileUrl =
      'https://api.telegram.org/file/bot' +
      TELEGRAM_BOT_TOKEN +
      '/' +
      infoJson.result.file_path;
    const blob = UrlFetchApp.fetch(fileUrl).getBlob();
    return {
      inlineData: {
        mimeType: mimeType,
        data: Utilities.base64Encode(blob.getBytes()),
      },
    };
  } catch (e) {
    return null;
  }
}

function sendTelegramMessage(chatId, text, replyToId) {
  const url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: text,
      reply_to_message_id: replyToId,
      disable_web_page_preview: true,
    }),
    muteHttpExceptions: true,
  });
}

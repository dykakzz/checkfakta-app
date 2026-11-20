import type {
  ContentAccessStatus,
  MediaSourcePlatform,
  UrlExtractionMetadata,
} from '../src/types/factCheck.ts';

export interface InMemoryExtractedUrlPayload {
  metadata: UrlExtractionMetadata;
  inlineMedia?: {
    mimeType: string;
    data: string; // Base64 kept strictly in RAM and garbage-collected after request
  };
}

const MAX_RAM_VIDEO_BYTES = 18 * 1024 * 1024; // 18 MB safe cap for in-memory base64 inlineData
const FETCH_TIMEOUT_MS = 12000;

/**
 * Known login-wall, privacy gate, or generic platform boilerplate strings that MUST NEVER
 * be mistaken for real video captions, titles, or claims.
 */
const BOILERPLATE_EXACT_TITLES = new Set([
  'facebook',
  'facebook - log in or sign up',
  'facebook – log in or sign up',
  'facebook - masuk atau daftar',
  'facebook – masuk atau daftar',
  'log in or sign up to view',
  'log into facebook',
  'log in to facebook',
  'masuk ke facebook',
  'masuk atau daftar untuk melihat',
  'watch',
  'watch | facebook',
  'video | facebook',
  'reels | facebook',
  'facebook watch',
  'instagram',
  'login • instagram',
  'masuk • instagram',
  'tiktok',
  'tiktok - make your day',
  'x',
  'twitter',
  'error',
  'page not found',
  'halaman tidak ditemukan',
  'content not found',
  'redirecting...',
]);

const BOILERPLATE_SUBSTRINGS = [
  'log in or sign up to view',
  'masuk atau daftar untuk melihat',
  'see posts, photos and more on facebook',
  'lihat postingan, foto, dan lainnya di facebook',
  'log into facebook to start sharing and connecting',
  'masuk ke facebook untuk mulai berbagi dan terhubung',
  'you must log in to continue',
  'anda harus masuk untuk melanjutkan',
  'create an account or log in to instagram',
  'buat akun atau masuk ke instagram',
  'this content isn\'t available right now',
  'konten ini tidak tersedia saat ini',
  'the link you followed may be broken',
  'tautan yang anda ikuti mungkin rusak',
  'javascript is not available',
  'please enable cookies',
  'we couldn\'t find this page',
  'unsupported browser',
  'browser anda tidak didukung',
  'connect with friends and the world around you on facebook',
  'terhubung dengan teman dan dunia di sekitar anda di facebook',
  'join facebook or log in to continue',
  'bergabunglah dengan facebook atau masuk untuk melanjutkan',
];

/**
 * Checks whether a string is merely a platform login wall, error page, or generic brand title.
 */
export function isBoilerplateOrLoginWallText(raw?: string | null): boolean {
  if (!raw) return true;
  const normalized = raw
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (normalized.length < 4) return true;
  if (BOILERPLATE_EXACT_TITLES.has(normalized)) return true;

  // Check generic patterns like "12K views · 400 reactions | Facebook" with no real sentence
  if (/^[\d.,kmrb\s·•|]+(views|tayangan|reactions|reaksi|likes|suka|comments|komentar|shares|dibagikan|\s)*(\|\s*facebook)?$/i.test(normalized)) {
    return true;
  }

  for (const phrase of BOILERPLATE_SUBSTRINGS) {
    if (normalized.includes(phrase)) {
      return true;
    }
  }

  return false;
}

/**
 * Cleans and returns text ONLY if it contains real post content (not login-wall boilerplate).
 */
function sanitizeExtractedText(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  let cleaned = decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim();

  // Strip trailing " | Facebook" or " - Facebook" brand suffixes
  cleaned = cleaned.replace(/\s*[|\-–—]\s*Facebook$/i, '').trim();
  // Strip leading metric counters like "120K views · 3.2K reactions | "
  cleaned = cleaned.replace(
    /^[\d.,]+[kmb]?\s+(?:views|tayangan)(?:\s*[·•,]\s*[\d.,]+[kmb]?\s+(?:reactions|reaksi|likes|suka|comments|komentar))?\s*\|\s*/i,
    ''
  ).trim();

  if (isBoilerplateOrLoginWallText(cleaned)) {
    return undefined;
  }
  return cleaned;
}

/**
 * Detects social media or news platform from a URL string.
 */
export function detectPlatform(rawUrl: string): MediaSourcePlatform {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host.includes('instagram.com') || host.includes('instagr.am')) return 'instagram_reel';
    if (host.includes('facebook.com') || host.includes('fb.watch') || host.includes('fb.com'))
      return 'facebook';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('twitter.com') || host.includes('x.com')) return 'x_twitter';
    return 'article';
  } catch {
    return 'article';
  }
}

/**
 * Helper to fetch with timeout so slow social endpoints never hang the request.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads a binary media URL directly into a temporary RAM Buffer (never touches disk).
 * Strictly verifies the response is NOT an HTML login wall page.
 */
async function downloadMediaToRamBuffer(
  mediaUrl: string,
  expectedMimePrefix: 'video/' | 'audio/' | 'image/' = 'video/'
): Promise<{ mimeType: string; data: string; sizeBytes: number } | null> {
  try {
    const res = await fetchWithTimeout(mediaUrl, {}, 14000);
    if (!res.ok) return null;

    const rawContentType = (res.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();

    // Reject HTML/JSON/plain-text login redirects disguised as 200 OK
    if (
      rawContentType.startsWith('text/') ||
      rawContentType.includes('html') ||
      rawContentType.includes('json') ||
      rawContentType.includes('xml')
    ) {
      return null;
    }

    const contentLengthHeader = res.headers.get('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_RAM_VIDEO_BYTES) {
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength < 1024 || arrayBuffer.byteLength > MAX_RAM_VIDEO_BYTES) {
      return null;
    }

    // Extra magic-byte safety check: reject HTML documents starting with "<!DOC" or "<html"
    const headAscii = Buffer.from(arrayBuffer.slice(0, 64)).toString('utf8').trimStart().toLowerCase();
    if (headAscii.startsWith('<!doctype') || headAscii.startsWith('<html') || headAscii.startsWith('<head')) {
      return null;
    }

    let mimeType = rawContentType;
    if (!mimeType || mimeType === 'application/octet-stream') {
      mimeType =
        expectedMimePrefix === 'video/'
          ? 'video/mp4'
          : expectedMimePrefix === 'audio/'
          ? 'audio/mp3'
          : 'image/jpeg';
    }

    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    return {
      mimeType,
      data: base64Data,
      sizeBytes: arrayBuffer.byteLength,
    };
  } catch (err) {
    console.warn(
      '[urlMediaExtractor] Failed to stream media into RAM buffer:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function finalizeMetadataStatus(
  metadata: UrlExtractionMetadata,
  platformDisplayName: string
): UrlExtractionMetadata {
  const cleanTitle = sanitizeExtractedText(metadata.title);
  const cleanCaption = sanitizeExtractedText(metadata.caption);
  const cleanAuthor = sanitizeExtractedText(metadata.author);

  metadata.title = cleanTitle;
  metadata.caption = cleanCaption;
  metadata.author = cleanAuthor;

  const combinedText = [cleanTitle, cleanCaption].filter(Boolean).join(' ').trim();
  metadata.hasMeaningfulCaption = combinedText.length >= 12;

  if (metadata.videoStreamFetchedToRam) {
    metadata.isLoginWallBlocked = false;
    metadata.accessStatus = 'full_video_analyzed';
    metadata.extractionNotes = `Stream video & audio ${platformDisplayName} berhasil diekstrak. Sistem mendengarkan langsung ucapan pembicara dan membaca teks visual di dalam video.`;
  } else if (metadata.hasMeaningfulCaption) {
    metadata.isLoginWallBlocked = false;
    metadata.accessStatus = 'caption_only';
    metadata.extractionNotes = `Teks caption/deskripsi ${platformDisplayName} berhasil dibaca, tetapi file video tidak dapat diunduh otomatis. Pemeriksaan ini hanya berdasarkan teks caption — isi ucapan di dalam video mungkin berbeda.`;
  } else {
    metadata.isLoginWallBlocked = true;
    metadata.accessStatus = 'blocked_login_wall';
    metadata.extractionNotes = `Konten ${platformDisplayName} ini terkunci oleh halaman login atau pengaturan privasi platform sehingga video dan caption aslinya tidak dapat dibaca otomatis.`;
  }

  return metadata;
}

/**
 * Stage 1A: TikTok Extractor (fetches spoken video/audio stream + caption into RAM via TikWM public API + oEmbed fallback).
 */
async function extractTikTokUrl(url: string): Promise<InMemoryExtractedUrlPayload> {
  const metadata: UrlExtractionMetadata = {
    url,
    platform: 'tiktok',
    videoStreamFetchedToRam: false,
    hasMeaningfulCaption: false,
    isLoginWallBlocked: false,
    accessStatus: 'blocked_login_wall',
    extractionNotes: '',
  };

  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
    const apiRes = await fetchWithTimeout(apiUrl, { headers: { Accept: 'application/json' } }, 10000);
    if (apiRes.ok) {
      const json = (await apiRes.json()) as {
        code?: number;
        data?: {
          title?: string;
          play?: string;
          music?: string;
          cover?: string;
          author?: { nickname?: string; unique_id?: string };
        };
      };

      if (json?.code === 0 && json.data) {
        metadata.caption = json.data.title || undefined;
        metadata.title = json.data.title || undefined;
        metadata.author = json.data.author?.nickname || json.data.author?.unique_id || undefined;
        metadata.thumbnailUrl = json.data.cover || undefined;

        const playUrl = json.data.play;
        if (playUrl) {
          const ramMedia = await downloadMediaToRamBuffer(playUrl, 'video/');
          if (ramMedia) {
            metadata.videoStreamFetchedToRam = true;
            metadata.videoStreamSizeBytes = ramMedia.sizeBytes;
            finalizeMetadataStatus(metadata, 'TikTok');
            return {
              metadata,
              inlineMedia: {
                mimeType: ramMedia.mimeType,
                data: ramMedia.data,
              },
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn(
      '[urlMediaExtractor] TikTok stream extraction fallback triggered:',
      err instanceof Error ? err.message : err
    );
  }

  // Fallback to official TikTok oEmbed for caption & author
  try {
    const oembedRes = await fetchWithTimeout(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
      {},
      8000
    );
    if (oembedRes.ok) {
      const oembed = (await oembedRes.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      if (oembed.title && !metadata.title) metadata.title = oembed.title;
      if (oembed.title && !metadata.caption) metadata.caption = oembed.title;
      if (oembed.author_name && !metadata.author) metadata.author = oembed.author_name;
      if (oembed.thumbnail_url && !metadata.thumbnailUrl) metadata.thumbnailUrl = oembed.thumbnail_url;
    }
  } catch {
    // Proceed to status finalization
  }

  finalizeMetadataStatus(metadata, 'TikTok');
  return { metadata };
}

/**
 * Stage 1B: Instagram Reels / Post Extractor
 */
async function extractInstagramReelUrl(url: string): Promise<InMemoryExtractedUrlPayload> {
  const metadata: UrlExtractionMetadata = {
    url,
    platform: 'instagram_reel',
    videoStreamFetchedToRam: false,
    hasMeaningfulCaption: false,
    isLoginWallBlocked: false,
    accessStatus: 'blocked_login_wall',
    extractionNotes: '',
  };

  const mirrorUrls: string[] = [];
  try {
    const parsed = new URL(url);
    parsed.search = '';
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    mirrorUrls.push(`https://www.vxinstagram.com${cleanPath}`);
    mirrorUrls.push(`https://www.instagram.com${cleanPath}/embed/captioned/`);
    mirrorUrls.push(url);
  } catch {
    mirrorUrls.push(url);
  }

  for (const candidateUrl of mirrorUrls) {
    try {
      const res = await fetchWithTimeout(candidateUrl, {}, 9000);
      if (!res.ok) continue;
      const html = await res.text();

      const ogTitle = sanitizeExtractedText(
        extractMetaContent(html, 'og:title') || extractMetaContent(html, 'twitter:title')
      );
      const ogDesc = sanitizeExtractedText(
        extractMetaContent(html, 'og:description') || extractMetaContent(html, 'description')
      );
      const ogVideo =
        extractMetaContent(html, 'og:video:secure_url') ||
        extractMetaContent(html, 'og:video') ||
        extractMetaContent(html, 'twitter:player:stream');
      const ogImage = extractMetaContent(html, 'og:image');

      if (ogTitle && !metadata.title) metadata.title = ogTitle;
      if (ogDesc && !metadata.caption) metadata.caption = ogDesc;
      if (ogImage && !metadata.thumbnailUrl) metadata.thumbnailUrl = decodeHtmlEntities(ogImage);

      const captionMatch = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
      if (captionMatch?.[1] && !metadata.caption) {
        const stripped = sanitizeExtractedText(
          captionMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        );
        if (stripped) metadata.caption = stripped;
      }

      if (ogVideo) {
        const cleanVideoUrl = decodeHtmlEntities(ogVideo);
        const ramMedia = await downloadMediaToRamBuffer(cleanVideoUrl, 'video/');
        if (ramMedia) {
          metadata.videoStreamFetchedToRam = true;
          metadata.videoStreamSizeBytes = ramMedia.sizeBytes;
          finalizeMetadataStatus(metadata, 'Instagram Reels');
          return {
            metadata,
            inlineMedia: {
              mimeType: ramMedia.mimeType,
              data: ramMedia.data,
            },
          };
        }
      }
    } catch {
      // Try next candidate
    }
  }

  finalizeMetadataStatus(metadata, 'Instagram Reels');
  return { metadata };
}

/**
 * Stage 1C: Dedicated Facebook Video / Reels / Share-Link Extractor
 * Resolves fb.watch / share/r / share/v redirects, tries Facebook public video embed plugin,
 * desktop OpenGraph + embedded JSON playable_url, and mbasic fallback while strictly filtering login walls.
 */
async function extractFacebookUrl(url: string): Promise<InMemoryExtractedUrlPayload> {
  const metadata: UrlExtractionMetadata = {
    url,
    platform: 'facebook',
    videoStreamFetchedToRam: false,
    hasMeaningfulCaption: false,
    isLoginWallBlocked: false,
    accessStatus: 'blocked_login_wall',
    extractionNotes: '',
  };

  let canonicalUrl = url;

  // Step 1: Resolve short/share links (fb.watch, facebook.com/share/r/..., /share/v/...)
  try {
    const resolveRes = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
        },
      },
      9000
    );

    if (resolveRes.url && !resolveRes.url.includes('/login')) {
      canonicalUrl = resolveRes.url;
      metadata.resolvedUrl = canonicalUrl;
    }

    if (resolveRes.ok) {
      const html = await resolveRes.text();
      const extractedFromMain = parseFacebookHtmlForContent(html);
      mergeFacebookExtractedData(metadata, extractedFromMain);

      if (extractedFromMain.videoStreamUrl) {
        const ramMedia = await downloadMediaToRamBuffer(extractedFromMain.videoStreamUrl, 'video/');
        if (ramMedia) {
          metadata.videoStreamFetchedToRam = true;
          metadata.videoStreamSizeBytes = ramMedia.sizeBytes;
          finalizeMetadataStatus(metadata, 'Facebook');
          return {
            metadata,
            inlineMedia: {
              mimeType: ramMedia.mimeType,
              data: ramMedia.data,
            },
          };
        }
      }
    }
  } catch (err) {
    console.warn(
      '[urlMediaExtractor] Facebook primary fetch warning:',
      err instanceof Error ? err.message : err
    );
  }

  // Step 2: Try Facebook Public Video Embed Plugin (often bypasses main page login wall for public videos/reels)
  const secondaryCandidates: Array<{ targetUrl: string; userAgent: string }> = [
    {
      targetUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(
        canonicalUrl
      )}&show_text=true`,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    },
  ];

  // Also add mbasic.facebook.com candidate if canonicalUrl is a facebook.com link
  try {
    const parsedCanonical = new URL(canonicalUrl);
    if (parsedCanonical.hostname.includes('facebook.com')) {
      parsedCanonical.hostname = 'mbasic.facebook.com';
      secondaryCandidates.push({
        targetUrl: parsedCanonical.toString(),
        userAgent:
          'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      });
    }
  } catch {
    // Ignore malformed URL
  }

  for (const candidate of secondaryCandidates) {
    try {
      const res = await fetchWithTimeout(
        candidate.targetUrl,
        { headers: { 'User-Agent': candidate.userAgent } },
        9000
      );
      if (!res.ok) continue;
      if (res.url && res.url.includes('/login')) continue;

      const html = await res.text();
      const parsed = parseFacebookHtmlForContent(html);
      mergeFacebookExtractedData(metadata, parsed);

      if (parsed.videoStreamUrl && !metadata.videoStreamFetchedToRam) {
        const ramMedia = await downloadMediaToRamBuffer(parsed.videoStreamUrl, 'video/');
        if (ramMedia) {
          metadata.videoStreamFetchedToRam = true;
          metadata.videoStreamSizeBytes = ramMedia.sizeBytes;
          finalizeMetadataStatus(metadata, 'Facebook');
          return {
            metadata,
            inlineMedia: {
              mimeType: ramMedia.mimeType,
              data: ramMedia.data,
            },
          };
        }
      }
    } catch {
      // Try next candidate
    }
  }

  finalizeMetadataStatus(metadata, 'Facebook');
  return { metadata };
}

interface ParsedFacebookHtml {
  title?: string;
  caption?: string;
  author?: string;
  thumbnailUrl?: string;
  videoStreamUrl?: string;
}

function parseFacebookHtmlForContent(html: string): ParsedFacebookHtml {
  const result: ParsedFacebookHtml = {};

  // Check if page is an explicit login redirect shell
  const pageTitleRaw = extractMetaContent(html, 'og:title') || extractTitleTag(html);
  const ogDescRaw = extractMetaContent(html, 'og:description') || extractMetaContent(html, 'description');
  const ogImage = extractMetaContent(html, 'og:image');

  const cleanTitle = sanitizeExtractedText(pageTitleRaw);
  const cleanDesc = sanitizeExtractedText(ogDescRaw);

  if (cleanTitle) result.title = cleanTitle;
  if (cleanDesc) result.caption = cleanDesc;
  if (ogImage && !ogImage.includes('rsrc.php')) {
    result.thumbnailUrl = decodeHtmlEntities(ogImage);
  }

  // Try extracting structured JSON-LD VideoObject or author/description embedded in public FB pages
  const jsonLdMatches = Array.from(
    html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  );
  for (const m of jsonLdMatches) {
    try {
      const obj = JSON.parse(m[1]) as {
        name?: string;
        description?: string;
        contentUrl?: string;
        author?: { name?: string };
      };
      if (!result.title) result.title = sanitizeExtractedText(obj.name);
      if (!result.caption) result.caption = sanitizeExtractedText(obj.description);
      if (!result.author && obj.author?.name) result.author = sanitizeExtractedText(obj.author.name);
      if (!result.videoStreamUrl && obj.contentUrl && obj.contentUrl.startsWith('http')) {
        result.videoStreamUrl = obj.contentUrl;
      }
    } catch {
      // Ignore invalid JSON-LD blocks
    }
  }

  // Try extracting embedded public Facebook video player URLs (HD or SD)
  const videoRegexes = [
    /"browser_native_sd_url"\s*:\s*"(https?:\\\/\\\/[^"]+)"/i,
    /"playable_url"\s*:\s*"(https?:\\\/\\\/[^"]+)"/i,
    /"browser_native_hd_url"\s*:\s*"(https?:\\\/\\\/[^"]+)"/i,
    /"playable_url_quality_hd"\s*:\s*"(https?:\\\/\\\/[^"]+)"/i,
    /"sd_src"\s*:\s*"(https?:\\\/\\\/[^"]+)"/i,
    /"hd_src"\s*:\s*"(https?:\\\/\\\/[^"]+)"/i,
  ];

  if (!result.videoStreamUrl) {
    for (const regex of videoRegexes) {
      const match = html.match(regex);
      if (match?.[1]) {
        const unescaped = unescapeJsonUrl(match[1]);
        if (unescaped.startsWith('http')) {
          result.videoStreamUrl = unescaped;
          break;
        }
      }
    }
  }

  // Fallback og:video tag
  if (!result.videoStreamUrl) {
    const ogVideo =
      extractMetaContent(html, 'og:video:secure_url') || extractMetaContent(html, 'og:video');
    if (ogVideo) {
      result.videoStreamUrl = decodeHtmlEntities(ogVideo);
    }
  }

  // Try extracting public post message text embedded in GraphQL/Relay JSON if caption still empty
  if (!result.caption) {
    const msgMatch = html.match(/"message"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)+)"/);
    if (msgMatch?.[1]) {
      try {
        const decodedMsg = JSON.parse(`"${msgMatch[1]}"`) as string;
        const cleanMsg = sanitizeExtractedText(decodedMsg);
        if (cleanMsg) result.caption = cleanMsg;
      } catch {
        // Ignore unparseable escape sequence
      }
    }
  }

  return result;
}

function mergeFacebookExtractedData(target: UrlExtractionMetadata, source: ParsedFacebookHtml) {
  if (source.title && !target.title) target.title = source.title;
  if (source.caption && (!target.caption || source.caption.length > target.caption.length)) {
    target.caption = source.caption;
  }
  if (source.author && !target.author) target.author = source.author;
  if (source.thumbnailUrl && !target.thumbnailUrl) target.thumbnailUrl = source.thumbnailUrl;
}

function unescapeJsonUrl(raw: string): string {
  return raw
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\u0025/g, '%')
    .replace(/\\u003d/g, '=')
    .replace(/&amp;/g, '&');
}

/**
 * Stage 1D: Generic Article / YouTube / X OpenGraph & Content Extractor
 */
async function extractGenericOrNewsUrl(
  url: string,
  platform: MediaSourcePlatform
): Promise<InMemoryExtractedUrlPayload> {
  const metadata: UrlExtractionMetadata = {
    url,
    platform,
    videoStreamFetchedToRam: false,
    hasMeaningfulCaption: false,
    isLoginWallBlocked: false,
    accessStatus: 'blocked_login_wall',
    extractionNotes: '',
  };

  try {
    if (platform === 'youtube') {
      const ytOembed = await fetchWithTimeout(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        {},
        7000
      );
      if (ytOembed.ok) {
        const data = (await ytOembed.json()) as {
          title?: string;
          author_name?: string;
          thumbnail_url?: string;
        };
        metadata.title = sanitizeExtractedText(data.title);
        metadata.author = sanitizeExtractedText(data.author_name);
        metadata.thumbnailUrl = data.thumbnail_url;
      }
    }

    const res = await fetchWithTimeout(url, {}, 9000);
    if (res.ok) {
      const html = await res.text();
      const ogTitle = sanitizeExtractedText(
        extractMetaContent(html, 'og:title') || extractTitleTag(html)
      );
      const ogDesc = sanitizeExtractedText(
        extractMetaContent(html, 'og:description') || extractMetaContent(html, 'description')
      );
      const ogAuthor = sanitizeExtractedText(
        extractMetaContent(html, 'author') || extractMetaContent(html, 'article:author')
      );
      const ogImage = extractMetaContent(html, 'og:image');

      if (ogTitle && !metadata.title) metadata.title = ogTitle;
      if (ogDesc) metadata.caption = ogDesc;
      if (ogAuthor && !metadata.author) metadata.author = ogAuthor;
      if (ogImage && !metadata.thumbnailUrl) metadata.thumbnailUrl = decodeHtmlEntities(ogImage);

      if (platform === 'article') {
        const paragraphs = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
          .map((m) =>
            decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
          )
          .filter((p) => p.length > 45 && !isBoilerplateOrLoginWallText(p))
          .slice(0, 8)
          .join(' ');

        if (paragraphs) {
          metadata.caption = [metadata.caption, paragraphs]
            .filter(Boolean)
            .join('\n\n')
            .slice(0, 2800);
        }
      }
    }
  } catch (err) {
    console.warn(
      '[urlMediaExtractor] Generic URL metadata fetch warning:',
      err instanceof Error ? err.message : err
    );
  }

  const labelMap: Record<MediaSourcePlatform, string> = {
    tiktok: 'TikTok',
    instagram_reel: 'Instagram',
    facebook: 'Facebook',
    youtube: 'YouTube',
    x_twitter: 'X / Twitter',
    article: 'halaman web',
    direct_upload: 'file unggahan',
    text_only: 'teks',
  };

  finalizeMetadataStatus(metadata, labelMap[platform] || 'halaman web');
  // For regular news articles with extracted text, mark accessStatus clearly as text_or_media_direct
  if (platform === 'article' && metadata.hasMeaningfulCaption) {
    metadata.accessStatus = 'text_or_media_direct';
    metadata.extractionNotes =
      'Teks artikel dan metadata halaman berhasil diekstrak untuk diverifikasi dengan referensi berita.';
  }

  return { metadata };
}

/**
 * Main entry point: resolves any social media or news URL into metadata + optional in-memory video stream.
 */
export async function extractUrlMediaInMemory(
  rawUrl: string
): Promise<InMemoryExtractedUrlPayload> {
  const cleanUrl = rawUrl.trim();
  const platform = detectPlatform(cleanUrl);

  if (platform === 'tiktok') {
    return extractTikTokUrl(cleanUrl);
  }
  if (platform === 'instagram_reel') {
    return extractInstagramReelUrl(cleanUrl);
  }
  if (platform === 'facebook') {
    return extractFacebookUrl(cleanUrl);
  }
  return extractGenericOrNewsUrl(cleanUrl, platform);
}

function extractMetaContent(html: string, propertyOrName: string): string | undefined {
  const escaped = propertyOrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const match1 = html.match(regex1);
  if (match1?.[1]) return match1[1];

  const regex2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    'i'
  );
  const match2 = html.match(regex2);
  return match2?.[1];
}

function extractTitleTag(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.trim();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}

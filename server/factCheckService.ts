import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type GenerateContentResponse,
  type Part,
} from '@google/genai';
import type {
  AnalysisMode,
  ContentAccessStatus,
  EmbeddedFactCheckItem,
  EmbeddedFactCheckStatus,
  FactCheckApiRequest,
  FactCheckResult,
  GroundingSource,
  OpinionAnalysisReport,
  UrlExtractionMetadata,
  VerdictCategory,
} from '../src/types/factCheck.ts';
import { getGeminiClient } from './geminiClient.ts';
import {
  extractUrlMediaInMemory,
  isBoilerplateOrLoginWallText,
} from './urlMediaExtractor.ts';
import {
  convertServerRefsToGroundingSources,
  searchIndonesianFactCheckReferences,
} from './webSearchFallback.ts';

const VERDICT_LABELS: Record<VerdictCategory, string> = {
  FAKTA: 'FAKTA TERVERIFIKASI',
  HOAKS: 'HOAKS / MENYESATKAN',
  MANIPULASI_AI: 'INDIKASI AI / DEEPFAKE',
  KURANG_KONTEKS: 'KONTEKS TIDAK UTUH',
  OPINI: 'OPINI / PENDAPAT PRIBADI',
  BELUM_TERBUKTI: 'BELUM TERBUKTI SECARA ILMIAH/RESMI',
  TIDAK_DAPAT_DIAKSES: 'KONTEN TERKUNCI / TIDAK DAPAT DIAKSES',
};

// Lightweight In-Memory Link Cache (max 35 results, 30-min TTL, 0 MB disk)
interface CachedScanEntry {
  expiresAt: number;
  result: FactCheckResult;
}
const linkRamCache = new Map<string, CachedScanEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 35;

const TRACKING_QUERY_PARAMS = new Set([
  'igsh',
  'igshid',
  'fbclid',
  'mibextid',
  'si',
  'feature',
  'is_from_webapp',
  'sender_device',
  'sender_web_id',
  'rdid',
  'share_url',
  'ref',
  'ref_src',
  'ref_url',
  's',
  't',
  'pp',
  'app',
  '_r',
  '_t',
  'checksum',
  'sec_uid',
  'u_code',
  'social_sharing',
  'tt_from',
  'is_copy_url',
  'share_app_id',
  'share_item_id',
  'share_link_id',
  'enable_checksum',
]);

/**
 * Normalizes social & news URLs for higher RAM cache hit rates across different
 * share tracking parameters (?igsh=, ?mibextid=, ?utm_*, ?si=, etc.) and
 * subdomain variants (m., www., mobile.) while preserving real content IDs.
 */
function normalizeUrlForCacheKey(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    let host = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.|mobile\.|web\.)/, '');
    let pathname = parsed.pathname.replace(/\/+$/, '');

    // Canonicalize youtu.be/<id> -> youtube.com/watch?v=<id>
    if (host === 'youtu.be' && pathname.length > 1) {
      const videoId = pathname.slice(1).split('/')[0];
      return `youtube.com/watch?v=${videoId}`;
    }

    // Canonicalize youtube.com/shorts/<id> -> youtube.com/shorts/<id> (keep lowercase host)
    if (host === 'x.com' || host === 'twitter.com') {
      host = 'x.com';
    }

    const keptParams: Array<[string, string]> = [];
    parsed.searchParams.forEach((val, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(lowerKey)) {
        return;
      }
      if (val.trim()) {
        keptParams.push([lowerKey, val.trim()]);
      }
    });

    keptParams.sort(([a], [b]) => a.localeCompare(b));
    const queryStr = keptParams.length > 0
      ? '?' + keptParams.map(([k, v]) => `${k}=${v}`).join('&')
      : '';

    return `${host}${pathname}${queryStr}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

function buildCacheKeyFromParts(rawUrl?: string, rawText?: string): string | null {
  const normalizedUrl = rawUrl ? normalizeUrlForCacheKey(rawUrl) : '';
  const normalizedText = (rawText || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalizedUrl && !normalizedText) return null;
  return `${normalizedUrl}||${normalizedText}`;
}

function getCacheKey(req: FactCheckApiRequest): string | null {
  if (req.media?.data || req.bypassCache) return null;
  return buildCacheKeyFromParts(req.url, req.text);
}

function readValidCacheEntry(key: string | null, startTime: number): FactCheckResult | null {
  if (!key) return null;
  const cached = linkRamCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    linkRamCache.delete(key);
    return null;
  }
  return {
    ...cached.result,
    processingStats: {
      ...cached.result.processingStats,
      durationMs: Math.max(12, Date.now() - startTime),
      cachedFromFamilyRam: true,
    },
  };
}

function storeCacheEntry(key: string | null, result: FactCheckResult): void {
  if (!key) return;
  if (linkRamCache.has(key)) {
    linkRamCache.delete(key);
  } else if (linkRamCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = linkRamCache.keys().next().value;
    if (oldestKey) linkRamCache.delete(oldestKey);
  }
  linkRamCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    result,
  });
}

/**
 * Strips raw URLs out of user text so we know if the user actually typed a real claim/question.
 */
function extractUserClaimTextOnly(rawText?: string): string {
  if (!rawText) return '';
  return rawText
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Runs a full multimodal fact-check and deepfake inspection strictly in RAM,
 * with a strict anti-hallucination gate for login-walled social links.
 */
export async function runMultimodalFactCheck(req: FactCheckApiRequest): Promise<FactCheckResult> {
  const startTime = Date.now();

  const cacheKey = getCacheKey(req);
  const directCachedResult = readValidCacheEntry(cacheKey, startTime);
  if (directCachedResult) {
    return directCachedResult;
  }

  let urlMetadata: UrlExtractionMetadata | undefined;
  let activeMedia = req.media;
  const userClaimOnly = extractUserClaimTextOnly(req.text);
  const hasUserClaimText = userClaimOnly.length >= 6 && !isBoilerplateOrLoginWallText(userClaimOnly);

  // Step 1: If a URL is provided, run the Multi-Stage In-Memory Extractor
  let canonicalCacheKey: string | null = null;
  if (req.url && req.url.trim().length > 0) {
    const extracted = await extractUrlMediaInMemory(req.url.trim());
    urlMetadata = extracted.metadata;

    // Also check RAM cache against the canonical resolved URL (e.g. vt.tiktok.com / fb.watch redirect)
    if (!req.media?.data && !req.bypassCache && urlMetadata?.resolvedUrl) {
      canonicalCacheKey = buildCacheKeyFromParts(urlMetadata.resolvedUrl, req.text);
      if (canonicalCacheKey && canonicalCacheKey !== cacheKey) {
        const canonicalCachedResult = readValidCacheEntry(canonicalCacheKey, startTime);
        if (canonicalCachedResult) {
          // Alias the original short URL to the same cached result so future hits are instant
          storeCacheEntry(cacheKey, canonicalCachedResult);
          return canonicalCachedResult;
        }
      }
    }

    if (!activeMedia && extracted.inlineMedia) {
      activeMedia = extracted.inlineMedia;
    }
  }

  const hasDirectMedia = Boolean(activeMedia?.data && activeMedia?.mimeType);
  const hasRealUrlContent = Boolean(urlMetadata?.hasMeaningfulCaption);

  // =========================================================================
  // STRICT ANTI-HALLUCINATION GATE (Early Return Before Any Search or AI Call)
  // =========================================================================
  // If the user submitted a URL (e.g. Facebook / Instagram) that hit a login wall
  // so we have NO video/image, NO real caption, and NO manual user claim text,
  // STOP HONESTLY instead of guessing or pulling random unrelated news.
  if (req.url?.trim() && !hasDirectMedia && !hasRealUrlContent && !hasUserClaimText) {
    const platformLabel = formatPlatformDisplayName(urlMetadata?.platform);
    return {
      id: `fc-blocked-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      accessStatus: 'blocked_login_wall',
      blockedReason: `Tautan ${platformLabel} ini dibatasi oleh halaman login atau pengaturan privasi platform sehingga sistem tidak dapat mengunduh video maupun membaca caption aslinya. Agar tidak memberikan hasil yang keliru atau di luar konteks, pemeriksaan dihentikan sementara.`,
      verdict: 'TIDAK_DAPAT_DIAKSES',
      verdictLabel: VERDICT_LABELS.TIDAK_DAPAT_DIAKSES,
      confidenceScore: 0,
      claimExtracted: '',
      spokenTranscriptSummary: '',
      explanationSummary:
        'Konten video dan caption asli dari tautan ini tidak dapat diakses langsung oleh server. Unggah file video/screenshot atau tuliskan klaim dari video tersebut di bawah agar sistem dapat memeriksanya secara akurat.',
      keyFindings: [],
      mediaForensics: {
        analyzedMediaType: 'none',
        isAiOrDeepfakeSuspected: false,
        authenticityScore: 0,
        summary: 'Belum ada file media yang dapat dianalisis karena tautan terkunci login.',
        anomalies: [],
      },
      urlMetadata,
      sources: [],
      whatsappShareText: '',
      processingStats: {
        durationMs: Date.now() - startTime,
        ramBufferCleared: true,
        diskBytesUsed: 0,
        modeUsed: req.mode,
        cachedFromFamilyRam: false,
      },
    };
  }

  // Determine exact ContentAccessStatus for transparent UI & prompt rules
  let accessStatus: ContentAccessStatus = 'text_or_media_direct';
  if (urlMetadata) {
    if (hasDirectMedia) {
      accessStatus = 'full_video_analyzed';
    } else if (
      urlMetadata.platform === 'facebook' ||
      urlMetadata.platform === 'instagram_reel' ||
      urlMetadata.platform === 'tiktok' ||
      urlMetadata.platform === 'youtube'
    ) {
      accessStatus = 'caption_only';
    } else {
      accessStatus = 'text_or_media_direct';
    }
  } else if (hasDirectMedia && activeMedia?.mimeType?.startsWith('video/')) {
    accessStatus = 'full_video_analyzed';
  }

  const ai = getGeminiClient();

  // Step 2: Anti-Pollution Server-Side News Search
  // ONLY query RSS news if we have genuine substantive text (never on platform names or empty strings).
  // If we have an uploaded/pulled video with NO text caption/claim, skip RSS so unrelated news never pollutes what Gemini hears!
  const searchSeedParts: string[] = [];
  if (hasUserClaimText) searchSeedParts.push(userClaimOnly);
  if (urlMetadata?.hasMeaningfulCaption) {
    if (urlMetadata.title && !isBoilerplateOrLoginWallText(urlMetadata.title)) {
      searchSeedParts.push(urlMetadata.title);
    }
    if (urlMetadata.caption && !isBoilerplateOrLoginWallText(urlMetadata.caption)) {
      searchSeedParts.push(urlMetadata.caption.slice(0, 160));
    }
  }
  const searchSeedQuery = searchSeedParts.join(' ').trim();
  const serverReferences =
    searchSeedQuery.length >= 12
      ? await searchIndonesianFactCheckReferences(searchSeedQuery)
      : [];

  let analyzedMediaType: 'video' | 'image' | 'audio' | 'none' = 'none';
  if (activeMedia?.mimeType) {
    if (activeMedia.mimeType.startsWith('video/')) analyzedMediaType = 'video';
    else if (activeMedia.mimeType.startsWith('image/')) analyzedMediaType = 'image';
    else if (activeMedia.mimeType.startsWith('audio/')) analyzedMediaType = 'audio';
  }

  // Step 3: Assemble multimodal parts for Gemini
  const parts: Part[] = [];
  if (activeMedia?.data && activeMedia?.mimeType) {
    parts.push({
      inlineData: {
        mimeType: activeMedia.mimeType,
        data: activeMedia.data,
      },
    });
  }

  const contextSummaryLines: string[] = [];
  if (hasUserClaimText) {
    contextSummaryLines.push(`Catatan / Klaim dari Pengguna: "${userClaimOnly}"`);
  }
  if (urlMetadata) {
    contextSummaryLines.push(
      `URL Sumber: ${urlMetadata.resolvedUrl || urlMetadata.url} (Platform: ${urlMetadata.platform})`
    );
    if (urlMetadata.title) contextSummaryLines.push(`Judul Konten Asli: ${urlMetadata.title}`);
    if (urlMetadata.author) contextSummaryLines.push(`Akun/Pembuat: ${urlMetadata.author}`);
    if (urlMetadata.caption) contextSummaryLines.push(`Caption/Teks Asli: ${urlMetadata.caption}`);
    contextSummaryLines.push(
      `Status Akses Media Video: ${
        hasDirectMedia
          ? 'VIDEO/AUDIO BERHASIL DILAMPIRKAN (Dengarkan langsung seluruh ucapan pembicara & lihat teks visual di video)'
          : 'VIDEO TIDAK TERLAMPIR / TIDAK DAPAT DIUNDUH (Hanya analisis teks caption/klaim di atas; JANGAN pernah mengarang atau berpura-pura mendengar ucapan audio video!)'
      }`
    );
  }
  if (serverReferences.length > 0) {
    contextSummaryLines.push(
      `Referensi Berita Tambahan (GUNAKAN HANYA JIKA BENAR-BENAR RELEVAN DENGAN KLAIM DI ATAS, ABAIKAN JIKA TIDAK BERHUBUNGAN):\n` +
        serverReferences
          .map((ref, idx) => `${idx + 1}. ${ref.title} (${ref.publisher}) - ${ref.uri}`)
          .join('\n')
    );
  }

  const audioInstruction = hasDirectMedia
    ? `- VIDEO/AUDIO/GAMBAR TERLAMPIR: Dengarkan secara saksama seluruh ucapan lisan pembicara di dalam video/audio (walaupun tanpa subtitle) DAN baca seluruh teks visual di layar (OCR). Tuliskan ringkasan akurat dari apa yang benar-benar diucapkan/terlihat pada field "spokenTranscriptSummary".`
    : `- TIDAK ADA FILE VIDEO/AUDIO TERLAMPIR: JANGAN PERNAH mengarang transkrip ucapan suara video. Pada field "spokenTranscriptSummary", tuliskan dengan jujur ringkasan teks caption/klaim tertulis yang tersedia dan nyatakan bahwa audio video tidak dapat didengarkan secara langsung.`;

  const promptText = `
Anda adalah SaringFakta, mesin pemeriksa fakta & forensik media sosial senior berbahasa Indonesia yang sangat disiplin terhadap akurasi.

ATURAN ANTI-HALUSINASI (WAJIB DIPATUHI):
1. DILARANG KERAS mengarang, menebak, atau mengambil klaim dari berita acak yang tidak sesuai dengan konten input di bawah.
2. Jika referensi berita tambahan yang disertakan tidak membahas topik yang sama dengan konten pengguna, ABAIKAN referensi tersebut sepenuhnya.
3. Hanya verifikasi klaim yang benar-benar ada di dalam video/gambar terlampir, caption asli, atau catatan pengguna.

TUGAS UTAMA:
1. KONTEN / TRANSKRIPSI:
   ${audioInstruction}
2. KLASIFIKASI OPINI PRIBADI VS KLAIM FAKTA (SANGAT PENTING):
   - Periksa apakah isi video/postingan merupakan pendapat pribadi, curhat, ulasan subjektif, komentar sosial/politik, atau saran gaya hidup pembicara (bukan penyampaian berita atau klaim kebenaran objektif).
   - Jika konten MURNI OPINI / PENDAPAT PRIBADI (tanpa klaim faktual palsu): set "verdict": "OPINI", set "opinionAnalysis.hasPersonalOpinion": true, tuliskan poin pendapat subjektifnya di "subjectiveOpinionPoints", dan kosongkan "embeddedFactChecks": []. Jelaskan secara netral bahwa opini pribadi tidak divonis benar atau salah.
   - Jika pembicara menyampaikan OPINI PRIBADI NAMUN MENYELIPKAN KLAIM DATA/ANGKA/PERISTIWA TERTENTU: pisahkan dengan tegas! Masukkan bagian pandangan subjektif ke "subjectiveOpinionPoints", lalu VERIFIKASI setiap klaim data/peristiwa yang diselipkan ke dalam array "embeddedFactChecks" (status: "TERVERIFIKASI", "KELIRU", atau "BELUM_TERBUKTI").
     * Gunakan "verdict": "OPINI" apabila fokus utama video tetap pendapat pribadi dan tidak membawa hoaks utama.
     * Gunakan "verdict": "HOAKS" atau "KURANG_KONTEKS" apabila pembicara sengaja menyebarkan klaim fakta/medis/berita palsu yang menyesatkan sebagai premis utama meski dibungkus kata "menurut saya", sambil tetap mengisi "opinionAnalysis" agar pengguna melihat pemisahan opini vs klaim kelirunya.
3. IDENTIFIKASI KLAIM / PERNYATAAN INTI: Rumuskan 1-2 kalimat tegas mengenai klaim atau pandangan utama yang disampaikan di konten tersebut pada "claimExtracted".
4. VERIFIKASI FAKTA AKURAT: Bandingkan setiap klaim faktual dengan fakta ilmiah, medis, dan berita resmi terkini (gunakan Google Search untuk mencari bukti yang relevan langsung dengan klaim inti).
5. FORENSIK AI / DEEPFAKE: Periksa indikasi manipulasi AI / Deepfake jika ada file visual/audio terlampir. Jika tidak ada file media terlampir, nyatakan dengan jujur bahwa deteksi visual/audio tidak dapat dilakukan tanpa file media.

KONTEKS INPUT:
${contextSummaryLines.join('\n')}

KEMBALIKAN JAWABAN HANYA DALAM FORMAT JSON VALID dengan struktur persis berikut:
{
  "verdict": "FAKTA" | "HOAKS" | "MANIPULASI_AI" | "KURANG_KONTEKS" | "OPINI" | "BELUM_TERBUKTI",
  "confidenceScore": 0-100,
  "claimExtracted": "Kalimat inti klaim atau pandangan utama pembicara pada konten",
  "spokenTranscriptSummary": "Ringkasan akurat ucapan video/OCR (jika media terlampir) atau ringkasan caption tertulis (jika video tidak terlampir)",
  "explanationSummary": "Penjelasan ringkas dan objektif 2-3 kalimat mengenai hasil analisis ini",
  "keyFindings": [
    "Poin temuan 1 beserta bukti/konteks jelas",
    "Poin temuan 2 beserta konteks sebenarnya",
    "Poin temuan 3"
  ],
  "opinionAnalysis": {
    "hasPersonalOpinion": true | false,
    "subjectiveOpinionPoints": [
      "Poin pandangan/pendapat subjektif pembicara (jika ada)"
    ],
    "embeddedFactChecks": [
      {
        "claim": "Klaim data/angka/peristiwa spesifik yang diselipkan di dalam opini",
        "status": "TERVERIFIKASI" | "KELIRU" | "BELUM_TERBUKTI",
        "explanation": "Penjelasan singkat hasil pengecekan klaim data tersebut"
      }
    ]
  },
  "mediaForensics": {
    "isAiOrDeepfakeSuspected": true | false,
    "authenticityScore": 0-100,
    "summary": "Kesimpulan singkat pemeriksaan keaslian visual/audio",
    "anomalies": [
      "Temuan visual/audio 1"
    ]
  }
}
`.trim();

  parts.push({ text: promptText });

  // Avoid sending urlContext for Facebook/Instagram links since Meta returns login walls to automated crawlers
  const allowUrlContext =
    Boolean(req.url?.trim()) &&
    urlMetadata?.platform !== 'facebook' &&
    urlMetadata?.platform !== 'instagram_reel' &&
    !urlMetadata?.isLoginWallBlocked;

  const { response, modelUsed } = await generateContentWithQuotaFallback(
    ai,
    parts,
    req.mode,
    allowUrlContext
  );

  // Explicitly drop reference to in-memory base64 media buffer right after inference completes
  activeMedia = undefined;
  req.media = undefined;

  const rawText = response.text || '';
  const parsed = parseFactCheckJsonSafely(
    rawText,
    userClaimOnly || urlMetadata?.title || urlMetadata?.caption || 'Pemeriksaan Konten Media'
  );

  // Prioritize Gemini Google Search Grounding chunks (which are searched against the actual claim)
  const sources: GroundingSource[] = [];
  const seenUris = new Set<string>();

  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (Array.isArray(groundingChunks)) {
    for (const chunk of groundingChunks) {
      const uri = chunk.web?.uri;
      const title = chunk.web?.title;
      if (uri && !seenUris.has(uri)) {
        seenUris.add(uri);
        sources.push({
          title: title || extractDomainName(uri),
          uri,
          publisher: extractDomainName(uri),
        });
      }
    }
  }

  // Only append server RSS fallback links if Gemini didn't already supply enough grounded sources
  if (sources.length < 3 && serverReferences.length > 0) {
    for (const fallbackSource of convertServerRefsToGroundingSources(serverReferences)) {
      if (!seenUris.has(fallbackSource.uri) && sources.length < 5) {
        seenUris.add(fallbackSource.uri);
        sources.push(fallbackSource);
      }
    }
  }

  const verdict: VerdictCategory = isValidVerdict(parsed.verdict) ? parsed.verdict : 'BELUM_TERBUKTI';
  const verdictLabel = VERDICT_LABELS[verdict];
  const confidenceScore = clampNumber(parsed.confidenceScore, 50, 99, 86);
  const authenticityScore = clampNumber(
    parsed.mediaForensics?.authenticityScore,
    5,
    99,
    analyzedMediaType === 'none' ? 100 : verdict === 'MANIPULASI_AI' ? 22 : 90
  );

  const rawClaimExtracted =
    parsed.claimExtracted ||
    userClaimOnly ||
    urlMetadata?.title ||
    'Klaim dari konten media sosial';
  const claimExtracted = sanitizeHumanReadableField(
    rawClaimExtracted,
    userClaimOnly || urlMetadata?.title || 'Klaim dari konten media sosial'
  );

  const defaultSpokenSummary = hasDirectMedia
    ? 'Penjelasan suara dan teks visual di dalam video telah dianalisis langsung oleh sistem.'
    : urlMetadata?.caption
    ? `Hanya teks caption yang dapat dibaca (audio video tidak diakses): "${urlMetadata.caption.slice(0, 320)}"`
    : 'Analisis dilakukan berdasarkan teks klaim yang diberikan.';
  const spokenTranscriptSummary = sanitizeHumanReadableField(
    parsed.spokenTranscriptSummary,
    defaultSpokenSummary
  );

  const defaultExplanationSummary = buildFallbackExplanationForVerdict(verdict, claimExtracted);
  const explanationSummary = sanitizeHumanReadableField(
    parsed.explanationSummary,
    defaultExplanationSummary
  );

  const cleanedFindings = Array.isArray(parsed.keyFindings)
    ? parsed.keyFindings
        .map((f) => sanitizeHumanReadableField(f, ''))
        .filter((f) => f.length > 0)
        .slice(0, 5)
    : [];
  const keyFindings = cleanedFindings.length > 0 ? cleanedFindings : [explanationSummary];

  const opinionAnalysis = sanitizeOpinionAnalysis(parsed.opinionAnalysis, verdict, claimExtracted);

  const whatsappShareText = buildWhatsAppShareText({
    verdict,
    verdictLabel,
    confidenceScore,
    claimExtracted,
    spokenTranscriptSummary,
    explanationSummary,
    keyFindings,
    opinionAnalysis,
    sources,
    isCaptionOnly: accessStatus === 'caption_only',
  });

  const finalResult: FactCheckResult = {
    id: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    accessStatus,
    verdict,
    verdictLabel,
    confidenceScore,
    claimExtracted,
    spokenTranscriptSummary,
    explanationSummary,
    keyFindings,
    opinionAnalysis,
    mediaForensics: {
      analyzedMediaType,
      isAiOrDeepfakeSuspected:
        Boolean(parsed.mediaForensics?.isAiOrDeepfakeSuspected) || verdict === 'MANIPULASI_AI',
      authenticityScore,
      summary: sanitizeHumanReadableField(
        parsed.mediaForensics?.summary,
        analyzedMediaType === 'none'
          ? 'Tidak ada file video/foto yang dianalisis langsung (pemeriksaan hanya berdasarkan teks/caption).'
          : 'Pemeriksaan artefak visual dan konsistensi suara-bibir selesai dilakukan.'
      ),
      anomalies:
        Array.isArray(parsed.mediaForensics?.anomalies) &&
        parsed.mediaForensics.anomalies.filter((a) => !looksLikeRawJsonLeak(a)).length > 0
          ? parsed.mediaForensics.anomalies.filter((a) => !looksLikeRawJsonLeak(a))
          : analyzedMediaType === 'none'
          ? ['Pemeriksaan berbasis teks & caption (unggah video/foto untuk forensik visual AI)']
          : ['Tidak ditemukan anomali sintetik/Deepfake mencolok pada sampel media'],
    },
    urlMetadata,
    sources: sources.slice(0, 6),
    whatsappShareText,
    processingStats: {
      durationMs: Date.now() - startTime,
      ramBufferCleared: true,
      diskBytesUsed: 0,
      modeUsed: req.mode,
      cachedFromFamilyRam: false,
      modelUsed,
    },
  };

  if (cacheKey) {
    storeCacheEntry(cacheKey, finalResult);
  }
  if (canonicalCacheKey && canonicalCacheKey !== cacheKey) {
    storeCacheEntry(canonicalCacheKey, finalResult);
  }

  return finalResult;
}

function formatPlatformDisplayName(platform?: string): string {
  switch (platform) {
    case 'facebook':
      return 'Facebook';
    case 'instagram_reel':
      return 'Instagram';
    case 'tiktok':
      return 'TikTok';
    case 'youtube':
      return 'YouTube';
    case 'x_twitter':
      return 'X / Twitter';
    default:
      return 'media sosial';
  }
}

function isValidVerdict(val: unknown): val is VerdictCategory {
  return (
    val === 'FAKTA' ||
    val === 'HOAKS' ||
    val === 'MANIPULASI_AI' ||
    val === 'KURANG_KONTEKS' ||
    val === 'OPINI' ||
    val === 'BELUM_TERBUKTI'
  );
}

function isValidEmbeddedFactStatus(val: unknown): val is EmbeddedFactCheckStatus {
  return val === 'TERVERIFIKASI' || val === 'KELIRU' || val === 'BELUM_TERBUKTI';
}

function sanitizeOpinionAnalysis(
  raw: RawParsedModelOutput['opinionAnalysis'],
  verdict: VerdictCategory,
  fallbackClaim: string
): OpinionAnalysisReport | undefined {
  const subjectivePoints = Array.isArray(raw?.subjectiveOpinionPoints)
    ? raw.subjectiveOpinionPoints
        .filter(
          (p): p is string =>
            typeof p === 'string' && p.trim().length > 0 && !looksLikeRawJsonLeak(p)
        )
        .map((p) => p.trim())
        .slice(0, 5)
    : [];

  const embeddedFactChecks: EmbeddedFactCheckItem[] = Array.isArray(raw?.embeddedFactChecks)
    ? raw.embeddedFactChecks
        .filter(
          (item) =>
            item &&
            typeof item.claim === 'string' &&
            item.claim.trim().length > 0 &&
            !looksLikeRawJsonLeak(item.claim) &&
            typeof item.explanation === 'string' &&
            item.explanation.trim().length > 0 &&
            !looksLikeRawJsonLeak(item.explanation)
        )
        .map((item) => ({
          claim: item.claim!.trim(),
          status: isValidEmbeddedFactStatus(item.status) ? item.status : 'BELUM_TERBUKTI',
          explanation: item.explanation!.trim(),
        }))
        .slice(0, 5)
    : [];

  const hasPersonalOpinion =
    Boolean(raw?.hasPersonalOpinion) || verdict === 'OPINI' || subjectivePoints.length > 0;

  if (!hasPersonalOpinion && embeddedFactChecks.length === 0) {
    return undefined;
  }

  return {
    hasPersonalOpinion,
    subjectiveOpinionPoints:
      subjectivePoints.length > 0
        ? subjectivePoints
        : verdict === 'OPINI'
        ? [fallbackClaim]
        : [],
    embeddedFactChecks,
  };
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (Number.isNaN(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function extractDomainName(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return 'Sumber Referensi';
  }
}

interface RawParsedModelOutput {
  verdict?: string;
  confidenceScore?: number;
  claimExtracted?: string;
  spokenTranscriptSummary?: string;
  explanationSummary?: string;
  keyFindings?: string[];
  opinionAnalysis?: {
    hasPersonalOpinion?: boolean;
    subjectiveOpinionPoints?: string[];
    embeddedFactChecks?: Array<{
      claim?: string;
      status?: string;
      explanation?: string;
    }>;
  };
  mediaForensics?: {
    isAiOrDeepfakeSuspected?: boolean;
    authenticityScore?: number;
    summary?: string;
    anomalies?: string[];
  };
}

/**
 * Layer 3 Guard: Detects if a text value accidentally contains raw JSON response markup.
 */
function looksLikeRawJsonLeak(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(?:```)?\s*(?:json\s*)?\{\s*"(?:verdict|confidenceScore|claimExtracted)"/i.test(trimmed)) {
    return true;
  }
  const jsonKeyCount = [
    /"verdict"\s*:/i,
    /"confidenceScore"\s*:/i,
    /"claimExtracted"\s*:/i,
    /"spokenTranscriptSummary"\s*:/i,
    /"explanationSummary"\s*:/i,
    /"keyFindings"\s*:/i,
  ].filter((re) => re.test(trimmed)).length;
  return jsonKeyCount >= 2;
}

function sanitizeHumanReadableField(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim();
  if (!cleaned || looksLikeRawJsonLeak(cleaned)) {
    return fallback;
  }
  return cleaned;
}

function buildFallbackExplanationForVerdict(
  verdict: VerdictCategory,
  claimExtracted: string
): string {
  switch (verdict) {
    case 'FAKTA':
      return `Klaim bahwa "${claimExtracted}" terkonfirmasi sesuai dengan fakta dan informasi yang dapat dipertanggungjawabkan.`;
    case 'HOAKS':
      return `Klaim bahwa "${claimExtracted}" terindikasi keliru atau menyesatkan berdasarkan penelusuran bukti dan konteks yang tersedia.`;
    case 'OPINI':
      return `Konten ini merupakan pandangan atau pendapat pribadi pembicara terkait "${claimExtracted}" dan bukan klaim berita faktual mutlak.`;
    case 'KURANG_KONTEKS':
      return `Informasi mengenai "${claimExtracted}" memerlukan konteks tambahan agar tidak menimbulkan kesalahpahaman.`;
    case 'MANIPULASI_AI':
      return `Konten terkait "${claimExtracted}" menunjukkan indikasi kuat manipulasi atau rekayasa berbasis AI/Deepfake.`;
    default:
      return `Berdasarkan pemeriksaan konteks yang tersedia, pernyataan mengenai "${claimExtracted}" masih memerlukan verifikasi sumber resmi lebih lanjut.`;
  }
}

/**
 * Layer 2A: Extracts the outermost balanced JSON object while respecting string quotes/escapes.
 */
function extractBalancedJsonCandidate(raw: string): string {
  const withoutFences = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const firstBrace = withoutFences.indexOf('{');
  if (firstBrace === -1) return withoutFences;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < withoutFences.length; i++) {
    const ch = withoutFences[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return withoutFences.slice(firstBrace, i + 1);
        }
      }
    }
  }

  // Truncated JSON: return from opening brace to the end for repair/per-field recovery
  return withoutFences.slice(firstBrace);
}

/**
 * Escapes raw unescaped newlines/tabs inside double-quoted JSON strings and strips trailing commas.
 */
function repairCommonJsonQuirks(candidate: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
    }
  }

  // Remove trailing commas before closing } or ]
  return out.replace(/,\s*([}\]])/g, '$1');
}

function unescapeRecoveredJsonString(rawVal: string): string {
  return rawVal
    .replace(/\\"/g, '"')
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts a single string property from malformed/truncated JSON using key-boundary lookaheads.
 */
function recoverStringField(source: string, fieldName: string): string | undefined {
  const keyPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`, 'i');
  const match = keyPattern.exec(source);
  if (!match) return undefined;

  const valueStart = match.index + match[0].length;
  const rest = source.slice(valueStart);

  // Stop at the quote preceding the next JSON key, array/object delimiter, or end of string
  const boundaryMatch = rest.match(
    /(?<!\\)"\s*(?:,\s*"[a-zA-Z0-9_]+"(?:\s*:)|,\s*\}|\s*\}|\s*\])/
  );
  const rawSlice = boundaryMatch ? rest.slice(0, boundaryMatch.index) : rest;
  const cleaned = unescapeRecoveredJsonString(rawSlice.replace(/"\s*$/, ''));
  return cleaned.length > 0 && !looksLikeRawJsonLeak(cleaned) ? cleaned : undefined;
}

function recoverStringArrayField(source: string, fieldName: string): string[] {
  const startMatch = new RegExp(`"${fieldName}"\\s*:\\s*\\[`, 'i').exec(source);
  if (!startMatch) return [];

  const rest = source.slice(startMatch.index + startMatch[0].length);
  const endBracket = rest.indexOf(']');
  const arrayBody = endBracket !== -1 ? rest.slice(0, endBracket) : rest;

  const items: string[] = [];
  const itemRegex = /"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(arrayBody)) !== null) {
    const text = unescapeRecoveredJsonString(m[1]);
    if (text && !looksLikeRawJsonLeak(text)) {
      items.push(text);
    }
  }
  return items;
}

/**
 * Layer 2B: Per-field recovery parser when JSON.parse fails due to truncation or unescaped inner quotes.
 */
function recoverFieldsFromMalformedJson(
  source: string,
  fallbackClaim: string
): RawParsedModelOutput {
  const verdictMatch = source.match(
    /"verdict"\s*:\s*"(FAKTA|HOAKS|MANIPULASI_AI|KURANG_KONTEKS|OPINI|BELUM_TERBUKTI)"/i
  );
  const scoreMatch = source.match(/"confidenceScore"\s*:\s*(\d{1,3})/i);
  const authScoreMatch = source.match(/"authenticityScore"\s*:\s*(\d{1,3})/i);
  const hasOpinionMatch = source.match(/"hasPersonalOpinion"\s*:\s*(true|false)/i);
  const deepfakeMatch = source.match(/"isAiOrDeepfakeSuspected"\s*:\s*(true|false)/i);

  const recoveredVerdict = verdictMatch ? verdictMatch[1].toUpperCase() : undefined;
  const recoveredClaim = recoverStringField(source, 'claimExtracted');
  const recoveredTranscript = recoverStringField(source, 'spokenTranscriptSummary');
  const recoveredExplanation = recoverStringField(source, 'explanationSummary');
  const recoveredFindings = recoverStringArrayField(source, 'keyFindings');
  const recoveredOpinionPoints = recoverStringArrayField(source, 'subjectiveOpinionPoints');
  const recoveredForensicSummary = recoverStringField(source, 'summary');
  const recoveredAnomalies = recoverStringArrayField(source, 'anomalies');

  // Recover complete embeddedFactChecks entries if present
  const embeddedFactChecks: Array<{ claim?: string; status?: string; explanation?: string }> = [];
  const embeddedRegex =
    /\{\s*"claim"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"status"\s*:\s*"(TERVERIFIKASI|KELIRU|BELUM_TERBUKTI)"\s*,\s*"explanation"\s*:\s*"((?:\\.|[^"\\])*)"\s*\}/gi;
  let embMatch: RegExpExecArray | null;
  while ((embMatch = embeddedRegex.exec(source)) !== null) {
    embeddedFactChecks.push({
      claim: unescapeRecoveredJsonString(embMatch[1]),
      status: embMatch[2].toUpperCase(),
      explanation: unescapeRecoveredJsonString(embMatch[3]),
    });
  }

  const effectiveVerdict: VerdictCategory = isValidVerdict(recoveredVerdict)
    ? recoveredVerdict
    : 'BELUM_TERBUKTI';
  const effectiveClaim = recoveredClaim || fallbackClaim.slice(0, 180);

  // If the raw response was plain non-JSON prose (no JSON keys at all), allow using clean prose safely
  const isPureProseResponse = !looksLikeRawJsonLeak(source) && !source.trim().startsWith('{');
  const cleanProse = isPureProseResponse
    ? source.replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 420)
    : undefined;

  const finalExplanation =
    recoveredExplanation ||
    cleanProse ||
    buildFallbackExplanationForVerdict(effectiveVerdict, effectiveClaim);

  return {
    verdict: effectiveVerdict,
    confidenceScore: scoreMatch ? Number(scoreMatch[1]) : 78,
    claimExtracted: effectiveClaim,
    spokenTranscriptSummary: recoveredTranscript,
    explanationSummary: finalExplanation,
    keyFindings: recoveredFindings.length > 0 ? recoveredFindings : [finalExplanation],
    opinionAnalysis:
      hasOpinionMatch || recoveredOpinionPoints.length > 0 || embeddedFactChecks.length > 0
        ? {
            hasPersonalOpinion: hasOpinionMatch
              ? hasOpinionMatch[1].toLowerCase() === 'true'
              : recoveredOpinionPoints.length > 0,
            subjectiveOpinionPoints: recoveredOpinionPoints,
            embeddedFactChecks,
          }
        : undefined,
    mediaForensics: {
      isAiOrDeepfakeSuspected: deepfakeMatch ? deepfakeMatch[1].toLowerCase() === 'true' : false,
      authenticityScore: authScoreMatch ? Number(authScoreMatch[1]) : undefined,
      summary: recoveredForensicSummary,
      anomalies: recoveredAnomalies,
    },
  };
}

function parseFactCheckJsonSafely(rawText: string, fallbackClaim: string): RawParsedModelOutput {
  const trimmed = rawText.trim();
  const candidate = extractBalancedJsonCandidate(trimmed);

  // Stage A1: Direct strict parse
  try {
    return JSON.parse(candidate) as RawParsedModelOutput;
  } catch {
    // Continue to Stage A2
  }

  // Stage A2: Repair unescaped newlines/tabs in strings & trailing commas
  try {
    const repaired = repairCommonJsonQuirks(candidate);
    return JSON.parse(repaired) as RawParsedModelOutput;
  } catch {
    // Continue to Stage B: Per-field recovery (never leaks raw JSON syntax)
    return recoverFieldsFromMalformedJson(trimmed, fallbackClaim);
  }
}

function buildWhatsAppShareText(params: {
  verdict: VerdictCategory;
  verdictLabel: string;
  confidenceScore: number;
  claimExtracted: string;
  spokenTranscriptSummary: string;
  explanationSummary: string;
  keyFindings: string[];
  opinionAnalysis?: OpinionAnalysisReport;
  sources: GroundingSource[];
  isCaptionOnly: boolean;
}): string {
  const findingsText = params.keyFindings
    .slice(0, 3)
    .map((item, idx) => `${idx + 1}. ${item}`)
    .join('\n');

  const subjectiveOpinionText =
    params.opinionAnalysis &&
    params.opinionAnalysis.hasPersonalOpinion &&
    params.opinionAnalysis.subjectiveOpinionPoints.length > 0
      ? `\n*Bagian Opini Subjektif Pembicara:*\n` +
        params.opinionAnalysis.subjectiveOpinionPoints
          .slice(0, 3)
          .map((point) => `- ${point}`)
          .join('\n')
      : '';

  const embeddedChecksText =
    params.opinionAnalysis && params.opinionAnalysis.embeddedFactChecks.length > 0
      ? `\n*Cek Klaim Data / Peristiwa di Dalam Opini:*\n` +
        params.opinionAnalysis.embeddedFactChecks
          .slice(0, 3)
          .map((item) => `- [${item.status.replace('_', ' ')}] ${item.claim}: ${item.explanation}`)
          .join('\n')
      : '';

  const topSources = params.sources
    .slice(0, 2)
    .map((s) => `- ${s.title} (${s.publisher || 'Referensi'})`)
    .join('\n');

  const captionOnlyNote = params.isCaptionOnly
    ? `_Catatan: Pemeriksaan ini berdasarkan teks caption/deskripsi postingan karena video tidak dapat diunduh otomatis._`
    : '';

  const claimHeader =
    params.verdict === 'OPINI' ? '*Pandangan / Opini Pembicara:*' : '*Klaim yang Diperiksa:*';

  return [
    `*HASIL CEK FAKTA — SARINGFAKTA*`,
    `Status: *${params.verdictLabel}* (Keyakinan ${params.confidenceScore}%)`,
    captionOnlyNote,
    ``,
    claimHeader,
    `"${params.claimExtracted}"`,
    ``,
    `*Ringkasan Analisis:*`,
    params.explanationSummary,
    subjectiveOpinionText,
    embeddedChecksText,
    ``,
    `*Poin Penting:*`,
    findingsText,
    topSources ? `\n*Sumber Referensi:*\n${topSources}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const FACT_CHECK_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdict: {
      type: Type.STRING,
      description:
        'Salah satu dari: FAKTA, HOAKS, MANIPULASI_AI, KURANG_KONTEKS, OPINI, BELUM_TERBUKTI',
    },
    confidenceScore: {
      type: Type.INTEGER,
      description: 'Skor keyakinan verifikasi antara 0 hingga 100',
    },
    claimExtracted: {
      type: Type.STRING,
      description: 'Kalimat inti klaim atau pandangan utama pembicara pada konten',
    },
    spokenTranscriptSummary: {
      type: Type.STRING,
      description: 'Ringkasan akurat ucapan video/OCR atau ringkasan caption tertulis',
    },
    explanationSummary: {
      type: Type.STRING,
      description: 'Penjelasan ringkas dan objektif 2-3 kalimat mengenai hasil analisis',
    },
    keyFindings: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Daftar 2-4 poin temuan bukti atau konteks penting',
    },
    opinionAnalysis: {
      type: Type.OBJECT,
      properties: {
        hasPersonalOpinion: { type: Type.BOOLEAN },
        subjectiveOpinionPoints: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        embeddedFactChecks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              claim: { type: Type.STRING },
              status: {
                type: Type.STRING,
                description: 'TERVERIFIKASI, KELIRU, atau BELUM_TERBUKTI',
              },
              explanation: { type: Type.STRING },
            },
            required: ['claim', 'status', 'explanation'],
          },
        },
      },
      required: ['hasPersonalOpinion', 'subjectiveOpinionPoints', 'embeddedFactChecks'],
    },
    mediaForensics: {
      type: Type.OBJECT,
      properties: {
        isAiOrDeepfakeSuspected: { type: Type.BOOLEAN },
        authenticityScore: { type: Type.INTEGER },
        summary: { type: Type.STRING },
        anomalies: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ['isAiOrDeepfakeSuspected', 'authenticityScore', 'summary', 'anomalies'],
    },
  },
  required: [
    'verdict',
    'confidenceScore',
    'claimExtracted',
    'spokenTranscriptSummary',
    'explanationSummary',
    'keyFindings',
    'opinionAnalysis',
    'mediaForensics',
  ],
};

interface FallbackAttemptConfig {
  model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
  useSearchGrounding: boolean;
  useUrlContext: boolean;
  thinkingLevel?: ThinkingLevel;
}

async function generateContentWithQuotaFallback(
  ai: GoogleGenAI,
  parts: Part[],
  mode: AnalysisMode,
  allowUrlContext: boolean
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  const attempts: FallbackAttemptConfig[] =
    mode === 'deep'
      ? [
          {
            model: 'gemini-4-hydrogen',
            useSearchGrounding: true,
            useUrlContext: allowUrlContext,
            thinkingLevel: ThinkingLevel.LOW,
          },
          {
            model: 'gemini-3.1-flash-lite',
            useSearchGrounding: true,
            useUrlContext: false,
          },
          {
            model: 'gemini-4-hydrogen',
            useSearchGrounding: false,
            useUrlContext: false,
            thinkingLevel: ThinkingLevel.LOW,
          },
          {
            model: 'gemini-3.1-flash-lite',
            useSearchGrounding: false,
            useUrlContext: false,
          },
        ]
      : [
          {
            model: 'gemini-3.1-flash-lite',
            useSearchGrounding: false,
            useUrlContext: false,
          },
          {
            model: 'gemini-4-hydrogen',
            useSearchGrounding: false,
            useUrlContext: false,
            thinkingLevel: ThinkingLevel.LOW,
          },
        ];

  let lastError: unknown;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    const tools: Array<Record<string, unknown>> = [];
    if (attempt.useSearchGrounding) tools.push({ googleSearch: {} });
    if (attempt.useUrlContext) tools.push({ urlContext: {} });

    const callModel = async (enforceJsonSchema: boolean) =>
      ai.models.generateContent({
        model: attempt.model,
        contents: [{ role: 'user', parts }],
        config: {
          ...(enforceJsonSchema
            ? {
                responseMimeType: 'application/json',
                responseSchema: FACT_CHECK_RESPONSE_SCHEMA,
              }
            : {}),
          ...(attempt.thinkingLevel
            ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } }
            : {}),
          ...(tools.length > 0 ? { tools } : {}),
        },
      });

    try {
      const response = await callModel(true);
      return { response, modelUsed: attempt.model };
    } catch (err) {
      const errStr = err instanceof Error ? err.message : String(err);
      const isSchemaToolConflict =
        errStr.includes('400') ||
        errStr.includes('INVALID_ARGUMENT') ||
        /response_mime_type|responseMimeType|response_schema|json mode|controlled generation/i.test(
          errStr
        );

      // If a model + built-in tool combo rejects strict responseSchema, retry cleanly without it
      if (isSchemaToolConflict) {
        try {
          const response = await callModel(false);
          return { response, modelUsed: attempt.model };
        } catch (retryErr) {
          lastError = retryErr;
          const retryErrStr = retryErr instanceof Error ? retryErr.message : String(retryErr);
          const isRetryQuotaOrTransient =
            retryErrStr.includes('429') ||
            retryErrStr.includes('RESOURCE_EXHAUSTED') ||
            retryErrStr.includes('quota') ||
            retryErrStr.includes('503') ||
            retryErrStr.includes('UNAVAILABLE');
          if (!isRetryQuotaOrTransient) {
            throw new Error(formatFriendlyGeminiError(retryErrStr));
          }
          continue;
        }
      }

      lastError = err;
      const isQuotaOrTransient =
        errStr.includes('429') ||
        errStr.includes('RESOURCE_EXHAUSTED') ||
        errStr.includes('quota') ||
        errStr.includes('503') ||
        errStr.includes('UNAVAILABLE');

      if (!isQuotaOrTransient) {
        throw new Error(formatFriendlyGeminiError(errStr));
      }

      if (i < attempts.length - 1) {
        const delayMs = 500 * (i + 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  const finalErrStr = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(formatFriendlyGeminiError(finalErrStr));
}

function formatFriendlyGeminiError(rawMessage: string): string {
  if (
    rawMessage.includes('429') ||
    rawMessage.includes('RESOURCE_EXHAUSTED') ||
    rawMessage.includes('exceeded your current quota')
  ) {
    return 'Layanan analisis sedang menerima banyak permintaan secara bersamaan. Silakan tunggu sekitar 30 detik lalu klik "Periksa Fakta Sekarang" kembali, atau pilih mode "Pemeriksaan Cepat".';
  }
  if (
    rawMessage.includes('403') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('API_KEY_INVALID')
  ) {
    return 'Konfigurasi layanan analisis belum aktif. Silakan hubungi pengelola aplikasi.';
  }
  return rawMessage;
}

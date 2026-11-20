import { GoogleGenAI } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;
let cachedApiKey: string | null = null;

function resolveActiveGeminiApiKey(): string {
  const customKey = (process.env.CUSTOM_GEMINI_API_KEY || '').trim();
  if (customKey && customKey !== 'MY_GEMINI_API_KEY') {
    return customKey;
  }

  const defaultKey = (process.env.GEMINI_API_KEY || '').trim();
  if (defaultKey && defaultKey !== 'MY_GEMINI_API_KEY') {
    return defaultKey;
  }

  return '';
}

/**
 * Returns a shared server-side GoogleGenAI instance initialized with
 * CUSTOM_GEMINI_API_KEY (priority 1) or GEMINI_API_KEY (fallback)
 * and the required telemetry User-Agent header.
 */
export function getGeminiClient(): GoogleGenAI {
  const apiKey = resolveActiveGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'API Key Gemini belum dikonfigurasi. Silakan periksa CUSTOM_GEMINI_API_KEY atau GEMINI_API_KEY pada panel Settings > Secrets di Google AI Studio.'
    );
  }

  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedApiKey = apiKey;
  }

  return cachedClient;
}

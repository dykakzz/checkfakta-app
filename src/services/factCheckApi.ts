import {
  FactCheckApiRequest,
  FactCheckResult,
  UrlExtractionMetadata,
} from '../types/factCheck.ts';

export async function submitFactCheck(payload: FactCheckApiRequest): Promise<FactCheckResult> {
  const response = await fetch('/api/fact-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || `Gagal melakukan pemeriksaan fakta (HTTP ${response.status}).`);
  }
  return data as FactCheckResult;
}

export async function fetchUrlPreview(url: string): Promise<UrlExtractionMetadata> {
  const response = await fetch('/api/url-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || 'Gagal mengambil pratinjau URL.');
  }
  return data.metadata as UrlExtractionMetadata;
}

import React, { useRef, useState } from 'react';
import {
  ClipboardPaste,
  FileAudio,
  FileVideo,
  Image as ImageIcon,
  Link2,
  SearchCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { AnalysisMode } from '../types/factCheck.ts';

export interface ScannerMediaAttachment {
  name: string;
  mimeType: string;
  sizeBytes: number;
  base64Data: string;
  previewDataUrl?: string;
}

interface SocialVideoScannerBoxProps {
  isScanning: boolean;
  mode: AnalysisMode;
  onModeChange: (mode: AnalysisMode) => void;
  onRunScan: (params: {
    url: string;
    claimNote: string;
    attachment?: ScannerMediaAttachment;
  }) => void;
}

const MAX_UPLOAD_BYTES = 18 * 1024 * 1024;

const SAMPLE_TEST_CASES = [
  {
    title: 'Uji Klaim Kesehatan Viral',
    url: '',
    claimNote:
      'Video penjelasan di TikTok/Reels menyebut minum air rebusan peniti atau air garam pekat setiap pagi bisa menyembuhkan gagal ginjal kronis tanpa cuci darah. Benarkah klaim di video tersebut?',
  },
  {
    title: 'Uji Deteksi Video Deepfake',
    url: '',
    claimNote:
      'Beredar video Reels dokter ternama yang mempromosikan obat tetes mata penyembuh katarak dalam 48 jam tanpa operasi, namun intonasi suara terdengar datar dan gerakan bibir kurang sinkron.',
  },
  {
    title: 'Uji Tautan Bantuan & Phishing',
    url: '',
    claimNote:
      'Postingan media sosial dan pesan berantai membagikan tautan pendaftaran bantuan tunai Rp 2,5 juta untuk seluruh pemilik e-KTP dengan syarat mengisi nomor akun dan kode OTP.',
  },
];

function detectUrlPlatformLabel(rawUrl: string): string | null {
  const trimmed = rawUrl.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.includes('instagram.com/reel') || trimmed.includes('instagram.com/p/'))
    return 'Instagram Reels / Post';
  if (trimmed.includes('tiktok.com')) return 'TikTok Video';
  if (trimmed.includes('facebook.com') || trimmed.includes('fb.watch')) return 'Facebook Video / Post';
  if (
    trimmed.includes('youtube.com/shorts') ||
    trimmed.includes('youtu.be') ||
    trimmed.includes('youtube.com')
  )
    return 'YouTube / Shorts';
  if (trimmed.includes('x.com') || trimmed.includes('twitter.com')) return 'X / Twitter';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return 'Tautan Artikel / Web';
  return null;
}

export const SocialVideoScannerBox: React.FC<SocialVideoScannerBoxProps> = ({
  isScanning,
  mode,
  onModeChange,
  onRunScan,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [claimNote, setClaimNote] = useState('');
  const [attachment, setAttachment] = useState<ScannerMediaAttachment | undefined>();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const detectedPlatform = detectUrlPlatformLabel(urlInput);

  const handlePasteClipboard = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) {
        const trimmed = clipText.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          setUrlInput(trimmed);
        } else {
          const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
          if (urlMatch) {
            setUrlInput(urlMatch[0]);
            setClaimNote(trimmed.replace(urlMatch[0], '').trim());
          } else {
            setClaimNote(trimmed);
          }
        }
      }
    } catch {
      // Ignore if clipboard read permission is denied by browser
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        `Ukuran file ${(file.size / (1024 * 1024)).toFixed(1)} MB melebihi batas maksimal (18 MB). Gunakan klip video pendek atau screenshot.`
      );
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const resultStr = typeof reader.result === 'string' ? reader.result : '';
      const base64Index = resultStr.indexOf('base64,');
      if (base64Index === -1) {
        setUploadError('Gagal membaca file media.');
        return;
      }
      const base64Data = resultStr.slice(base64Index + 7);
      setAttachment({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        base64Data,
        previewDataUrl: file.type.startsWith('image/') ? resultStr : undefined,
      });
    };
    reader.onerror = () => {
      setUploadError('Terjadi kesalahan saat membaca file.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isScanning) return;
    if (!urlInput.trim() && !claimNote.trim() && !attachment) return;

    onRunScan({
      url: urlInput.trim(),
      claimNote: claimNote.trim(),
      attachment,
    });
  };

  return (
    <section
      aria-label="Pemindai Link Video Sosmed dan Cek Fakta"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-5"
    >
      {/* Top Heading & Subtitle */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-1.5">
            <span>Verifikasi Video & Link Media Sosial</span>
            <span aria-hidden="true">·</span>
            <span>Analisis Ucapan Video</span>
            <span aria-hidden="true">·</span>
            <span>Deteksi Deepfake AI</span>
          </div>
          {detectedPlatform && (
            <span className="font-semibold text-sky-600 dark:text-sky-400">
              Terdeteksi: {detectedPlatform}
            </span>
          )}
        </div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Cek Kebenaran Video Reels, TikTok, Postingan & Tautan Berita
        </h1>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-3xl">
          Tempelkan tautan video media sosial atau unggah tangkapan layar/video pendek untuk mengekstrak isi pembicaraan di dalam video, mendeteksi indikasi rekayasa AI, dan mencocokkan klaimnya dengan sumber berita resmi.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Primary URL Input Row */}
        <div className="space-y-2">
          <label
            htmlFor="social-url-input"
            className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            1. Tautan URL Video / Postingan (Instagram Reels, TikTok, Facebook, YouTube Shorts, atau Berita)
          </label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1 flex items-center">
              <Link2 className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
              <input
                id="social-url-input"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://www.instagram.com/reel/... atau https://vt.tiktok.com/..."
                className="w-full min-h-[48px] pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-600 transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={handlePasteClipboard}
              className="min-h-[48px] px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ClipboardPaste className="w-4 h-4 text-sky-600 shrink-0" />
              <span>Tempel Tautan</span>
            </button>
          </div>
        </div>

        {/* Secondary Row: Video/Screenshot Upload + Optional Claim Note */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-stretch">
          {/* Left 5 cols: Upload File Video / Screenshot */}
          <div className="md:col-span-5 flex flex-col justify-between rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              2. Unggah Video / Screenshot (Opsional)
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mp3,audio/mpeg,audio/wav"
              onChange={handleFileChange}
              className="hidden"
            />

            {attachment ? (
              <div className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                <div className="flex items-center gap-2 min-w-0">
                  {attachment.previewDataUrl ? (
                    <img
                      src={attachment.previewDataUrl}
                      alt={attachment.name}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center text-sky-600 shrink-0">
                      {attachment.mimeType.startsWith('video/') ? (
                        <FileVideo className="w-4 h-4" />
                      ) : attachment.mimeType.startsWith('audio/') ? (
                        <FileAudio className="w-4 h-4" />
                      ) : (
                        <ImageIcon className="w-4 h-4" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {attachment.name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono-tabular">
                      {(attachment.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachment(undefined)}
                  aria-label="Hapus file"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-sky-500 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4 text-sky-600 shrink-0" />
                <span>Pilih Video (.mp4) atau Foto/Screenshot</span>
              </button>
            )}

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              Gunakan opsi ini jika Anda menyimpan videonya di galeri atau tautan berasal dari akun privat.
            </p>
          </div>

          {/* Right 7 cols: Optional Claim / Context Input */}
          <div className="md:col-span-7 flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-2">
            <label
              htmlFor="claim-note-input"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              3. Klaim Teks / Pertanyaan Tambahan (Opsional)
            </label>
            <textarea
              id="claim-note-input"
              rows={2}
              value={claimNote}
              onChange={(e) => setClaimNote(e.target.value)}
              placeholder="Ketik klaim atau tempel isi pesan berantai yang ingin diperiksa kebenarannya..."
              className="w-full resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-600"
            />
          </div>
        </div>

        {uploadError && (
          <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 rounded-xl">
            {uploadError}
          </div>
        )}

        {/* Action Bar: Mode Toggle + Primary Scan CTA */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Kedalaman Analisis:
            </span>
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => onModeChange('deep')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'deep'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Investigasi Mendalam
              </button>
              <button
                type="button"
                onClick={() => onModeChange('fast')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'fast'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Pemeriksaan Cepat
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isScanning || (!urlInput.trim() && !claimNote.trim() && !attachment)}
            className="min-h-[48px] px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:pointer-events-none text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <SearchCheck className="w-4 h-4 shrink-0" />
            <span>{isScanning ? 'Sedang Memeriksa Fakta...' : 'Periksa Fakta Sekarang'}</span>
          </button>
        </div>
      </form>

      {/* Quick Test Buttons */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          <Sparkles className="w-3.5 h-3.5 text-sky-600 shrink-0" />
          <span>Contoh Klaim Populer (Klik untuk mencoba langsung):</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {SAMPLE_TEST_CASES.map((item, idx) => (
            <button
              key={idx}
              type="button"
              disabled={isScanning}
              onClick={() => {
                setUrlInput(item.url);
                setClaimNote(item.claimNote);
                onRunScan({
                  url: item.url,
                  claimNote: item.claimNote,
                });
              }}
              className="text-left p-3 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 transition-colors cursor-pointer"
            >
              <div className="text-xs font-bold text-sky-600 dark:text-sky-400">
                {item.title}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                {item.claimNote}
              </p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

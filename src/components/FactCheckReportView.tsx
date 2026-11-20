import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  HelpCircle,
  Lock,
  MessageSquareQuote,
  Mic,
  SearchCheck,
  Share2,
  ShieldAlert,
  Upload,
  Video,
  XCircle,
} from 'lucide-react';
import {
  EmbeddedFactCheckStatus,
  FactCheckResult,
  VerdictCategory,
} from '../types/factCheck.ts';
import { ScannerMediaAttachment } from './SocialVideoScannerBox.tsx';

interface FactCheckReportViewProps {
  isScanning: boolean;
  error: string | null;
  result: FactCheckResult | null;
  onQuickShareWhatsApp: (result: FactCheckResult) => void;
  onRecoverWithMedia: (attachment: ScannerMediaAttachment, originalUrl?: string) => void;
  onRecoverWithClaim: (claimText: string, originalUrl?: string) => void;
}

const MAX_UPLOAD_BYTES = 18 * 1024 * 1024;

function getVerdictVisuals(verdict: VerdictCategory) {
  switch (verdict) {
    case 'FAKTA':
      return {
        icon: CheckCircle2,
        textColor: 'text-emerald-700 dark:text-emerald-400',
        surfaceBg: 'bg-emerald-50/80 dark:bg-emerald-950/35',
        borderColor: 'border-emerald-200 dark:border-emerald-800/60',
      };
    case 'HOAKS':
      return {
        icon: XCircle,
        textColor: 'text-red-700 dark:text-red-400',
        surfaceBg: 'bg-red-50/80 dark:bg-red-950/35',
        borderColor: 'border-red-200 dark:border-red-800/60',
      };
    case 'MANIPULASI_AI':
      return {
        icon: ShieldAlert,
        textColor: 'text-amber-700 dark:text-amber-400',
        surfaceBg: 'bg-amber-50/80 dark:bg-amber-950/35',
        borderColor: 'border-amber-200 dark:border-amber-800/60',
      };
    case 'KURANG_KONTEKS':
      return {
        icon: AlertTriangle,
        textColor: 'text-amber-700 dark:text-amber-400',
        surfaceBg: 'bg-amber-50/80 dark:bg-amber-950/35',
        borderColor: 'border-amber-200 dark:border-amber-800/60',
      };
    case 'OPINI':
      return {
        icon: MessageSquareQuote,
        textColor: 'text-sky-800 dark:text-sky-300',
        surfaceBg: 'bg-sky-50/80 dark:bg-sky-950/35',
        borderColor: 'border-sky-200 dark:border-sky-800/60',
      };
    case 'TIDAK_DAPAT_DIAKSES':
      return {
        icon: Lock,
        textColor: 'text-amber-700 dark:text-amber-400',
        surfaceBg: 'bg-amber-50/80 dark:bg-amber-950/35',
        borderColor: 'border-amber-200 dark:border-amber-800/60',
      };
    default:
      return {
        icon: HelpCircle,
        textColor: 'text-slate-700 dark:text-slate-300',
        surfaceBg: 'bg-slate-100 dark:bg-slate-800/60',
        borderColor: 'border-slate-200 dark:border-slate-700',
      };
  }
}

function getEmbeddedFactStatusVisuals(status: EmbeddedFactCheckStatus) {
  switch (status) {
    case 'TERVERIFIKASI':
      return {
        icon: CheckCircle2,
        label: 'TERVERIFIKASI',
        textColor: 'text-emerald-700 dark:text-emerald-400',
      };
    case 'KELIRU':
      return {
        icon: XCircle,
        label: 'KELIRU',
        textColor: 'text-red-700 dark:text-red-400',
      };
    default:
      return {
        icon: HelpCircle,
        label: 'BELUM TERBUKTI',
        textColor: 'text-slate-600 dark:text-slate-400',
      };
  }
}

export const FactCheckReportView: React.FC<FactCheckReportViewProps> = ({
  isScanning,
  error,
  result,
  onQuickShareWhatsApp,
  onRecoverWithMedia,
  onRecoverWithClaim,
}) => {
  const [recoveryClaim, setRecoveryClaim] = useState('');
  const [recoveryUploadError, setRecoveryUploadError] = useState<string | null>(null);
  const recoveryFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleRecoveryFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRecoveryUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      setRecoveryUploadError(
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
        setRecoveryUploadError('Gagal membaca file media.');
        return;
      }
      onRecoverWithMedia(
        {
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          base64Data: resultStr.slice(base64Index + 7),
          previewDataUrl: file.type.startsWith('image/') ? resultStr : undefined,
        },
        result?.urlMetadata?.url
      );
    };
    reader.onerror = () => {
      setRecoveryUploadError('Terjadi kesalahan saat membaca file.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRecoveryClaimSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryClaim.trim()) return;
    onRecoverWithClaim(recoveryClaim.trim(), result?.urlMetadata?.url);
    setRecoveryClaim('');
  };

  if (isScanning) {
    return (
      <section
        aria-label="Proses Pemindaian Sedang Berjalan"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5"
      >
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full border-2 border-sky-600 border-t-transparent animate-spin shrink-0" />
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Sedang Membedah Konten & Memverifikasi Fakta...
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Mohon tunggu beberapa detik sementara sistem menganalisis isi konten dan sumber referensi
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 space-y-1">
            <div className="font-mono-tabular font-bold text-sky-600">01. Ekstraksi Konten</div>
            <p className="text-slate-600 dark:text-slate-400">
              Mengambil informasi akun, caption, dan stream audio-visual dari tautan.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 space-y-1">
            <div className="font-mono-tabular font-bold text-sky-600">02. Transkripsi Video</div>
            <p className="text-slate-600 dark:text-slate-400">
              Mendengarkan ucapan pembicara di dalam video & membaca teks pada layar.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 space-y-1">
            <div className="font-mono-tabular font-bold text-sky-600">03. Deteksi Deepfake</div>
            <p className="text-slate-600 dark:text-slate-400">
              Memeriksa keaslian visual dan suara terhadap indikasi manipulasi AI.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 space-y-1">
            <div className="font-mono-tabular font-bold text-sky-600">04. Pencarian Bukti</div>
            <p className="text-slate-600 dark:text-slate-400">
              Mencocokkan klaim dengan portal berita kredibel & lembaga pemeriksa fakta.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        aria-label="Pesan Gangguan Pemeriksaan"
        className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 rounded-2xl p-5 space-y-2"
      >
        <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-bold text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>Pemeriksaan Belum Berhasil Diselesaikan</span>
        </div>
        <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {error}
        </p>
      </section>
    );
  }

  if (!result) {
    return null;
  }

  // Hidden file input shared by both blocked_login_wall and caption_only quick-upload actions
  const sharedRecoveryFileInput = (
    <input
      ref={recoveryFileInputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mp3,audio/mpeg,audio/wav"
      onChange={handleRecoveryFileSelect}
      className="hidden"
    />
  );

  // =========================================================================
  // CONDITION C: HONEST BLOCKED / LOGIN WALL STATE (ZERO HALLUCINATION)
  // =========================================================================
  if (result.accessStatus === 'blocked_login_wall') {
    return (
      <section
        aria-label="Konten Terkunci Login Platform"
        className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/70 rounded-2xl p-5 sm:p-6 space-y-5"
      >
        {sharedRecoveryFileInput}

        <div className="p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 space-y-2">
          <div className="flex items-center gap-2.5 text-amber-800 dark:text-amber-300">
            <Lock className="w-5 h-5 shrink-0" />
            <h2 className="text-base sm:text-lg font-bold tracking-tight">
              Konten Tidak Dapat Diakses Langsung (Terkunci Login Platform)
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            {result.blockedReason ||
              'Platform media sosial ini membatasi akses otomatis dengan halaman login sehingga isi video maupun caption aslinya tidak dapat dibaca. Demi menjaga akurasi agar tidak menebak konteks yang salah, sistem tidak mengeluarkan vonis.'}
          </p>
        </div>

        {recoveryUploadError && (
          <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 rounded-xl">
            {recoveryUploadError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Option 1: Upload Video or Screenshot directly */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-4 flex flex-col justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                01. Unggah Video atau Screenshot Postingan
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Unggah klip video (.mp4) atau tangkapan layar postingan tersebut agar sistem dapat mendengarkan langsung ucapan pembicara dan membaca teks visualnya.
              </p>
            </div>
            <button
              type="button"
              onClick={() => recoveryFileInputRef.current?.click()}
              className="min-h-[44px] w-full px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4 shrink-0" />
              <span>Pilih Video / Screenshot Sekarang</span>
            </button>
          </div>

          {/* Option 2: Paste or Type Claim from Video */}
          <form
            onSubmit={handleRecoveryClaimSubmit}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-4 flex flex-col justify-between gap-3"
          >
            <div className="space-y-1.5">
              <label
                htmlFor="recovery-claim-input"
                className="block text-xs font-bold text-slate-900 dark:text-slate-100"
              >
                02. Atau Tuliskan / Tempel Klaim dari Video
              </label>
              <textarea
                id="recovery-claim-input"
                rows={3}
                value={recoveryClaim}
                onChange={(e) => setRecoveryClaim(e.target.value)}
                placeholder="Contoh: Di video Facebook ini pembicara menyebut bahwa..."
                className="w-full resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-600"
              />
            </div>
            <button
              type="submit"
              disabled={!recoveryClaim.trim()}
              className="min-h-[44px] w-full px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 dark:text-slate-900 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <SearchCheck className="w-4 h-4 shrink-0" />
              <span>Periksa Klaim Ini</span>
            </button>
          </form>
        </div>
      </section>
    );
  }

  const visuals = getVerdictVisuals(result.verdict);
  const VerdictIcon = visuals.icon;
  const isCaptionOnly = result.accessStatus === 'caption_only';
  const isOpini = result.verdict === 'OPINI';
  const showOpinionSeparation =
    isOpini || Boolean(result.opinionAnalysis?.hasPersonalOpinion);
  const subjectivePoints =
    result.opinionAnalysis?.subjectiveOpinionPoints &&
    result.opinionAnalysis.subjectiveOpinionPoints.length > 0
      ? result.opinionAnalysis.subjectiveOpinionPoints
      : [result.claimExtracted];
  const embeddedFactChecks = result.opinionAnalysis?.embeddedFactChecks || [];

  return (
    <section
      aria-label="Laporan Hasil Verifikasi Fakta"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 space-y-6"
    >
      {sharedRecoveryFileInput}

      {/* Top Unboxed Report Metadata Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            Laporan Verifikasi SaringFakta
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular">
            {(result.processingStats.durationMs / 1000).toFixed(1)} detik
          </span>
          {result.accessStatus === 'full_video_analyzed' && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                Audio & Visual Video Dianalisis Langsung
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => onQuickShareWhatsApp(result)}
          className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Share2 className="w-3.5 h-3.5 shrink-0" />
          <span>Bagikan ke WhatsApp</span>
        </button>
      </div>

      {/* CONDITION B: CAPTION-ONLY TRANSPARENCY NOTICE */}
      {isCaptionOnly && (
        <div className="p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Peringatan: Analisis Hanya Berdasarkan Teks Caption Postingan</span>
            </div>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              File video dari tautan ini tidak dapat diunduh otomatis oleh server, sehingga pemeriksaan di bawah hanya menilai klaim dari teks caption/deskripsi. Isi ucapan pembicara di dalam video mungkin berbeda.
            </p>
          </div>
          <button
            type="button"
            onClick={() => recoveryFileInputRef.current?.click()}
            className="min-h-[40px] px-3.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 hover:border-amber-500 text-amber-900 dark:text-amber-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span>Unggah Video untuk Cek Suara</span>
          </button>
        </div>
      )}

      {recoveryUploadError && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3.5 py-2.5 rounded-xl">
          {recoveryUploadError}
        </div>
      )}

      {/* Block 1: Main Verdict Banner + Core Claim */}
      <div
        className={`p-4 sm:p-5 rounded-2xl border ${visuals.surfaceBg} ${visuals.borderColor} space-y-3`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <VerdictIcon className={`w-6 h-6 shrink-0 ${visuals.textColor}`} />
            <h2 className={`text-lg sm:text-xl font-bold tracking-tight ${visuals.textColor}`}>
              {result.verdictLabel}
            </h2>
          </div>
          <span className="text-xs sm:text-sm font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
            Tingkat Keyakinan: {result.confidenceScore}%
          </span>
        </div>

        <div className="space-y-1 pt-1">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {isOpini ? 'Inti Pandangan / Opini Pembicara:' : 'Inti Klaim yang Diperiksa:'}
          </div>
          <p className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug">
            &ldquo;{result.claimExtracted}&rdquo;
          </p>
        </div>
      </div>

      {/* Block 1B: Pemisahan Opini Subjektif vs Klaim Data/Fakta yang Diselipkan */}
      {showOpinionSeparation && (
        <div className="rounded-2xl border border-sky-200/80 dark:border-sky-800/60 bg-sky-50/40 dark:bg-sky-950/20 p-4 sm:p-5 space-y-4">
          <div className="flex items-start gap-2.5">
            <MessageSquareQuote className="w-5 h-5 text-sky-700 dark:text-sky-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                Pemisahan Opini Subjektif &amp; Klaim Data di Dalamnya
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Sistem memisahkan sudut pandang pribadi pembicara dari klaim angka, data, atau peristiwa faktual agar penilaian tetap adil dan objektif.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Column: Bagian Opini Subjektif */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
              <div className="text-xs font-bold text-sky-800 dark:text-sky-300">
                Bagian Opini Subjektif Pembicara
              </div>
              <ul className="space-y-2">
                {subjectivePoints.map((point, idx) => (
                  <li
                    key={idx}
                    className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed flex items-start gap-2"
                  >
                    <span className="font-mono-tabular font-semibold text-sky-700 dark:text-sky-400 shrink-0">
                      0{idx + 1}.
                    </span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <p className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Pandangan pribadi, selera, dan penilaian subjektif pembicara tidak divonis benar atau salah secara faktual.
              </p>
            </div>

            {/* Right Column: Cek Klaim Data / Peristiwa yang Diselipkan */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Cek Klaim Data / Peristiwa yang Diselipkan
              </div>
              {embeddedFactChecks.length > 0 ? (
                <div className="space-y-3">
                  {embeddedFactChecks.map((item, idx) => {
                    const statusVis = getEmbeddedFactStatusVisuals(item.status);
                    const StatusIcon = statusVis.icon;
                    return (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-3 space-y-1.5"
                      >
                        <div className={`flex items-center gap-1.5 text-[11px] font-bold tracking-wide ${statusVis.textColor}`}>
                          <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{statusVis.label}</span>
                        </div>
                        <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                          &ldquo;{item.claim}&rdquo;
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          {item.explanation}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Tidak ditemukan klaim angka, statistik, atau peristiwa faktual spesifik yang perlu diuji kebenarannya di dalam opini ini.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Block 2: Side-by-Side 2-Column Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Column A: Preview Metadata Asli Sosmed */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
              <Video className="w-4 h-4 text-sky-600 shrink-0" />
              <span>01. Informasi Konten & Sumber</span>
            </div>
            {result.urlMetadata && (
              <span className="text-xs font-mono-tabular text-slate-500">
                {result.urlMetadata.platform.replace('_', ' ').toUpperCase()}
              </span>
            )}
          </div>

          {result.urlMetadata ? (
            <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
              {result.urlMetadata.author && (
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Akun / Pembuat: </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {result.urlMetadata.author}
                  </span>
                </div>
              )}
              {result.urlMetadata.title && (
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Judul Konten: </span>
                  <span className="font-medium">{result.urlMetadata.title}</span>
                </div>
              )}
              {result.urlMetadata.caption && (
                <div className="space-y-1">
                  <div className="text-slate-500 dark:text-slate-400">Caption / Teks Asli:</div>
                  <p className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 line-clamp-4 leading-relaxed">
                    {result.urlMetadata.caption}
                  </p>
                </div>
              )}
              <div className="pt-1 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                {result.urlMetadata.extractionNotes}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Pemeriksaan dilakukan langsung berdasarkan file media atau klaim teks yang dimasukkan.
            </p>
          )}
        </div>

        {/* Column B: Transkrip Ucapan Pembicara OR Caption Summary */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100">
            {isCaptionOnly ? (
              <FileText className="w-4 h-4 text-amber-600 shrink-0" />
            ) : (
              <Mic className="w-4 h-4 text-sky-600 shrink-0" />
            )}
            <span>
              {isCaptionOnly
                ? '02. Ringkasan Caption (Audio Video Tidak Diakses)'
                : '02. Isi Ucapan Video & Teks Visual'}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 rounded-lg p-3">
            {result.spokenTranscriptSummary}
          </p>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {isCaptionOnly
              ? 'Suara pembicara di dalam video belum didengarkan. Unggah file video jika ingin memverifikasi isi percakapan di dalam video.'
              : 'Ringkasan narasi pembicara di dalam video dan teks visual yang terbaca pada layar.'}
          </div>
        </div>
      </div>

      {/* Block 3: Fakta Sebenarnya & Poin Bukti */}
      <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
          {isOpini
            ? '03. Ringkasan Analisis & Konteks'
            : '03. Kesimpulan Cek Fakta & Penjelasan Bukti'}
        </h3>
        <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
          {result.explanationSummary}
        </p>
        <ul className="space-y-2 pt-1">
          {result.keyFindings.map((finding, idx) => (
            <li
              key={idx}
              className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed flex items-start gap-2.5 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl"
            >
              <span className="font-mono-tabular font-bold text-sky-600 dark:text-sky-400 shrink-0">
                0{idx + 1}.
              </span>
              <span>{finding}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Block 4: Deteksi Forensik AI / Deepfake & Sumber Referensi Kredibel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
        {/* Forensik Deepfake */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              04. Deteksi Manipulasi AI & Deepfake
            </h4>
            <span className="text-xs font-mono-tabular font-bold text-slate-900 dark:text-slate-100">
              Skor Keaslian: {result.mediaForensics.authenticityScore}%
            </span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {result.mediaForensics.summary}
          </p>
          {result.mediaForensics.anomalies.length > 0 && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
              {result.mediaForensics.anomalies.join(' · ')}
            </div>
          )}
        </div>

        {/* Sumber Referensi Berita & CekFakta */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
          <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
            05. Sumber Referensi & Artikel Terkait
          </h4>
          {result.sources.length > 0 ? (
            <div className="space-y-1.5">
              {result.sources.map((src, idx) => (
                <a
                  key={idx}
                  href={src.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-sky-500 text-xs text-slate-700 dark:text-slate-300 transition-colors"
                >
                  <span className="truncate font-medium">
                    {src.title} {src.publisher ? `(${src.publisher})` : ''}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Diverifikasi menggunakan penelusuran referensi faktual dan analisis konteks.
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

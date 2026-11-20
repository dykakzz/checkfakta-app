import React, { useState } from 'react';
import { Check, Copy, Download, Share2 } from 'lucide-react';
import { FactCheckResult } from '../types/factCheck.ts';
import { renderFactCheckCardToPngBlob } from '../utils/canvasCardExporter.ts';

interface ShareableCardStudioProps {
  result: FactCheckResult | null;
}

export const ShareableCardStudio: React.FC<ShareableCardStudioProps> = ({ result }) => {
  const [copied, setCopied] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  if (!result) {
    return null;
  }

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(result.whatsappShareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setExportMessage('Gagal menyalin teks secara otomatis.');
    }
  };

  const handleShareWhatsApp = () => {
    const encoded = encodeURIComponent(result.whatsappShareText);
    const waUrl = `https://wa.me/?text=${encoded}`;
    window.location.href = waUrl;
  };

  const handleDownloadOrSharePng = async () => {
    setIsExportingPng(true);
    setExportMessage(null);
    try {
      const pngBlob = await renderFactCheckCardToPngBlob(result);
      const fileName = `saringfakta-${result.verdict.toLowerCase()}-${Date.now()}.png`;

      const fileObj = new File([pngBlob], fileName, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
        await navigator.share({
          title: `Hasil Cek Fakta: ${result.verdictLabel}`,
          text: result.whatsappShareText,
          files: [fileObj],
        });
        setExportMessage('Kartu berhasil dibuka di menu Bagikan perangkat.');
        return;
      }

      const objectUrl = URL.createObjectURL(pngBlob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
      setExportMessage('Gambar kartu PNG berhasil diunduh.');
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : 'Gagal mengekspor gambar kartu.');
    } finally {
      setIsExportingPng(false);
    }
  };

  const isHoaxOrAi = result.verdict === 'HOAKS' || result.verdict === 'MANIPULASI_AI';
  const isFakta = result.verdict === 'FAKTA';
  const isOpini = result.verdict === 'OPINI';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Kartu Ringkasan Cek Fakta
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Siap dibagikan ke WhatsApp atau media sosial
          </p>
        </div>
        <span className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400">
          PNG 1080×1350
        </span>
      </div>

      {/* Live Visual Card Preview */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-4 sm:p-5 space-y-3.5">
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-bold text-slate-900 dark:text-slate-100 font-display">
            SaringFakta
          </span>
          <span>
            {new Date(result.timestamp).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </div>

        <div
          className={`p-3 rounded-lg flex items-center justify-between gap-2 ${
            isFakta
              ? 'bg-emerald-100/80 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
              : isHoaxOrAi
              ? 'bg-red-100/80 text-red-900 dark:bg-red-950/60 dark:text-red-300'
              : isOpini
              ? 'bg-sky-100/80 text-sky-900 dark:bg-sky-950/60 dark:text-sky-300'
              : 'bg-amber-100/80 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
          }`}
        >
          <span className="text-sm font-bold tracking-tight">{result.verdictLabel}</span>
          <span className="text-xs font-mono-tabular font-semibold">
            Keyakinan {result.confidenceScore}%
          </span>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {isOpini ? 'Pandangan / Opini Pembicara' : 'Klaim yang Diperiksa'}
          </div>
          <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
            &ldquo;{result.claimExtracted}&rdquo;
          </p>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {isOpini ? 'Ringkasan Analisis' : 'Kesimpulan Fakta'}
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {result.explanationSummary}
          </p>
        </div>

        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
          <span>Skor Keaslian Media: {result.mediaForensics.authenticityScore}%</span>
          <span>{result.sources.length} Sumber Referensi</span>
        </div>
      </div>

      {exportMessage && (
        <div className="text-xs text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 px-3 py-2 rounded-lg">
          {exportMessage}
        </div>
      )}

      {/* Share & Export Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          type="button"
          onClick={handleShareWhatsApp}
          className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Share2 className="w-4 h-4 shrink-0" />
          <span>Kirim ke WA</span>
        </button>

        <button
          type="button"
          onClick={handleDownloadOrSharePng}
          disabled={isExportingPng}
          className="min-h-[44px] px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>{isExportingPng ? 'Merender...' : 'Unduh PNG'}</span>
        </button>

        <button
          type="button"
          onClick={handleCopyText}
          className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <Copy className="w-4 h-4 shrink-0" />
          )}
          <span>{copied ? 'Tersalin!' : 'Salin Teks'}</span>
        </button>
      </div>
    </div>
  );
};

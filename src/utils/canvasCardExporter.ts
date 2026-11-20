import { FactCheckResult, VerdictCategory } from '../types/factCheck.ts';

interface ThemePalette {
  badgeBg: string;
  badgeText: string;
  accentHex: string;
}

const VERDICT_PALETTES: Record<VerdictCategory, ThemePalette> = {
  FAKTA: {
    badgeBg: '#DCFCE7',
    badgeText: '#15803D',
    accentHex: '#16A34A',
  },
  HOAKS: {
    badgeBg: '#FEE2E2',
    badgeText: '#B91C1C',
    accentHex: '#DC2626',
  },
  MANIPULASI_AI: {
    badgeBg: '#FEF3C7',
    badgeText: '#B45309',
    accentHex: '#D97706',
  },
  KURANG_KONTEKS: {
    badgeBg: '#FEF3C7',
    badgeText: '#B45309',
    accentHex: '#D97706',
  },
  OPINI: {
    badgeBg: '#E0F2FE',
    badgeText: '#0369A1',
    accentHex: '#0284C7',
  },
  BELUM_TERBUKTI: {
    badgeBg: '#E2E8F0',
    badgeText: '#334155',
    accentHex: '#475569',
  },
  TIDAK_DAPAT_DIAKSES: {
    badgeBg: '#FEF3C7',
    badgeText: '#B45309',
    accentHex: '#D97706',
  },
};

/**
 * Renders a FactCheckResult into a clean, high-resolution 1080x1350 PNG Blob
 * suitable for sharing to WhatsApp, Telegram, or Instagram Stories.
 */
export async function renderFactCheckCardToPngBlob(result: FactCheckResult): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const width = 1080;
  const height = 1350;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context tidak tersedia di browser ini.');
  }

  const palette = VERDICT_PALETTES[result.verdict] || VERDICT_PALETTES.BELUM_TERBUKTI;

  // 1. Background Canvas (#F8FAFC)
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, width, height);

  // 2. Main Editorial Card Container
  const cardX = 56;
  const cardY = 56;
  const cardW = width - 112;
  const cardH = height - 112;

  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 32);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#E2E8F0';
  ctx.stroke();

  // Top Header Strip inside Card
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 34px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('SaringFakta', cardX + 56, cardY + 78);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 22px "DM Sans", sans-serif';
  const dateStr = new Date(result.timestamp).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  ctx.fillText(`Kartu Verifikasi Fakta · ${dateStr}`, cardX + 56, cardY + 114);

  // Hairline Divider
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 56, cardY + 148);
  ctx.lineTo(cardX + cardW - 56, cardY + 148);
  ctx.stroke();

  // 3. Verdict Status Banner
  const bannerY = cardY + 180;
  ctx.fillStyle = palette.badgeBg;
  drawRoundedRect(ctx, cardX + 56, bannerY, cardW - 112, 96, 20);
  ctx.fill();

  ctx.fillStyle = palette.badgeText;
  ctx.font = 'bold 34px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(result.verdictLabel, cardX + 84, bannerY + 60);

  ctx.font = '600 24px "JetBrains Mono", monospace';
  const confText = `Keyakinan ${result.confidenceScore}%`;
  const confWidth = ctx.measureText(confText).width;
  ctx.fillText(confText, cardX + cardW - 84 - confWidth, bannerY + 58);

  // 4. Claim Section
  let cursorY = bannerY + 145;
  ctx.fillStyle = '#64748B';
  ctx.font = '600 22px "DM Sans", sans-serif';
  ctx.fillText(
    result.verdict === 'OPINI' ? 'Pandangan / Opini Pembicara' : 'Klaim yang Diperiksa',
    cardX + 56,
    cursorY
  );

  cursorY += 40;
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 30px "Plus Jakarta Sans", sans-serif';
  cursorY = wrapText(ctx, `"${result.claimExtracted}"`, cardX + 56, cursorY, cardW - 112, 42, 3);

  // 5. Explanation Summary
  cursorY += 36;
  ctx.fillStyle = '#64748B';
  ctx.font = '600 22px "DM Sans", sans-serif';
  ctx.fillText('Kesimpulan Pemeriksaan', cardX + 56, cursorY);

  cursorY += 38;
  ctx.fillStyle = '#1E293B';
  ctx.font = '400 26px "DM Sans", sans-serif';
  cursorY = wrapText(ctx, result.explanationSummary, cardX + 56, cursorY, cardW - 112, 38, 4);

  // 6. Key Findings List
  cursorY += 36;
  ctx.fillStyle = '#64748B';
  ctx.font = '600 22px "DM Sans", sans-serif';
  ctx.fillText(
    result.verdict === 'OPINI' ? 'Poin Analisis & Verifikasi' : 'Bukti & Fakta Sebenarnya',
    cardX + 56,
    cursorY
  );

  cursorY += 36;
  ctx.fillStyle = '#334155';
  ctx.font = '400 24px "DM Sans", sans-serif';
  const maxFindings = result.keyFindings.slice(0, 3);
  for (let i = 0; i < maxFindings.length; i++) {
    const bulletText = `${i + 1}. ${maxFindings[i]}`;
    cursorY = wrapText(ctx, bulletText, cardX + 56, cursorY, cardW - 112, 34, 2);
    cursorY += 12;
  }

  // 7. Media Forensics & Grounded Sources Footer Box
  const footerBoxY = cardY + cardH - 185;
  ctx.fillStyle = '#F8FAFC';
  drawRoundedRect(ctx, cardX + 56, footerBoxY, cardW - 112, 130, 18);
  ctx.fill();

  ctx.fillStyle = '#0F172A';
  ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
  const forensicTitle = `Forensik Media AI/Deepfake: Skor Keaslian ${result.mediaForensics.authenticityScore}%`;
  ctx.fillText(forensicTitle, cardX + 80, footerBoxY + 46);

  ctx.fillStyle = '#475569';
  ctx.font = '400 20px "DM Sans", sans-serif';
  const sourceDomainList =
    result.sources.length > 0
      ? `Referensi: ${result.sources
          .slice(0, 3)
          .map((s) => s.publisher || s.title)
          .join(' · ')}`
      : 'Diverifikasi dengan pencarian fakta real-time & analisis multimodal SaringFakta';
  wrapText(ctx, sourceDomainList, cardX + 80, footerBoxY + 86, cardW - 160, 28, 1);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Gagal membuat gambar PNG dari kartu cek fakta.'));
    }, 'image/png');
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number {
  const words = text.split(/\s+/);
  let line = '';
  let currentY = y;
  let lineCount = 0;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lineCount++;
      if (lineCount >= maxLines) {
        ctx.fillText(line.trim() + '...', x, currentY);
        return currentY + lineHeight;
      }
      ctx.fillText(line.trim(), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line.trim()) {
    ctx.fillText(line.trim(), x, currentY);
    currentY += lineHeight;
  }
  return currentY;
}

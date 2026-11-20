/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { FactCheckReportView } from './components/FactCheckReportView.tsx';
import { Header } from './components/Header.tsx';
import { ShareableCardStudio } from './components/ShareableCardStudio.tsx';
import {
  ScannerMediaAttachment,
  SocialVideoScannerBox,
} from './components/SocialVideoScannerBox.tsx';
import { submitFactCheck } from './services/factCheckApi.ts';
import { AnalysisMode, FactCheckResult } from './types/factCheck.ts';

export default function App() {
  const [mode, setMode] = useState<AnalysisMode>('deep');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<FactCheckResult | null>(null);

  const scannerAnchorRef = useRef<HTMLDivElement | null>(null);
  const reportAnchorRef = useRef<HTMLDivElement | null>(null);

  const handleResetScan = () => {
    setScanResult(null);
    setScanError(null);
    scannerAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleRunScan = async (params: {
    url: string;
    claimNote: string;
    attachment?: ScannerMediaAttachment;
  }) => {
    setIsScanning(true);
    setScanError(null);

    setTimeout(() => {
      reportAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);

    try {
      const result = await submitFactCheck({
        url: params.url || undefined,
        text: params.claimNote || undefined,
        media: params.attachment
          ? {
              mimeType: params.attachment.mimeType,
              data: params.attachment.base64Data,
              fileName: params.attachment.name,
            }
          : undefined,
        mode,
      });
      setScanResult(result);
    } catch (err) {
      setScanError(
        err instanceof Error
          ? err.message
          : 'Terjadi gangguan saat memeriksa konten. Silakan coba lagi.'
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleRecoverWithMedia = (attachment: ScannerMediaAttachment, originalUrl?: string) => {
    void handleRunScan({
      url: originalUrl || '',
      claimNote: '',
      attachment,
    });
  };

  const handleRecoverWithClaim = (claimText: string, originalUrl?: string) => {
    void handleRunScan({
      url: originalUrl || '',
      claimNote: claimText,
    });
  };

  const handleQuickShareWhatsApp = (result: FactCheckResult) => {
    const encoded = encodeURIComponent(result.whatsappShareText);
    window.location.href = `https://wa.me/?text=${encoded}`;
  };

  const showShareableCard = Boolean(
    scanResult && scanResult.accessStatus !== 'blocked_login_wall'
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Clean 2-Edge Header */}
      <Header
        onResetScan={handleResetScan}
        onScrollToScanner={() =>
          scannerAnchorRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
      />

      {/* Main Clean 1-Page Scanner & Report Container */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 py-5 sm:py-7 space-y-6">
        <div ref={scannerAnchorRef} id="scanner">
          <SocialVideoScannerBox
            isScanning={isScanning}
            mode={mode}
            onModeChange={setMode}
            onRunScan={handleRunScan}
          />
        </div>

        <div ref={reportAnchorRef} id="report" className="space-y-6">
          {(isScanning || scanError || scanResult) && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 8 cols (or full 12 cols when scanning/error/blocked): Report */}
              <div className={showShareableCard ? 'lg:col-span-8' : 'lg:col-span-12'}>
                <FactCheckReportView
                  isScanning={isScanning}
                  error={scanError}
                  result={scanResult}
                  onQuickShareWhatsApp={handleQuickShareWhatsApp}
                  onRecoverWithMedia={handleRecoverWithMedia}
                  onRecoverWithClaim={handleRecoverWithClaim}
                />
              </div>

              {/* Right 4 cols: Shareable WhatsApp & PNG Card Studio (hidden when login-walled) */}
              {showShareableCard && (
                <div id="card" className="lg:col-span-4">
                  <ShareableCardStudio result={scanResult} />
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

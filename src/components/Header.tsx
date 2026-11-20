import React from 'react';

interface HeaderProps {
  onResetScan: () => void;
  onScrollToScanner: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onResetScan,
  onScrollToScanner,
}) => {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
      {/* Left: Single text element wordmark */}
      <a
        href="#scanner"
        onClick={(e) => {
          e.preventDefault();
          onScrollToScanner();
        }}
        className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 font-display"
      >
        SaringFakta
      </a>

      {/* Right: 1 primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onResetScan}
          className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 active:scale-[0.98] rounded-lg transition-all whitespace-nowrap shrink-0 cursor-pointer"
        >
          Periksa Konten Baru
        </button>
      </div>
    </header>
  );
};

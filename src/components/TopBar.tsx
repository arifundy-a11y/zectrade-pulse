import React from 'react';
import type { AppSection } from '../types';

interface TopBarProps {
  isLoggedIn: boolean;
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
  csrTelegramLink: string;
  onPrimaryAction: () => void;
  primaryActionLabel: string;
  brandLogoUrl?: string | null;
}

export const TopBar: React.FC<TopBarProps> = ({
  isLoggedIn,
  activeSection,
  onSelectSection,
  csrTelegramLink,
  onPrimaryAction,
  primaryActionLabel,
  brandLogoUrl,
}) => {
  const effectiveLogoUrl = brandLogoUrl?.trim() || '/favicon.svg';

  return (
    <header className="sticky top-0 z-30 h-13 sm:h-14 w-full bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 px-3 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
      {/* Zone 1: Single-line Brand Wordmark + Icon */}
      <button
        type="button"
        onClick={() => onSelectSection('trade')}
        className="flex items-center gap-2 text-sm sm:text-base font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-500 rounded"
      >
        <img
          src={effectiveLogoUrl}
          alt="Zectrade Pulse logo"
          data-testid="topbar-brand-logo"
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.dataset.fallbackApplied) {
              img.dataset.fallbackApplied = '1';
              img.src = '/favicon.svg';
            }
          }}
          className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg object-cover border border-slate-800 bg-slate-900 shrink-0"
        />
        <span>Zectrade Pulse</span>
      </button>

      {/* Zone 2: 4 Concise Single-Line Navigation Links */}
      {isLoggedIn ? (
        <nav aria-label="Primary Navigation" className="hidden sm:flex items-center gap-6 text-xs font-medium text-slate-400">
          <button
            type="button"
            onClick={() => onSelectSection('trade')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              activeSection === 'trade'
                ? 'text-white border-blue-500'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Markets
          </button>
          <button
            type="button"
            onClick={() => onSelectSection('news')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              activeSection === 'news'
                ? 'text-white border-blue-500'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            News
          </button>
          <button
            type="button"
            onClick={() => onSelectSection('lottery')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              activeSection === 'lottery'
                ? 'text-white border-emerald-500'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Lottery Live
          </button>
          <button
            type="button"
            onClick={() => onSelectSection('profile')}
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              activeSection === 'profile'
                ? 'text-white border-blue-500'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Account
          </button>
          <a
            href={csrTelegramLink}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap shrink-0 py-1 border-b-2 border-transparent hover:text-slate-200 transition-colors"
          >
            Support
          </a>
        </nav>
      ) : (
        <nav aria-label="Landing Navigation" className="hidden sm:flex items-center gap-6 text-xs font-medium text-slate-400">
          <a href="#markets-overview" className="whitespace-nowrap shrink-0 hover:text-slate-200 transition-colors">
            Markets
          </a>
          <a href="#live-activity" className="whitespace-nowrap shrink-0 hover:text-slate-200 transition-colors">
            Activity
          </a>
          <a href="#lottery-preview" className="whitespace-nowrap shrink-0 hover:text-slate-200 transition-colors">
            Lottery Live
          </a>
          <a href="#faq-section" className="whitespace-nowrap shrink-0 hover:text-slate-200 transition-colors">
            FAQ
          </a>
          <a href="#about-platform" className="whitespace-nowrap shrink-0 hover:text-slate-200 transition-colors">
            About
          </a>
          <a
            href={csrTelegramLink}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap shrink-0 hover:text-slate-200 transition-colors"
          >
            Support
          </a>
        </nav>
      )}

      {/* Zone 3: Single Primary Action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onPrimaryAction}
          className="px-3 sm:px-4 py-2 min-h-[36px] text-[11px] sm:text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-400"
        >
          {primaryActionLabel}
        </button>
      </div>
    </header>
  );
};

import React from 'react';
import { CandlestickChart, Newspaper, Trophy, User } from 'lucide-react';
import type { AppSection } from '../types';

interface MobileBottomNavProps {
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeSection,
  onSelectSection,
}) => {
  const items: { id: AppSection; label: string; icon: React.ReactNode }[] = [
    { id: 'trade', label: 'Trade', icon: <CandlestickChart className="w-4 h-4" aria-hidden="true" /> },
    { id: 'news', label: 'News', icon: <Newspaper className="w-4 h-4" aria-hidden="true" /> },
    { id: 'lottery', label: 'Lottery', icon: <Trophy className="w-4 h-4" aria-hidden="true" /> },
    { id: 'profile', label: 'Account', icon: <User className="w-4 h-4" aria-hidden="true" /> },
  ];

  return (
    <nav
      aria-label="Mobile Navigation"
      className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/90 pb-safe"
    >
      <div className="grid grid-cols-4 items-center h-14">
        {items.map((item) => {
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center min-h-[44px] w-full transition-colors ${
                active ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.icon}
              <span className="text-[10px] font-medium tracking-tight mt-0.5 whitespace-nowrap">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

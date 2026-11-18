import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Newspaper, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import type { NewsArticle, NewsCategory } from '../types';
import { formatNewsTimestamp, NEWS_CATEGORIES, partitionEditorialNews } from '../utils/newsUtils';
import leadMacroImg from '../assets/images/news_lead_macro_1794937556483.jpg';
import cryptoLiquidityImg from '../assets/images/news_crypto_liquidity_1794937557683.jpg';
import commoditiesDeskImg from '../assets/images/news_commodities_desk_1794937558337.jpg';

const PRESET_NEWS_ASSET_MAP: Record<string, string> = {
  '/src/assets/images/news_lead_macro_1794937556483.jpg': leadMacroImg,
  '/src/assets/images/news_crypto_liquidity_1794937557683.jpg': cryptoLiquidityImg,
  '/src/assets/images/news_commodities_desk_1794937558337.jpg': commoditiesDeskImg,
};

export function resolveNewsImageSrc(url?: string | null): string | null {
  if (!url) return null;
  if (PRESET_NEWS_ASSET_MAP[url]) return PRESET_NEWS_ASSET_MAP[url];
  return url;
}

interface NewsWorkspaceProps {
  articles: NewsArticle[];
  loading: boolean;
  isAdmin: boolean;
  onRefresh: () => void;
  onOpenAdminNewsDesk: () => void;
  onNavigateToTrade: () => void;
}

export const NewsWorkspace: React.FC<NewsWorkspaceProps> = ({
  articles,
  loading,
  isAdmin,
  onRefresh,
  onOpenAdminNewsDesk,
  onNavigateToTrade,
}) => {
  const [activeCategory, setActiveCategory] = useState<NewsCategory | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);

  const selectedArticle = useMemo(
    () => articles.find((a) => a.id === selectedArticleId) ?? null,
    [articles, selectedArticleId]
  );

  const { leadStory, secondaryFeatures, briefRows, totalMatched } = useMemo(
    () => partitionEditorialNews({ articles, activeCategory, searchQuery }),
    [articles, activeCategory, searchQuery]
  );

  if (selectedArticle) {
    const resolvedHero = resolveNewsImageSrc(selectedArticle.imageUrl);
    const paragraphs = selectedArticle.content
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    return (
      <article
        aria-label={selectedArticle.title}
        data-testid="news-article-reader"
        className="max-w-3xl mx-auto py-2 sm:py-4 space-y-6"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <button
            type="button"
            onClick={() => setSelectedArticleId(null)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Back to News Desk</span>
          </button>

          <button
            type="button"
            onClick={onNavigateToTrade}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
          >
            <span>Open Markets</span>
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-400">
            <span className="text-amber-300 font-semibold">{selectedArticle.category}</span>
            <span aria-hidden="true">·</span>
            <span>{selectedArticle.authorName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{formatNewsTimestamp(selectedArticle.publishedAtMs)}</span>
            <span aria-hidden="true">·</span>
            <span>{selectedArticle.readTimeMin} min read</span>
          </div>

          <h1 className="font-serif text-2xl sm:text-4xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]">
            {selectedArticle.title}
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
            {selectedArticle.summary}
          </p>
        </header>

        {resolvedHero && (
          <figure className="space-y-2">
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 aspect-[16/9]">
              <img
                src={resolvedHero}
                alt={selectedArticle.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <figcaption className="text-xs font-serif italic text-slate-500">
              {selectedArticle.category} Dispatch — {selectedArticle.authorName}
            </figcaption>
          </figure>
        )}

        <div className="border-t border-slate-800/80 pt-6 space-y-5 max-w-2xl">
          {paragraphs.map((para, idx) => (
            <p
              key={idx}
              className={`text-[15px] sm:text-base text-slate-200 leading-relaxed ${
                idx === 0
                  ? 'first-letter:font-serif first-letter:text-5xl first-letter:font-bold first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:leading-none first-letter:text-amber-300'
                  : ''
              }`}
            >
              {para}
            </p>
          ))}
        </div>
      </article>
    );
  }

  return (
    <div data-testid="news-workspace" className="space-y-8">
      {/* Editorial Masthead & Admin Control Row */}
      <header className="border-b border-slate-800 pb-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-medium text-slate-400 tracking-wide">
              Zectrade Institutional Research · Market Dispatches &amp; Briefings
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight text-white [text-wrap:balance]">
              Market Intelligence &amp; News Desk
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Verified macroeconomic briefings, digital asset liquidity reports, commodity outlooks, and official platform notices.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRefresh}
              className="px-3.5 py-2 min-h-[40px] rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Refresh</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                data-testid="open-admin-news-btn"
                onClick={onOpenAdminNewsDesk}
                className="px-4 py-2 min-h-[40px] rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                <span>Manage News</span>
              </button>
            )}
          </div>
        </div>

        {/* Category Filter Tabs + Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="News Category Filter"
            className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto no-scrollbar"
          >
            {(['All', ...NEWS_CATEGORIES] as const).map((cat) => {
              const active = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 min-h-[34px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          <div className="relative w-full md:w-72 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search market news"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search headlines, desks, topics..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-8 py-2 min-h-[40px] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Loading State */}
      {loading && articles.length === 0 ? (
        <div className="py-16 text-center space-y-2 border border-slate-800 rounded-2xl bg-slate-900/50">
          <p className="text-sm font-semibold text-slate-300">Loading Market Dispatches...</p>
          <p className="text-xs text-slate-500">Synchronizing latest briefings from the editorial desk.</p>
        </div>
      ) : totalMatched === 0 ? (
        <div className="py-14 px-4 text-center space-y-3 border border-slate-800 rounded-2xl bg-slate-900/40">
          <Newspaper className="w-8 h-8 text-slate-500 mx-auto" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-200">No dispatches match your current filter</p>
            <p className="text-xs text-slate-400">
              Adjust your category tab or search keyword to view all published briefings.
            </p>
          </div>
          {(activeCategory !== 'All' || searchQuery.trim() !== '') && (
            <button
              type="button"
              onClick={() => {
                setActiveCategory('All');
                setSearchQuery('');
              }}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition-colors"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-10">
          {/* Tier 1: Lead Story (Asymmetric Split) */}
          {leadStory && (
            <section aria-label="Lead Market Story" data-testid="news-lead-story">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="lg:col-span-7 relative bg-slate-950 min-h-[220px] sm:min-h-[300px]">
                  {resolveNewsImageSrc(leadStory.imageUrl) ? (
                    <img
                      src={resolveNewsImageSrc(leadStory.imageUrl)!}
                      alt={leadStory.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover lg:h-full"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col justify-between p-6 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900">
                      <span className="text-xs font-mono text-amber-400">{leadStory.category}</span>
                      <p className="font-serif text-2xl text-slate-300/80 max-w-md">{leadStory.title}</p>
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
                </div>

                <div className="lg:col-span-5 p-5 sm:p-7 flex flex-col justify-between gap-5">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="font-semibold text-amber-300">{leadStory.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{leadStory.isFeatured ? 'Lead Dispatch' : 'Latest'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{formatNewsTimestamp(leadStory.publishedAtMs)}</span>
                    </div>

                    <h2 className="font-serif text-2xl sm:text-3xl font-bold text-white leading-snug [text-wrap:balance]">
                      {leadStory.title}
                    </h2>

                    <p className="text-sm text-slate-300 leading-relaxed">
                      {leadStory.summary}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-slate-400">
                      {leadStory.authorName} · {leadStory.readTimeMin} min read
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedArticleId(leadStory.id)}
                      className="px-4 py-2 min-h-[40px] rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <span>Read Full Dispatch</span>
                      <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Tier 2: Secondary Features */}
          {secondaryFeatures.length > 0 && (
            <section aria-label="Featured Briefings" className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <h2 className="text-sm font-bold text-slate-200">Desk Spotlights</h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {secondaryFeatures.length} featured
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {secondaryFeatures.map((item) => {
                  const imgSrc = resolveNewsImageSrc(item.imageUrl);
                  return (
                    <article
                      key={item.id}
                      className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden flex flex-col justify-between"
                    >
                      <div className="aspect-[16/10] bg-slate-950 overflow-hidden border-b border-slate-800">
                        {imgSrc ? (
                          <img
                            src={imgSrc}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full p-6 flex flex-col justify-between bg-gradient-to-br from-slate-900 to-slate-950">
                            <span className="text-xs font-semibold text-amber-300">{item.category}</span>
                            <p className="font-serif text-xl text-slate-200 leading-snug">{item.title}</p>
                          </div>
                        )}
                      </div>

                      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span className="font-semibold text-amber-300">{item.category}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{formatNewsTimestamp(item.publishedAtMs)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{item.readTimeMin} min read</span>
                          </div>

                          <h3 className="font-serif text-xl font-bold text-white leading-snug">
                            {item.title}
                          </h3>

                          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed line-clamp-3">
                            {item.summary}
                          </p>
                        </div>

                        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-400 truncate">{item.authorName}</span>
                          <button
                            type="button"
                            onClick={() => setSelectedArticleId(item.id)}
                            className="text-xs font-semibold text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                          >
                            <span>Read Article</span>
                            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {/* Tier 3: Dispatches & Archive List */}
          {briefRows.length > 0 && (
            <section aria-label="Latest Market Briefs" className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <h2 className="text-sm font-bold text-slate-200">Latest Dispatches &amp; Platform Notices</h2>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  {briefRows.length} {briefRows.length === 1 ? 'dispatch' : 'dispatches'}
                </span>
              </div>

              <div className="divide-y divide-slate-800/80 border-b border-slate-800">
                {briefRows.map((item) => (
                  <div
                    key={item.id}
                    className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 max-w-3xl">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="font-semibold text-amber-300">{item.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.authorName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{formatNewsTimestamp(item.publishedAtMs)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.readTimeMin} min read</span>
                      </div>

                      <h3 className="font-serif text-lg font-bold text-white leading-snug">
                        {item.title}
                      </h3>

                      <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                        {item.summary}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedArticleId(item.id)}
                      className="px-3.5 py-2 min-h-[38px] rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 self-start sm:self-center shrink-0 transition-colors whitespace-nowrap"
                    >
                      <span>Read</span>
                      <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

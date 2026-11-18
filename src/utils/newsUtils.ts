import type { NewsArticle, NewsCategory } from '../types';

export const NEWS_CATEGORIES: NewsCategory[] = [
  'Market Brief',
  'Macro & Rates',
  'Crypto',
  'Commodities',
  'Platform Update',
];

export const ALLOWED_NEWS_CATEGORIES = new Set<NewsCategory>(NEWS_CATEGORIES);

export function normalizeNewsCategory(raw?: string | null): NewsCategory {
  if (raw && ALLOWED_NEWS_CATEGORIES.has(raw as NewsCategory)) {
    return raw as NewsCategory;
  }
  return 'Market Brief';
}

export function estimateReadTimeMinutes(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.min(30, Math.ceil(words / 180)));
}

export function slugifyNewsTitle(title: string, suffix?: string | number): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'market-dispatch';
  return suffix !== undefined ? `${base}-${suffix}` : base;
}

export interface NewsArticleDraftInput {
  title?: unknown;
  summary?: unknown;
  content?: unknown;
  category?: unknown;
  authorName?: unknown;
  imageUrl?: unknown;
  isFeatured?: unknown;
  isPublished?: unknown;
}

export interface NormalizedNewsArticlePayload {
  title: string;
  summary: string;
  content: string;
  category: NewsCategory;
  authorName: string;
  imageUrl: string | null;
  isFeatured: boolean;
  isPublished: boolean;
  readTimeMin: number;
}

export function normalizeNewsArticleInput(
  input: NewsArticleDraftInput
): { ok: true; value: NormalizedNewsArticlePayload } | { ok: false; error: string } {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  const authorName =
    typeof input.authorName === 'string' && input.authorName.trim()
      ? input.authorName.trim().slice(0, 80)
      : 'Zectrade Research Desk';

  if (title.length < 4 || title.length > 180) {
    return { ok: false, error: 'Headline title must be between 4 and 180 characters.' };
  }
  if (summary.length < 10 || summary.length > 420) {
    return { ok: false, error: 'Summary deck must be between 10 and 420 characters.' };
  }
  if (content.length < 20) {
    return { ok: false, error: 'Article body must be at least 20 characters.' };
  }

  let imageUrl: string | null = null;
  if (typeof input.imageUrl === 'string' && input.imageUrl.trim()) {
    const trimmed = input.imageUrl.trim();
    const isValidLocalOrData =
      trimmed.startsWith('/src/assets/images/') ||
      trimmed.startsWith('/assets/') ||
      /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(trimmed);
    if (!isValidLocalOrData) {
      return { ok: false, error: 'Cover image must be a verified local asset or uploaded image.' };
    }
    if (trimmed.length > 900_000) {
      return { ok: false, error: 'Uploaded cover image is too large (max ~650 KB).' };
    }
    imageUrl = trimmed;
  }

  return {
    ok: true,
    value: {
      title,
      summary,
      content,
      category: normalizeNewsCategory(typeof input.category === 'string' ? input.category : undefined),
      authorName,
      imageUrl,
      isFeatured: Boolean(input.isFeatured),
      isPublished: input.isPublished !== false,
      readTimeMin: estimateReadTimeMinutes(content),
    },
  };
}

export interface EditorialNewsPartition {
  leadStory: NewsArticle | null;
  secondaryFeatures: NewsArticle[];
  briefRows: NewsArticle[];
  totalMatched: number;
}

export function partitionEditorialNews(params: {
  articles: NewsArticle[];
  activeCategory?: NewsCategory | 'All';
  searchQuery?: string;
}): EditorialNewsPartition {
  const { articles, activeCategory = 'All', searchQuery = '' } = params;
  const q = searchQuery.trim().toLowerCase();

  const filtered = articles
    .filter((a) => {
      if (!a.isPublished) return false;
      if (activeCategory !== 'All' && a.category !== activeCategory) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.authorName.toLowerCase().includes(q)
      );
    })
    .slice()
    .sort((a, b) => {
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
      return b.publishedAtMs - a.publishedAtMs;
    });

  if (filtered.length === 0) {
    return {
      leadStory: null,
      secondaryFeatures: [],
      briefRows: [],
      totalMatched: 0,
    };
  }

  const leadStory = filtered[0];
  const rest = filtered.slice(1);
  const secondaryFeatures = rest.slice(0, 2);
  const briefRows = rest.slice(2);

  return {
    leadStory,
    secondaryFeatures,
    briefRows,
    totalMatched: filtered.length,
  };
}

export function formatNewsTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Today';
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import { createDefaultNewsArticles } from '../data/defaults';
import type { NewsArticle, NewsCategory } from '../types';
import {
  normalizeNewsArticleInput,
  normalizeNewsCategory,
  slugifyNewsTitle,
} from '../utils/newsUtils';
import { db, isFirebaseConfigured } from './firebaseClient';
import { readStorageJson, writeStorageJson } from './storageHelper';

const NEWS_STORAGE_KEY = 'zectrade_news_v1';

interface StoredNewsPayload {
  initialized: boolean;
  articles: NewsArticle[];
}

function sortNewsArticles(articles: NewsArticle[]): NewsArticle[] {
  return [...articles].sort((a, b) => {
    if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
    if (b.publishedAtMs !== a.publishedAtMs) return b.publishedAtMs - a.publishedAtMs;
    return b.id - a.id;
  });
}

function readStoredNewsState(): StoredNewsPayload {
  const saved = readStorageJson<StoredNewsPayload | NewsArticle[]>(NEWS_STORAGE_KEY);
  if (Array.isArray(saved)) {
    const payload: StoredNewsPayload = { initialized: true, articles: saved };
    writeStorageJson(NEWS_STORAGE_KEY, payload);
    return payload;
  }
  if (saved && saved.initialized && Array.isArray(saved.articles)) {
    return saved;
  }
  const seeded: StoredNewsPayload = {
    initialized: true,
    articles: createDefaultNewsArticles(),
  };
  writeStorageJson(NEWS_STORAGE_KEY, seeded);
  return seeded;
}

function saveStoredNewsState(articles: NewsArticle[]): NewsArticle[] {
  const sorted = sortNewsArticles(articles);
  writeStorageJson(NEWS_STORAGE_KEY, {
    initialized: true,
    articles: sorted,
  } satisfies StoredNewsPayload);
  return sorted;
}

function coerceFirestoreArticle(idStr: string, raw: Record<string, unknown>): NewsArticle | null {
  const numericId = Number(raw.id ?? idStr);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const title = typeof raw.title === 'string' ? raw.title : '';
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  const content = typeof raw.content === 'string' ? raw.content : '';
  if (!title || !content) return null;
  const publishedAtMs = Number(raw.publishedAtMs ?? Date.now());
  return {
    id: Math.round(numericId),
    slug: typeof raw.slug === 'string' && raw.slug ? raw.slug : slugifyNewsTitle(title, String(numericId)),
    title,
    summary: summary || content.slice(0, 140),
    content,
    category: normalizeNewsCategory(String(raw.category ?? 'Market Brief')),
    authorName: typeof raw.authorName === 'string' && raw.authorName ? raw.authorName : 'Zectrade Research Desk',
    imageUrl: typeof raw.imageUrl === 'string' && raw.imageUrl.trim() ? raw.imageUrl.trim() : null,
    isFeatured: Boolean(raw.isFeatured),
    isPublished: raw.isPublished !== false,
    readTimeMin: Math.max(1, Math.round(Number(raw.readTimeMin ?? 2))),
    publishedAtMs,
    updatedAtMs: Number(raw.updatedAtMs ?? publishedAtMs),
  };
}

async function mirrorArticleToFirestore(article: NewsArticle): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    await setDoc(doc(db, 'newsArticles', String(article.id)), {
      ...article,
      imageUrl: article.imageUrl ?? null,
    });
  } catch {
    // Graceful localStorage fallback if offline or Firestore rules disallow client writes
  }
}

async function deleteArticleFromFirestore(id: number): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    await deleteDoc(doc(db, 'newsArticles', String(id)));
  } catch {
    // Graceful localStorage fallback
  }
}

export function getInitialNewsArticlesSync(includeDrafts = false): NewsArticle[] {
  const { articles } = readStoredNewsState();
  const sorted = sortNewsArticles(articles);
  return includeDrafts ? sorted : sorted.filter((a) => a.isPublished);
}

export async function listNewsArticlesStatic(includeDrafts = false): Promise<NewsArticle[]> {
  const localState = readStoredNewsState();
  let merged = localState.articles;

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(collection(db, 'newsArticles'));
      if (!snap.empty) {
        const remoteMap = new Map<number, NewsArticle>();
        snap.forEach((d) => {
          const parsed = coerceFirestoreArticle(d.id, d.data());
          if (parsed) remoteMap.set(parsed.id, parsed);
        });
        if (remoteMap.size > 0) {
          const localMap = new Map(merged.map((a) => [a.id, a]));
          for (const [id, remoteItem] of remoteMap.entries()) {
            const localItem = localMap.get(id);
            if (!localItem || remoteItem.updatedAtMs > localItem.updatedAtMs) {
              localMap.set(id, remoteItem);
            }
          }
          merged = saveStoredNewsState(Array.from(localMap.values()));
        }
      } else {
        // Seed Firestore silently on first online admin access if collection is empty
        await Promise.all(merged.map((a) => mirrorArticleToFirestore(a)));
      }
    } catch {
      // Keep local articles cleanly when offline or blocked by rules
    }
  }

  const sorted = sortNewsArticles(merged);
  return includeDrafts ? sorted : sorted.filter((a) => a.isPublished);
}

export async function createNewsArticleStatic(payload: {
  title: string;
  summary?: string;
  content: string;
  category?: NewsCategory | string;
  authorName?: string;
  imageUrl?: string | null;
  isFeatured?: boolean;
  isPublished?: boolean;
}): Promise<{ ok: true; article: NewsArticle; articles: NewsArticle[] } | { ok: false; error: string }> {
  const normalized = normalizeNewsArticleInput(payload);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }

  const state = readStoredNewsState();
  const now = Date.now();
  const maxId = state.articles.reduce((max, item) => Math.max(max, item.id), 0);
  const nextId = maxId + 1;

  let nextList = state.articles;
  const affectedArticles: NewsArticle[] = [];
  if (normalized.value.isFeatured) {
    nextList = nextList.map((item) => {
      if (item.isFeatured) {
        const updated = { ...item, isFeatured: false, updatedAtMs: now };
        affectedArticles.push(updated);
        return updated;
      }
      return item;
    });
  }

  const created: NewsArticle = {
    id: nextId,
    slug: slugifyNewsTitle(normalized.value.title, now.toString(36)),
    title: normalized.value.title,
    summary: normalized.value.summary,
    content: normalized.value.content,
    category: normalized.value.category,
    authorName: normalized.value.authorName,
    imageUrl: normalized.value.imageUrl,
    isFeatured: normalized.value.isFeatured,
    isPublished: normalized.value.isPublished,
    readTimeMin: normalized.value.readTimeMin,
    publishedAtMs: now,
    updatedAtMs: now,
  };

  const saved = saveStoredNewsState([created, ...nextList]);
  await Promise.all([
    mirrorArticleToFirestore(created),
    ...affectedArticles.map((a) => mirrorArticleToFirestore(a)),
  ]);

  return { ok: true, article: created, articles: saved };
}

export async function updateNewsArticleStatic(
  id: number,
  updates: Partial<{
    title: string;
    summary: string;
    content: string;
    category: NewsCategory | string;
    authorName: string;
    imageUrl: string | null;
    isFeatured: boolean;
    isPublished: boolean;
  }>
): Promise<{ ok: true; article: NewsArticle; articles: NewsArticle[] } | { ok: false; error: string }> {
  const state = readStoredNewsState();
  const target = state.articles.find((a) => a.id === id);
  if (!target) {
    return { ok: false, error: 'News article not found.' };
  }

  const mergedInput = {
    title: updates.title ?? target.title,
    summary: updates.summary ?? target.summary,
    content: updates.content ?? target.content,
    category: updates.category ?? target.category,
    authorName: updates.authorName ?? target.authorName,
    imageUrl: updates.imageUrl !== undefined ? updates.imageUrl : target.imageUrl,
    isFeatured: updates.isFeatured !== undefined ? updates.isFeatured : target.isFeatured,
    isPublished: updates.isPublished !== undefined ? updates.isPublished : target.isPublished,
  };

  const normalized = normalizeNewsArticleInput(mergedInput);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }

  const now = Date.now();
  const changed: NewsArticle[] = [];

  const updatedTarget: NewsArticle = {
    ...target,
    title: normalized.value.title,
    summary: normalized.value.summary,
    content: normalized.value.content,
    category: normalized.value.category,
    authorName: normalized.value.authorName,
    imageUrl: normalized.value.imageUrl,
    isFeatured: normalized.value.isFeatured,
    isPublished: normalized.value.isPublished,
    readTimeMin: normalized.value.readTimeMin,
    updatedAtMs: now,
  };
  changed.push(updatedTarget);

  const nextList = state.articles.map((item) => {
    if (item.id === id) return updatedTarget;
    if (updatedTarget.isFeatured && item.isFeatured) {
      const cleared = { ...item, isFeatured: false, updatedAtMs: now };
      changed.push(cleared);
      return cleared;
    }
    return item;
  });

  const saved = saveStoredNewsState(nextList);
  await Promise.all(changed.map((a) => mirrorArticleToFirestore(a)));

  return { ok: true, article: updatedTarget, articles: saved };
}

export async function deleteNewsArticleStatic(
  id: number
): Promise<{ ok: true; articles: NewsArticle[] } | { ok: false; error: string }> {
  const state = readStoredNewsState();
  const exists = state.articles.some((a) => a.id === id);
  if (!exists) {
    return { ok: false, error: 'News article not found.' };
  }
  const saved = saveStoredNewsState(state.articles.filter((a) => a.id !== id));
  await deleteArticleFromFirestore(id);
  return { ok: true, articles: saved };
}

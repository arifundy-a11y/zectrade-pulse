import { desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { newsArticles } from './schema.ts';
import type { NewsArticle, NewsCategory } from '../types.ts';
import { normalizeNewsCategory, slugifyNewsTitle } from '../utils/newsUtils.ts';

function toNewsDto(row: typeof newsArticles.$inferSelect): NewsArticle {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    content: row.content,
    category: normalizeNewsCategory(row.category),
    authorName: row.authorName,
    imageUrl: row.imageUrl ?? null,
    isFeatured: row.isFeatured,
    isPublished: row.isPublished,
    readTimeMin: row.readTimeMin,
    publishedAtMs: row.publishedAtMs,
    updatedAtMs: row.updatedAt ? new Date(row.updatedAt).getTime() : row.publishedAtMs,
  };
}

let seedPromise: Promise<void> | null = null;

export async function ensureNewsSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const existing = await db.select({ id: newsArticles.id }).from(newsArticles).limit(1);
    if (existing.length > 0) return;

    const now = Date.now();
    const hour = 60 * 60 * 1000;

    const initialDispatches: Array<{
      slug: string;
      title: string;
      summary: string;
      content: string;
      category: NewsCategory;
      authorName: string;
      imageUrl: string | null;
      isFeatured: boolean;
      isPublished: boolean;
      readTimeMin: number;
      publishedAtMs: number;
    }> = [
      {
        slug: 'global-liquidity-flows-tighten-central-bank-policy-week',
        title: 'Global Liquidity Flows Steady Ahead of Central Bank Policy Decisions',
        summary:
          'Treasury yields hold near recent corridors as institutional desks rebalance cross-asset exposure across dollar indices, sovereign bonds, and major crypto pairs.',
        content: [
          'Institutional trading desks entered the weekly session with disciplined positioning ahead of major central bank policy announcements and updated forward guidance on benchmark overnight rates.',
          'Order-book liquidity across primary dollar crosses and sovereign yield benchmarks remained concentrated within tight intraday bands, signaling cautious risk deployment rather than aggressive directional liquidation.',
          'Cross-asset desks report that macro funds have paired selective long duration exposure with hedged perpetual futures positions in Bitcoin and Ethereum to insulate portfolios against headline rate surprises.',
          'Traders monitoring intraday volatility should watch Treasury auction demand metrics and London-New York session overlap spreads, where institutional block execution typically sets the directional tone for the remainder of the week.',
        ].join('\n\n'),
        category: 'Macro & Rates',
        authorName: 'Elena Vance · Macro Strategy',
        imageUrl: '/src/assets/images/news_lead_macro_1794937556483.jpg',
        isFeatured: true,
        isPublished: true,
        readTimeMin: 3,
        publishedAtMs: now - 1 * hour,
      },
      {
        slug: 'institutional-spot-desk-volumes-expand-btc-eth-perpetuals',
        title: 'Institutional Spot Volumes Expand Across BTC and ETH Perpetual Venues',
        summary:
          'Balanced funding rates and deeper resting bid liquidity point to constructive accumulation rather than over-leveraged retail chasing.',
        content: [
          'Spot-to-perpetual volume ratios improved markedly over the past 48 hours as market makers tightened top-of-book spreads on flagship Bitcoin and Ethereum pairs.',
          'Unlike previous speculative rallies marked by steeply positive perpetual funding, current derivatives pricing reflects measured two-way hedging and healthy open-interest turnover.',
          'Analysts note that sustained spot inflows during Asia and European market opens continue to anchor support zones while reducing forced liquidation cascades during brief pullbacks.',
        ].join('\n\n'),
        category: 'Crypto',
        authorName: 'Marcus Chen · Digital Assets Desk',
        imageUrl: '/src/assets/images/news_crypto_liquidity_1794937557683.jpg',
        isFeatured: false,
        isPublished: true,
        readTimeMin: 3,
        publishedAtMs: now - 3 * hour,
      },
      {
        slug: 'gold-bullion-holds-structural-support-energy-routes-shift',
        title: 'Gold Bullion Holds Structural Support as Crude Markets Track Maritime Flows',
        summary:
          'Physical reserve demand underpins precious metals while refinery margin spreads and freight schedules keep WTI crude pricing responsive.',
        content: [
          'Spot gold continues to attract defensive allocation from multi-asset portfolios seeking protection against sovereign fiscal expansion and currency valuation swings.',
          'Across energy desks, West Texas Intermediate (WTI) crude futures traded within an active range as traders balanced seasonal refinery maintenance schedules against shifting global tanker routing metrics.',
          'Commodity strategists emphasize watching inventory drawdowns alongside dollar index momentum to gauge whether bullion breaks above upper resistance or consolidates near weekly VWAP.',
        ].join('\n\n'),
        category: 'Commodities',
        authorName: 'David Okafor · Commodities Desk',
        imageUrl: '/src/assets/images/news_commodities_desk_1794937558337.jpg',
        isFeatured: false,
        isPublished: true,
        readTimeMin: 3,
        publishedAtMs: now - 6 * hour,
      },
      {
        slug: 'solana-layer1-open-interest-rebalances-spot-rotation',
        title: 'Solana and Layer-1 Open Interest Rebalances After Spot Rotation',
        summary:
          'Derivatives positioning resets to neutral leverage multiples following sharp intraday rotation across high-throughput ecosystems.',
        content: [
          'Major Layer-1 digital assets experienced constructive deleveraging overnight as short-term momentum accounts locked in gains and spot buyers stepped in along key 15-minute moving averages.',
          'Lower aggregate leverage across SOL, BNB, and AVAX markets reduces tail-risk sensitivity and sets a cleaner foundation for technical trend continuation.',
        ].join('\n\n'),
        category: 'Market Brief',
        authorName: 'Zectrade Research Desk',
        imageUrl: null,
        isFeatured: false,
        isPublished: true,
        readTimeMin: 2,
        publishedAtMs: now - 11 * hour,
      },
      {
        slug: 'zectrade-realtime-pnl-analytics-and-withdraw-transparency',
        title: 'Platform Notice: Real-Time Asset PnL Analytics & MMK Rate Transparency Live',
        summary:
          'Traders can now inspect per-asset cumulative PnL growth in real time inside Markets and verify live USD/MMK payout conversion rates before submitting requests.',
        content: [
          'Zectrade Pulse has deployed our latest trading analytics upgrade inside the Markets workspace, enabling members to monitor closed trade performance alongside live open mark-to-market PnL for each selected pair.',
          'In addition, the Withdrawal panel now surfaces live USD-to-MMK exchange rates and maximum payout previews automatically whenever local MMK payout channels are selected.',
          'All market dispatches and operational announcements published on the News Desk are curated directly by platform leadership to ensure verified, timely updates.',
        ].join('\n\n'),
        category: 'Platform Update',
        authorName: 'Zectrade Operations',
        imageUrl: null,
        isFeatured: false,
        isPublished: true,
        readTimeMin: 2,
        publishedAtMs: now - 18 * hour,
      },
    ];

    for (const item of initialDispatches) {
      await db.insert(newsArticles).values(item).onConflictDoNothing();
    }
  })();
  try {
    await seedPromise;
  } catch (err) {
    seedPromise = null;
    throw err;
  }
}

export async function listNewsArticles(includeDrafts = false): Promise<NewsArticle[]> {
  await ensureNewsSeeded();
  const rows = includeDrafts
    ? await db
        .select()
        .from(newsArticles)
        .orderBy(desc(newsArticles.isFeatured), desc(newsArticles.publishedAtMs), desc(newsArticles.id))
    : await db
        .select()
        .from(newsArticles)
        .where(eq(newsArticles.isPublished, true))
        .orderBy(desc(newsArticles.isFeatured), desc(newsArticles.publishedAtMs), desc(newsArticles.id));
  return rows.map(toNewsDto);
}

export async function createNewsArticle(payload: {
  title: string;
  summary: string;
  content: string;
  category: NewsCategory;
  authorName: string;
  imageUrl: string | null;
  isFeatured: boolean;
  isPublished: boolean;
  readTimeMin: number;
}): Promise<NewsArticle> {
  await ensureNewsSeeded();
  const now = Date.now();
  const slug = slugifyNewsTitle(payload.title, now.toString(36));

  if (payload.isFeatured) {
    await db.update(newsArticles).set({ isFeatured: false, updatedAt: new Date() });
  }

  const [inserted] = await db
    .insert(newsArticles)
    .values({
      slug,
      title: payload.title,
      summary: payload.summary,
      content: payload.content,
      category: payload.category,
      authorName: payload.authorName,
      imageUrl: payload.imageUrl,
      isFeatured: payload.isFeatured,
      isPublished: payload.isPublished,
      readTimeMin: payload.readTimeMin,
      publishedAtMs: now,
    })
    .returning();

  return toNewsDto(inserted);
}

export async function updateNewsArticle(
  id: number,
  updates: Partial<{
    title: string;
    summary: string;
    content: string;
    category: NewsCategory;
    authorName: string;
    imageUrl: string | null;
    isFeatured: boolean;
    isPublished: boolean;
    readTimeMin: number;
  }>
): Promise<NewsArticle | null> {
  await ensureNewsSeeded();
  if (updates.isFeatured) {
    await db.update(newsArticles).set({ isFeatured: false, updatedAt: new Date() });
  }

  const [updated] = await db
    .update(newsArticles)
    .set({
      ...(updates.title !== undefined ? { title: updates.title } : {}),
      ...(updates.summary !== undefined ? { summary: updates.summary } : {}),
      ...(updates.content !== undefined ? { content: updates.content } : {}),
      ...(updates.category !== undefined ? { category: updates.category } : {}),
      ...(updates.authorName !== undefined ? { authorName: updates.authorName } : {}),
      ...(updates.imageUrl !== undefined ? { imageUrl: updates.imageUrl } : {}),
      ...(updates.isFeatured !== undefined ? { isFeatured: updates.isFeatured } : {}),
      ...(updates.isPublished !== undefined ? { isPublished: updates.isPublished } : {}),
      ...(updates.readTimeMin !== undefined ? { readTimeMin: updates.readTimeMin } : {}),
      updatedAt: new Date(),
    })
    .where(eq(newsArticles.id, id))
    .returning();

  return updated ? toNewsDto(updated) : null;
}

export async function deleteNewsArticle(id: number): Promise<boolean> {
  const deleted = await db
    .delete(newsArticles)
    .where(eq(newsArticles.id, id))
    .returning({ id: newsArticles.id });
  return deleted.length > 0;
}

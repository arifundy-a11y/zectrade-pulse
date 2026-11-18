import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateReadTimeMinutes,
  normalizeNewsArticleInput,
  partitionEditorialNews,
  slugifyNewsTitle,
} from './newsUtils';
import type { NewsArticle } from '../types';

function makeArticle(overrides: Partial<NewsArticle>): NewsArticle {
  return {
    id: 1,
    slug: 'sample-article',
    title: 'Sample Institutional Market Dispatch',
    summary: 'Key liquidity developments across major pairs and derivatives desks.',
    content: 'Detailed market commentary covering macro yields, perpetual funding, and spot order depth.',
    category: 'Market Brief',
    authorName: 'Zectrade Research Desk',
    imageUrl: null,
    isFeatured: false,
    isPublished: true,
    readTimeMin: 3,
    publishedAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

test('normalizeNewsArticleInput validates title, summary, content, and image URL safety', () => {
  const invalidShort = normalizeNewsArticleInput({
    title: 'Hi',
    summary: 'Short',
    content: 'Too brief',
  });
  assert.equal(invalidShort.ok, false);

  const invalidExternalImg = normalizeNewsArticleInput({
    title: 'Central Bank Policy Preview',
    summary: 'Rate expectations shift ahead of Thursday policy decision.',
    content: 'Markets are pricing a narrower path for rate cuts after stronger services inflation.',
    imageUrl: 'https://untrusted.example.com/photo.jpg',
  });
  assert.equal(invalidExternalImg.ok, false);

  const valid = normalizeNewsArticleInput({
    title: 'Spot BTC Liquidity Deepens',
    summary: 'Institutional spot desks absorb intraday volatility across Asian and London opens.',
    content: Array(200).fill('liquidity').join(' '),
    category: 'Crypto',
    authorName: 'Research Team',
    imageUrl: '/src/assets/images/news_crypto_liquidity_1794937557683.jpg',
    isFeatured: true,
    isPublished: true,
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.category, 'Crypto');
    assert.equal(valid.value.readTimeMin, 2);
    assert.equal(valid.value.isFeatured, true);
  }
});

test('partitionEditorialNews orders featured lead first, 2 secondary features, and remaining briefs', () => {
  const articles: NewsArticle[] = [
    makeArticle({ id: 1, title: 'Brief Alpha', publishedAtMs: 5000, isFeatured: false }),
    makeArticle({ id: 2, title: 'Lead Macro Story', publishedAtMs: 2000, isFeatured: true, category: 'Macro & Rates' }),
    makeArticle({ id: 3, title: 'Secondary Crypto', publishedAtMs: 4000, isFeatured: false, category: 'Crypto' }),
    makeArticle({ id: 4, title: 'Secondary Commodities', publishedAtMs: 3000, isFeatured: false, category: 'Commodities' }),
    makeArticle({ id: 5, title: 'Unpublished Draft', publishedAtMs: 9999, isFeatured: true, isPublished: false }),
  ];

  const all = partitionEditorialNews({ articles, activeCategory: 'All' });
  assert.equal(all.totalMatched, 4);
  assert.equal(all.leadStory?.id, 2);
  assert.deepEqual(
    all.secondaryFeatures.map((a) => a.id),
    [1, 3]
  );
  assert.deepEqual(
    all.briefRows.map((a) => a.id),
    [4]
  );

  const cryptoFiltered = partitionEditorialNews({ articles, activeCategory: 'Crypto' });
  assert.equal(cryptoFiltered.totalMatched, 1);
  assert.equal(cryptoFiltered.leadStory?.title, 'Secondary Crypto');

  const searchFiltered = partitionEditorialNews({ articles, searchQuery: 'Commodities' });
  assert.equal(searchFiltered.totalMatched, 1);
  assert.equal(searchFiltered.leadStory?.id, 4);
});

test('estimateReadTimeMinutes and slugifyNewsTitle produce deterministic results', () => {
  assert.equal(estimateReadTimeMinutes('one two three'), 1);
  assert.equal(slugifyNewsTitle('Gold Bullion & Crude Outlook 2026!', 7), 'gold-bullion-crude-outlook-2026-7');
});

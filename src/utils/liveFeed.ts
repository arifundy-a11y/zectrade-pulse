import type { LiveFeedItem } from '../types';

const FEED_METHODS = ['KBZPay', 'WavePay', 'USDT TRC20', 'Bank Transfer'] as const;

export function buildDeterministicLiveFeedItem(nowMs: number = Date.now()): LiveFeedItem {
  const slot = Math.floor(nowMs / 4500);
  const isWithdraw = slot % 3 === 0;
  const method = FEED_METHODS[Math.abs(slot) % FEED_METHODS.length];
  const amount = 120 + ((Math.abs(slot) * 173) % 880);
  const hexA = ((Math.abs(slot) * 4919) & 0xffff).toString(16).padStart(4, '0');
  const hexB = ((Math.abs(slot) * 7919) & 0xfff).toString(16).padStart(3, '0');
  const masked =
    method === 'USDT TRC20'
      ? `0x${hexA}...${hexB}`
      : `09${(Math.abs(slot) % 8) + 1}***${100 + ((Math.abs(slot) * 97) % 899)}`;

  return {
    id: `feed-${slot}`,
    type: isWithdraw ? 'WITHDRAWAL' : 'DEPOSIT',
    method,
    amount,
    user: masked,
    time: 'Just now',
  };
}

export function appendDeterministicLiveFeedItem(
  prev: LiveFeedItem[],
  nowMs: number = Date.now(),
  maxItems: number = 4
): LiveFeedItem[] {
  const nextItem = buildDeterministicLiveFeedItem(nowMs);
  if (prev.some((item) => item.id === nextItem.id)) {
    return prev;
  }
  const seen = new Set<string>([nextItem.id]);
  const dedupedPrev = prev.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return [nextItem, ...dedupedPrev].slice(0, maxItems);
}

import React, { useEffect, useRef, useState } from 'react';
import { formatStatDisplay, interpolateStatValue } from '../utils/platformStats';

interface AnimatedStatNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  className?: string;
  testId?: string;
  ariaLabel?: string;
}

export const AnimatedStatNumber: React.FC<AnimatedStatNumberProps> = ({
  value,
  prefix = '',
  suffix = '',
  durationMs = 1800,
  className = '',
  testId,
  ariaLabel,
}) => {
  const targetValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const elRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const hasRevealedRef = useRef(false);
  const displayValueRef = useRef(0);

  const [inView, setInView] = useState(false);
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const node = elRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const startValue = hasRevealedRef.current ? displayValueRef.current : 0;
    hasRevealedRef.current = true;

    if (prefersReducedMotion || startValue === targetValue || durationMs <= 0) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      displayValueRef.current = targetValue;
      setDisplayValue(targetValue);
      return;
    }

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const nextVal = interpolateStatValue(startValue, targetValue, progress);

      displayValueRef.current = nextVal;
      setDisplayValue(nextVal);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        displayValueRef.current = targetValue;
        setDisplayValue(targetValue);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [inView, targetValue, durationMs]);

  return (
    <span
      ref={elRef}
      data-testid={testId}
      aria-label={ariaLabel}
      className={`tabular-nums whitespace-nowrap ${className}`}
    >
      {formatStatDisplay(displayValue, prefix, suffix)}
    </span>
  );
};

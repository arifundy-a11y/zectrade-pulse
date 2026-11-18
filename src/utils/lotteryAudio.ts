const SOUND_STORAGE_KEY = 'zectrade_lottery_sound_enabled';

type BrowserAudioWindow = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

class LotteryAudioEngine {
  private ctx: AudioContext | null = null;
  private enabled: boolean = true;
  private rollTimers: number[] = [];

  constructor() {
    this.enabled = this.readInitialPreference();
  }

  private readInitialPreference(): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return true;
      const saved = window.localStorage.getItem(SOUND_STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(next: boolean): boolean {
    this.enabled = Boolean(next);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(SOUND_STORAGE_KEY, String(this.enabled));
      }
    } catch {
      // Ignore storage failures
    }
    if (!this.enabled) {
      this.clearRollTimers();
    } else {
      this.unlock();
    }
    return this.enabled;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const win = window as BrowserAudioWindow;
        const Ctor = win.AudioContext || win.webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {
          // Ignore autoplay restriction until explicit gesture
        });
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  public unlock(): void {
    if (!this.enabled) return;
    this.ensureContext();
  }

  private playTone(params: {
    freq: number;
    endFreq?: number;
    durationSec: number;
    gainPeak: number;
    type?: OscillatorType;
    delaySec?: number;
  }): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    try {
      const start = ctx.currentTime + (params.delaySec ?? 0);
      const end = start + Math.max(0.015, params.durationSec);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = params.type ?? 'sine';
      osc.frequency.setValueAtTime(params.freq, start);
      if (typeof params.endFreq === 'number') {
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, params.endFreq), end);
      }

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(params.gainPeak, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(end + 0.01);
    } catch {
      // Never propagate audio errors to UI
    }
  }

  public playCountdownTick(urgent: boolean): void {
    if (!this.enabled) return;
    if (urgent) {
      this.playTone({
        freq: 920,
        endFreq: 720,
        durationSec: 0.045,
        gainPeak: 0.08,
        type: 'triangle',
      });
    } else {
      this.playTone({
        freq: 560,
        endFreq: 480,
        durationSec: 0.028,
        gainPeak: 0.035,
        type: 'sine',
      });
    }
  }

  public playBetConfirm(): void {
    if (!this.enabled) return;
    this.playTone({
      freq: 523.25,
      durationSec: 0.075,
      gainPeak: 0.07,
      type: 'triangle',
      delaySec: 0,
    });
    this.playTone({
      freq: 783.99,
      durationSec: 0.11,
      gainPeak: 0.08,
      type: 'triangle',
      delaySec: 0.065,
    });
  }

  public clearRollTimers(): void {
    if (typeof window === 'undefined') return;
    for (const id of this.rollTimers) {
      window.clearTimeout(id);
    }
    this.rollTimers = [];
  }

  public playRollSequence(durationMs = 1350): void {
    this.clearRollTimers();
    if (!this.enabled || typeof window === 'undefined') return;

    // Decelerating mechanical tumbler clicks across the physical roll duration
    const steps = 14;
    for (let i = 0; i < steps; i += 1) {
      const progress = i / (steps - 1);
      // Ease-out spacing: ticks start fast and spread out as drum slows
      const easedTime = Math.round(Math.pow(progress, 1.55) * (durationMs - 140));
      const pitch = 340 + (1 - progress) * 240;
      const timerId = window.setTimeout(() => {
        this.playTone({
          freq: pitch,
          endFreq: pitch * 0.72,
          durationSec: 0.026,
          gainPeak: 0.045,
          type: 'triangle',
        });
      }, easedTime);
      this.rollTimers.push(timerId);
    }
  }

  public playWin(): void {
    if (!this.enabled) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      this.playTone({
        freq,
        durationSec: idx === notes.length - 1 ? 0.28 : 0.12,
        gainPeak: 0.095,
        type: 'triangle',
        delaySec: idx * 0.08,
      });
    });
  }

  public playLoss(): void {
    if (!this.enabled) return;
    this.playTone({
      freq: 310,
      endFreq: 240,
      durationSec: 0.16,
      gainPeak: 0.075,
      type: 'sine',
      delaySec: 0,
    });
    this.playTone({
      freq: 220,
      endFreq: 165,
      durationSec: 0.24,
      gainPeak: 0.07,
      type: 'sine',
      delaySec: 0.15,
    });
  }

  public playRoundResult(): void {
    if (!this.enabled) return;
    this.playTone({
      freq: 659.25,
      endFreq: 698.46,
      durationSec: 0.18,
      gainPeak: 0.06,
      type: 'sine',
    });
  }
}

export const lotteryAudio = new LotteryAudioEngine();

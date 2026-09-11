import type { Accuracy } from '../core/accuracy';

/**
 * The reveal's three sounds, synthesised with the Web Audio API: no files, no licences.
 * Red is a soft low drop, green a bright two-note rise, gold a four-note chime.
 */

type Wave = OscillatorType;

interface Note {
  /** Seconds after the reveal. */
  readonly at: number;
  readonly freq: number;
  /** Where the pitch glides to, for the red drop. */
  readonly to?: number;
  readonly length: number;
  readonly gain: number;
  readonly wave: Wave;
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;

/** The notes each outcome plays. Exported for tests. */
export const NOTES: Record<Accuracy, readonly Note[]> = {
  off: [
    { at: 0, freq: 233, to: 175, length: 0.26, gain: 0.16, wave: 'triangle' },
    { at: 0, freq: 116.5, to: 87.5, length: 0.26, gain: 0.08, wave: 'sine' },
  ],
  close: [
    { at: 0, freq: E5, length: 0.16, gain: 0.12, wave: 'triangle' },
    { at: 0.09, freq: A5, length: 0.26, gain: 0.12, wave: 'triangle' },
    { at: 0.09, freq: A5 * 2, length: 0.2, gain: 0.02, wave: 'sine' },
  ],
  exact: [
    { at: 0, freq: C5, length: 0.5, gain: 0.1, wave: 'triangle' },
    { at: 0.075, freq: E5, length: 0.5, gain: 0.1, wave: 'triangle' },
    { at: 0.15, freq: G5, length: 0.55, gain: 0.1, wave: 'triangle' },
    { at: 0.225, freq: C6, length: 0.9, gain: 0.12, wave: 'triangle' },
    // A soft shimmer an octave and a fifth above, for sparkle.
    { at: 0.225, freq: C6 * 2, length: 0.7, gain: 0.025, wave: 'sine' },
    { at: 0.3, freq: G5 * 2, length: 0.6, gain: 0.02, wave: 'sine' },
  ],
};

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;
let output: AudioNode | null = null;

function audioContextClass(): AudioContextClass | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextClass;
    webkitAudioContext?: AudioContextClass;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Creates or resumes the audio context. Call it inside the user's gesture (the submit's key
 * press or click), because browsers only let a gesture start audio.
 */
function unlocked(): AudioContext | null {
  const Ctor = audioContextClass();
  if (!Ctor) return null;
  try {
    if (!context) {
      context = new Ctor();
      const master = context.createGain();
      master.gain.value = 0.9;
      const limiter = context.createDynamicsCompressor();
      master.connect(limiter);
      limiter.connect(context.destination);
      output = master;
    }
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function play(ctx: AudioContext, note: Note, start: number) {
  const t = start + note.at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = note.wave;
  osc.frequency.setValueAtTime(note.freq, t);
  if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, t + note.length * 0.8);
  // A quick, click-free attack and an exponential fade.
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(note.gain, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + note.length);
  osc.connect(env);
  env.connect(output ?? ctx.destination);
  osc.start(t);
  osc.stop(t + note.length + 0.05);
}

/** Plays the outcome's sound. A no-op where the browser has no Web Audio. */
export function playReveal(accuracy: Accuracy): void {
  const ctx = unlocked();
  if (!ctx) return;
  const start = ctx.currentTime + 0.01;
  for (const note of NOTES[accuracy]) play(ctx, note, start);
}

/** For the console and tests: whether audio is running. */
export function audioState(): AudioContextState | 'none' {
  return context?.state ?? 'none';
}

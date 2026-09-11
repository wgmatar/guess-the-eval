/**
 * Confetti for a good guess, on one canvas over the whole app: a small green burst for a
 * close guess, a bigger gold one for a spot-on guess. It never takes the pointer and nothing
 * waits for it; the next position can appear while the last pieces are still falling.
 */

export type Celebration = 'close' | 'exact';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rotation in the plane, and the phase of the tumble that flips the piece. */
  angle: number;
  spin: number;
  tumble: number;
  tumbleSpeed: number;
  readonly w: number;
  readonly h: number;
  readonly color: string;
  /** Seconds this piece lives. */
  readonly life: number;
  /** Round sparkles glow instead of tumbling. */
  readonly sparkle: boolean;
  readonly delay: number;
}

interface BurstSpec {
  readonly count: number;
  readonly sparkles: number;
  readonly speed: readonly [number, number];
  /** Launch angles in degrees; -90 is straight up. */
  readonly angle: readonly [number, number];
  readonly life: readonly [number, number];
  readonly colors: readonly string[];
}

export const BURSTS: Record<Celebration, BurstSpec> = {
  close: {
    count: 56,
    sparkles: 0,
    speed: [260, 620],
    angle: [-165, -25],
    life: [0.7, 1.05],
    colors: ['#217A47', '#2FA864', '#7DDC9F', '#F0EDE7'],
  },
  exact: {
    count: 150,
    sparkles: 36,
    speed: [320, 900],
    angle: [-180, 0],
    life: [1.1, 1.7],
    colors: ['#C8971A', '#E8B93A', '#F7D774', '#FFF4C2', '#B07F10', '#F0EDE7'],
  },
};

const GRAVITY = 1100;
const DRAG = 2.4;

type Random = () => number;

const between = (random: Random, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * random();

/** The pieces of one burst from (x, y), in page pixels. */
export function burst(kind: Celebration, x: number, y: number, random: Random): Particle[] {
  const spec = BURSTS[kind];
  const out: Particle[] = [];
  for (let i = 0; i < spec.count + spec.sparkles; i++) {
    const sparkle = i >= spec.count;
    const angle = (between(random, spec.angle) * Math.PI) / 180;
    const speed = between(random, spec.speed) * (sparkle ? 0.7 : 1);
    out.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle: random() * Math.PI * 2,
      spin: (random() - 0.5) * 12,
      tumble: random() * Math.PI * 2,
      tumbleSpeed: 6 + random() * 8,
      w: sparkle ? 2.5 + random() * 2 : 5 + random() * 4,
      h: sparkle ? 0 : 8 + random() * 6,
      color: spec.colors[Math.floor(random() * spec.colors.length)]!,
      life: between(random, spec.life),
      sparkle,
      // Gold's sparkles follow the confetti by a beat.
      delay: sparkle ? 0.12 + random() * 0.25 : 0,
    });
  }
  return out;
}

/** Advances a piece by dt seconds: gravity, air drag, spin. */
export function step(p: Particle, dt: number): void {
  const drag = Math.exp(-DRAG * dt);
  p.vx *= drag;
  p.vy = p.vy * drag + GRAVITY * (p.sparkle ? 0.35 : 1) * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.angle += p.spin * dt;
  p.tumble += p.tumbleSpeed * dt;
}

/** Opacity at age t: full, then fading over the last third of its life. */
export function alpha(p: Particle, t: number): number {
  const age = t - p.delay;
  if (age < 0 || age >= p.life) return 0;
  const fadeFrom = p.life * 0.66;
  return age < fadeFrom ? 1 : 1 - (age - fadeFrom) / (p.life - fadeFrom);
}

interface Live {
  readonly particles: Particle[];
  readonly born: number;
}

/** Draws bursts on a canvas until the last piece has faded, then stops its frame loop. */
export class Confetti {
  private bursts: Live[] = [];
  private frame = 0;
  private last = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly random: Random = Math.random,
  ) {}

  fire(kind: Celebration, x: number, y: number): void {
    const now = performance.now();
    this.bursts.push({ particles: burst(kind, x, y, this.random), born: now });
    if (!this.frame) {
      this.last = now;
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.bursts = [];
    this.context()?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private context(): CanvasRenderingContext2D | null {
    try {
      return this.canvas.getContext('2d');
    } catch {
      return null;
    }
  }

  private readonly tick = (now: number) => {
    const ctx = this.context();
    if (!ctx) return this.stop();
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    // A long frame (a background tab) must not fling pieces across the page.
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.bursts = this.bursts.filter((b) => {
      const t = (now - b.born) / 1000;
      let any = false;
      for (const p of b.particles) {
        if (t >= p.delay) step(p, dt);
        const a = alpha(p, t);
        if (a <= 0) {
          if (t < p.delay) any = true;
          continue;
        }
        any = true;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        if (p.sparkle) {
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.w * (0.75 + 0.25 * Math.sin(p.tumble)), 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.scale(1, Math.cos(p.tumble));
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      }
      return any;
    });
    ctx.globalAlpha = 1;

    if (this.bursts.length) this.frame = requestAnimationFrame(this.tick);
    else {
      this.frame = 0;
      ctx.clearRect(0, 0, w, h);
    }
  };
}

"use client";

// ════════════════════════════════════════════════════════════════════════════
// EnrollCelebration — the "Big party mode" moment fired when a BDE enrolls a
// candidate. Fully self-contained (no extra deps):
//   • full-screen canvas confetti (top burst + two side cannons)
//   • an animated trophy + "ENROLLED!" overlay that pops and lingers ~2.5s
//   • a synthesized applause + fanfare cheer via the Web Audio API
// Respects `prefers-reduced-motion` (calms the motion) and a persisted mute
// toggle (so a noisy office can silence the cheer once and for all).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MUTE_KEY = "crm-celebrate-muted";
const LIFETIME_MS = 2800; // overlay + confetti lifetime before auto-dismiss
const FADE_MS = 380; // closing fade at the tail end

const CONFETTI_COLORS = [
  "#F5C518", // brand gold
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#10b981", // emerald
  "#f97316", // orange
  "#06b6d4", // cyan
  "#ef4444", // red
];

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// ── Synthesized applause + fanfare ──────────────────────────────────────────
// A bright major-chord fanfare layered over ~70 filtered noise bursts (each a
// "clap"), scattered across ~2.2s so it reads as a small crowd applauding.
function playApplause(): void {
  type ACtor = typeof AudioContext;
  const Ctx: ACtor | undefined =
    typeof window !== "undefined"
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: ACtor }).webkitAudioContext
      : undefined;
  if (!Ctx) return;

  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return;
  }
  // The enroll click is a recent user gesture, so a resume() here is honoured.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  // 1) Triumphant fanfare — staggered C major chord (C5 · E5 · G5 · C6).
  const chord = [523.25, 659.25, 783.99, 1046.5];
  for (let i = 0; i < chord.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = chord[i];
    const start = now + i * 0.07;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.95);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + 1.05);
  }

  // 2) Applause — short bursts of band-passed white noise.
  const dur = 2.2;
  const sr = ctx.sampleRate;
  const noiseBuf = ctx.createBuffer(1, Math.floor(sr * 0.2), sr);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 1500;
  bandpass.Q.value = 0.7;
  const applauseGain = ctx.createGain();
  applauseGain.gain.value = 0.55;
  bandpass.connect(applauseGain).connect(master);

  const claps = 72;
  for (let i = 0; i < claps; i++) {
    // Bias bursts toward the first half so the applause "swells" then settles.
    const t = now + Math.min(dur, Math.pow(Math.random(), 0.7) * dur);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const g = ctx.createGain();
    const peak = 0.02 + Math.random() * 0.05;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04 + Math.random() * 0.05);
    src.connect(g).connect(bandpass);
    src.start(t);
    src.stop(t + 0.14);
  }

  // Release the context once everything has rung out.
  window.setTimeout(() => ctx.close().catch(() => {}), (dur + 1.2) * 1000);
}

// ── Confetti engine ─────────────────────────────────────────────────────────
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  shape: 0 | 1; // 0 = rectangle, 1 = circle
};

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Spawns confetti on the canvas and returns a stop() that cancels the loop.
function startConfetti(canvas: HTMLCanvasElement, reduced: boolean): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const W = () => window.innerWidth;
  const H = () => window.innerHeight;
  const particles: Particle[] = [];

  function spawn(p: Particle) {
    particles.push(p);
  }

  function topBurst(count: number) {
    for (let i = 0; i < count; i++) {
      spawn({
        x: rand(0, W()),
        y: rand(-40, -8),
        vx: rand(-1.6, 1.6),
        vy: rand(1.5, 4.5),
        rot: rand(0, Math.PI * 2),
        vr: rand(-0.25, 0.25),
        size: rand(6, 12),
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
        shape: Math.random() < 0.5 ? 0 : 1,
      });
    }
  }

  function cannon(side: "left" | "right", count: number) {
    const originX = side === "left" ? 0 : W();
    const dir = side === "left" ? 1 : -1;
    for (let i = 0; i < count; i++) {
      const speed = rand(9, 17);
      const angle = rand(-1.15, -0.35); // up-and-inward
      spawn({
        x: originX,
        y: H() * rand(0.55, 0.72),
        vx: Math.cos(angle) * speed * dir,
        vy: Math.sin(angle) * speed,
        rot: rand(0, Math.PI * 2),
        vr: rand(-0.4, 0.4),
        size: rand(7, 13),
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
        shape: Math.random() < 0.5 ? 0 : 1,
      });
    }
  }

  // Reduced motion: a single gentle sprinkle, no cannons, no top-ups.
  if (reduced) {
    topBurst(60);
  } else {
    topBurst(160);
    cannon("left", 60);
    cannon("right", 60);
  }

  const startTs = performance.now();
  let raf = 0;
  let lastTopUp = startTs;
  const gravity = 0.16;
  const drag = 0.992;

  function frame(now: number) {
    const elapsed = now - startTs;
    ctx!.clearRect(0, 0, W(), H());

    // Keep topping the sky up for the first stretch so it rains, not just bursts.
    if (!reduced && elapsed < 900 && now - lastTopUp > 90) {
      topBurst(26);
      lastTopUp = now;
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += gravity;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;

      if (p.y - p.size > H() || p.x < -40 || p.x > W() + 40) {
        particles.splice(i, 1);
        continue;
      }

      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rot);
      ctx!.fillStyle = p.color;
      if (p.shape === 0) {
        ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx!.beginPath();
        ctx!.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.restore();
    }

    if (particles.length > 0) {
      raf = requestAnimationFrame(frame);
    }
  }
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    ctx.clearRect(0, 0, W(), H());
  };
}

// ── Component ───────────────────────────────────────────────────────────────
export function EnrollCelebration({ name, onDone }: { name: string; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [muted, setMuted] = useState(false);
  const doneRef = useRef(false);

  // Hold the latest onDone in a ref so `finish`/`dismiss` stay stable — the
  // main effect must run exactly once (re-running would replay the confetti
  // and the applause).
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => setMounted(true), []);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  const dismiss = useCallback(() => {
    if (doneRef.current) return;
    setClosing(true);
    window.setTimeout(finish, FADE_MS);
  }, [finish]);

  useEffect(() => {
    if (!mounted) return;

    let isMuted = false;
    try {
      isMuted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      /* ignore */
    }
    setMuted(isMuted);

    const reduced = prefersReducedMotion();
    const stopConfetti = canvasRef.current ? startConfetti(canvasRef.current, reduced) : () => {};
    if (!isMuted) playApplause();

    const fadeTimer = window.setTimeout(() => setClosing(true), LIFETIME_MS - FADE_MS);
    const doneTimer = window.setTimeout(finish, LIFETIME_MS);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      stopConfetti();
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, finish, dismiss]);

  function toggleMute(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!next) playApplause(); // un-muting gives an instant preview cheer
  }

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-live="assertive"
      aria-label={`${name} enrolled`}
      onClick={dismiss}
      className="fixed inset-0 z-[2000] grid place-items-center p-md cursor-pointer"
      style={{
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.32), rgba(0,0,0,0.55))",
        opacity: closing ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {/* confetti sits above the dim layer but below the card */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-[1]"
        aria-hidden="true"
      />

      {/* the trophy card */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-[2] w-full max-w-sm rounded-2xl border border-white/15 px-lg py-xl text-center shadow-2xl cursor-default"
        style={{
          background: "linear-gradient(160deg, #2A2A2A 0%, #1F1F1F 100%)",
          animation: "crmOverlayIn 420ms cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        {/* mute toggle */}
        <button
          type="button"
          onClick={toggleMute}
          title={muted ? "Sound is off — tap for a cheer" : "Mute the cheer"}
          aria-label={muted ? "Unmute celebration sound" : "Mute celebration sound"}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-on-brand-variant hover:bg-white/10 transition cursor-pointer"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {muted ? "volume_off" : "volume_up"}
          </span>
        </button>

        {/* gold gradient ring + trophy */}
        <div
          className="mx-auto grid h-24 w-24 place-items-center rounded-full"
          style={{
            background: "radial-gradient(circle at 50% 35%, rgba(245,197,24,0.35), rgba(245,197,24,0) 70%)",
            animation: "crmFloat 2.4s ease-in-out 0.4s infinite",
          }}
        >
          <span
            className="select-none"
            style={{
              fontSize: 64,
              lineHeight: 1,
              display: "inline-block",
              filter: "drop-shadow(0 6px 14px rgba(245,197,24,0.45))",
              animation: "crmTrophyPop 700ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
            }}
          >
            🏆
          </span>
        </div>

        <div
          className="mt-md text-[11px] font-bold uppercase tracking-[0.25em]"
          style={{ color: "#F5C518" }}
        >
          Deal Won
        </div>

        <h2 className="mt-xs text-h2 font-bold text-on-brand">Enrolled! 🎉</h2>

        <p className="mt-xs text-body-lg text-on-brand">
          <span className="font-semibold" style={{ color: "#FFE082" }}>
            {name}
          </span>{" "}
          is officially in! 🎓
        </p>

        <div className="mt-md text-2xl tracking-widest select-none" aria-hidden="true">
          👏👏👏
        </div>

        <p className="mt-md text-label-sm text-on-brand-variant">Tap anywhere to continue</p>
      </div>
    </div>,
    document.body,
  );
}

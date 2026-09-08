"use client";

// ════════════════════════════════════════════════════════════════════════════
// CelebrationGreeting — the moment the celebrant sees on their first page load
// of their birthday or work anniversary: canvas confetti behind a card with
// their name on it.
//
// Deliberately silent, unlike EnrollCelebration's fanfare. An enrolment cheer is
// something the BDE triggered and is expecting; a birthday greeting arrives
// unannounced, possibly in a meeting, on a machine whose volume nobody checked.
//
// Firing once is a server fact, not a client one: mounting POSTs to
// /api/me/celebration, which writes the HrCelebration row. A second device, a
// re-login or a hard refresh finds the row and never mounts this at all.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const CONFETTI_COLORS = [
  "#F5C518", // brand gold
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#10b981", // emerald
  "#f97316", // orange
  "#06b6d4", // cyan
];

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export type GreetingPayload = {
  kind: "birthday" | "anniversary";
  firstName: string;
  fullName: string;
  /** Already rendered from the HR template server-side. */
  message: string;
  years: number | null;
};

export function CelebrationGreeting({ greeting }: { greeting: GreetingPayload }) {
  const [open, setOpen] = useState(true);
  const [mounted, setMounted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setMounted(true), []);

  // Record the greeting as shown the moment it appears, not when it is
  // dismissed: someone who closes the tab mid-confetti has still been greeted,
  // and re-greeting them on the next page load would be worse than not.
  useEffect(() => {
    fetch("/api/me/celebration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: greeting.kind, years: greeting.years }),
    }).catch(() => {
      // The greeting is already on screen. A failed ack means it may show once
      // more later, which is a far smaller problem than an error toast on
      // somebody's birthday.
    });
  }, [greeting.kind, greeting.years]);

  const close = useCallback(() => setOpen(false), []);

  // Escape closes, and focus lands on the dismiss button so a keyboard user is
  // not trapped behind an overlay they cannot see a way out of.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Auto-dismiss. Long enough to read, short enough not to block the work the
  // person actually opened DesGro to do.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(close, 7000);
    return () => clearTimeout(t);
  }, [open, close]);

  useEffect(() => {
    if (!open || !mounted) return;
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion()) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    type Bit = {
      x: number; y: number; vx: number; vy: number;
      w: number; h: number; rot: number; vr: number;
      color: string; life: number;
    };
    const bits: Bit[] = [];
    const burst = (ox: number, oy: number, n: number, from: number, to: number, power: number) => {
      for (let i = 0; i < n; i++) {
        const angle = from + Math.random() * (to - from);
        const v = power * (0.55 + Math.random() * 0.7);
        bits.push({
          x: ox, y: oy,
          vx: Math.cos(angle) * v, vy: Math.sin(angle) * v,
          w: 6 + Math.random() * 6, h: 9 + Math.random() * 7,
          rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.32,
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
          life: 1,
        });
      }
    };
    // A burst over the card, then two low cannons from the bottom corners.
    burst(w / 2, h * 0.3, 110, -Math.PI * 0.95, -Math.PI * 0.05, 11);
    burst(0, h, 40, -Math.PI * 0.62, -Math.PI * 0.28, 16);
    burst(w, h, 40, -Math.PI * 0.72, -Math.PI * 0.38, 16);
    for (const b of bits) if (b.x >= w) b.vx = -Math.abs(b.vx);

    const step = () => {
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const b of bits) {
        if (b.life <= 0) continue;
        b.vy += 0.26; // gravity
        b.vx *= 0.992;
        b.vy *= 0.992;
        b.x += b.vx;
        b.y += b.vy;
        b.rot += b.vr;
        if (b.y > h + 40) {
          b.life = 0;
          continue;
        }
        b.life -= 0.0035;
        alive++;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.globalAlpha = Math.max(0, Math.min(1, b.life * 1.6));
        ctx.fillStyle = b.color;
        // Scaling the height by the rotation fakes a strip of paper turning
        // edge-on, which reads as depth without any 3D work.
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * (0.55 + 0.45 * Math.abs(Math.cos(b.rot))));
        ctx.restore();
      }
      if (alive > 0) rafRef.current = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, w, h);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => cancelAnimationFrame(rafRef.current);
  }, [open, mounted]);

  if (!mounted || !open) return null;

  const initials = greeting.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  const heading =
    greeting.kind === "birthday"
      ? `Happy birthday, ${greeting.firstName}!`
      : greeting.years === 1
        ? `One year at DESMA`
        : `${greeting.years} years at DESMA`;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dg-greeting-title"
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={close}
        className="absolute inset-0 bg-black/50 cursor-default"
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 w-full h-full"
      />
      <div className="dg-greeting relative w-full max-w-sm rounded-xl border border-outline-variant bg-surface-container-lowest p-lg text-center shadow-2xl">
        <div className="mx-auto mb-base grid h-16 w-16 place-items-center rounded-full bg-primary text-on-primary text-h3 font-extrabold">
          {initials}
        </div>
        <h2 id="dg-greeting-title" className="text-h2 font-extrabold">
          {heading}
        </h2>
        <p className="mt-sm text-on-surface-variant">{greeting.message}</p>
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          className="mt-lg w-full rounded-lg bg-primary px-md py-sm font-semibold text-on-primary"
        >
          Thank you
        </button>
      </div>
    </div>,
    document.body,
  );
}

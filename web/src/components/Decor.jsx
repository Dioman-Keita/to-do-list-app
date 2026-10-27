import { useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { seeded } from '../lib/random.js';

const WATERCOLORS = ['#ef6fa6', '#f7a8c9', '#5fbfe6', '#9fd8f0', '#f6df4f', '#f4a35a', '#c79be6'];

// Filtres SVG partagés : bords irréguliers des taches d'aquarelle et trait "fait main".
export function SvgFilters() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <filter id="watercolor" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="4" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="70" xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="2" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.5" />
        </filter>
      </defs>
    </svg>
  );
}

// Une page du carnet : papier, aquarelles et éclaboussures propres à `seed`.
export function Page({ side, seed = 'page', className = '', children }) {
  const decor = useMemo(() => {
    const rnd = seeded(`${seed}-${side}`);
    const blobs = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({
      x: rnd() * 90 - 10,
      y: rnd() * 90 - 10,
      size: 180 + rnd() * 260,
      ratio: 0.6 + rnd() * 0.8,
      angle: rnd() * 180,
      color: WATERCOLORS[Math.floor(rnd() * WATERCOLORS.length)],
    }));
    const dots = Array.from({ length: 10 + Math.floor(rnd() * 14) }, () => ({
      x: rnd() * 100,
      y: rnd() * 100,
      size: 3 + rnd() * 12,
      color: WATERCOLORS[Math.floor(rnd() * 3)],
    }));
    return { blobs, dots };
  }, [seed, side]);

  return (
    <section className={`page page-${side} ${className}`}>
      <div className="page-decor" aria-hidden="true">
        {decor.blobs.map((b, i) => (
          <span
            key={i}
            className="blob"
            style={{
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: b.size,
              height: b.size * b.ratio,
              transform: `rotate(${b.angle}deg)`,
              background: `radial-gradient(closest-side, ${b.color} 0%, ${b.color}cc 45%, transparent 100%)`,
            }}
          />
        ))}
        {decor.dots.map((d, i) => (
          <span
            key={`d${i}`}
            className="dot"
            style={{ left: `${d.x}%`, top: `${d.y}%`, width: d.size, height: d.size, background: d.color }}
          />
        ))}
      </div>
      <div className="page-content">{children}</div>
    </section>
  );
}

export function Star({ className = '', delay = 0, size = 34 }) {
  return (
    <motion.svg
      className={`star ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      initial={{ scale: 0, rotate: -40 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 14, delay }}
      aria-hidden="true"
    >
      <path
        d="M32 5l8 16.4 18 2.6-13 12.7 3 17.9L32 46.1 16 54.6l3-17.9L6 24l18-2.6z"
        fill="#f6df4f"
        stroke="#3a3328"
        strokeWidth="3"
        strokeLinejoin="round"
        filter="url(#rough)"
      />
    </motion.svg>
  );
}

// Papillon bleu qui traverse l'écran de temps en temps.
export function Butterfly() {
  const reduce = useReducedMotion();
  const [flight, setFlight] = useState(0);

  useEffect(() => {
    if (reduce) return undefined;
    let timer;
    const schedule = (delay) => {
      timer = setTimeout(() => {
        setFlight((f) => f + 1);
        schedule(35000 + Math.random() * 45000);
      }, delay);
    };
    schedule(3500);
    return () => clearTimeout(timer);
  }, [reduce]);

  const path = useMemo(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ltr = flight % 2 === 1;
    const xs = [-80, w * 0.25, w * 0.5, w * 0.75, w + 80];
    const ys = xs.map(() => h * (0.1 + Math.random() * 0.75));
    return { x: ltr ? xs : [...xs].reverse(), y: ys, flip: ltr ? 1 : -1 };
  }, [flight]);

  if (reduce || !flight) return null;

  return (
    <motion.div
      key={flight}
      className="butterfly"
      initial={{ x: path.x[0], y: path.y[0], opacity: 0 }}
      animate={{ x: path.x, y: path.y, opacity: [0, 1, 1, 1, 0], rotate: [10, -15, 12, -10, 5] }}
      transition={{ duration: 16, ease: 'easeInOut' }}
      style={{ scaleX: path.flip }}
      aria-hidden="true"
    >
      <svg width="46" height="46" viewBox="-30 -30 60 60">
        <defs>
          <linearGradient id="wing" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#bfe9ff" />
            <stop offset="0.55" stopColor="#3d9be0" />
            <stop offset="1" stopColor="#1b4f9c" />
          </linearGradient>
        </defs>
        <g transform="rotate(90)">
          <motion.g
            animate={{ scaleX: [1, 0.25, 1] }}
            transition={{ duration: 0.32, repeat: Infinity, ease: 'easeInOut' }}
          >
            <path d="M0 -2 C -18 -26, -30 -6, -16 2 C -26 10, -16 24, 0 6 Z" fill="url(#wing)" stroke="#11233d" strokeWidth="1.6" />
            <path d="M0 -2 C 18 -26, 30 -6, 16 2 C 26 10, 16 24, 0 6 Z" fill="url(#wing)" stroke="#11233d" strokeWidth="1.6" />
          </motion.g>
          <ellipse cx="0" cy="2" rx="1.8" ry="11" fill="#11233d" />
          <path d="M0 -8 q -4 -8 -7 -10 M0 -8 q 4 -8 7 -10" stroke="#11233d" strokeWidth="1.2" fill="none" />
        </g>
      </svg>
    </motion.div>
  );
}

// Étiquette de papier déchiré (titres, dates…).
export function TornLabel({ children, className = '', tilt = -1.5 }) {
  return (
    <motion.div
      className={`torn-wrap ${className}`}
      initial={{ opacity: 0, x: -20, rotate: tilt - 3 }}
      animate={{ opacity: 1, x: 0, rotate: tilt }}
      transition={{ type: 'spring', stiffness: 200, damping: 18 }}
    >
      <div className="torn">{children}</div>
    </motion.div>
  );
}

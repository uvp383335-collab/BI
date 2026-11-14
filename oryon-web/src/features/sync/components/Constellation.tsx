import React from 'react'

/**
 * Orion, drawn as the sync's progress. Oryon's mark is Orion's belt (three stars, gold centre),
 * so the belt is always lit; the shoulders and feet light up, and the figure's lines draw in,
 * as the data arrives. The gold centre star breathes while work is in progress.
 */

type Star = { x: number; y: number; r: number; at: number }

const STARS: Record<string, Star> = {
  betelgeuse: { x: 62, y: 52, r: 4.2, at: 0.18 },
  bellatrix: { x: 178, y: 72, r: 3.2, at: 0.34 },
  alnitak: { x: 98, y: 160, r: 2.6, at: 0 },
  alnilam: { x: 122, y: 149, r: 3.4, at: 0 },
  mintaka: { x: 146, y: 138, r: 2.6, at: 0 },
  saiph: { x: 82, y: 254, r: 3, at: 0.62 },
  rigel: { x: 188, y: 238, r: 4, at: 0.8 }
}

/** Figure lines in drawing order; each draws over its own slice of the progress. */
const LINES: Array<[from: string, to: string, start: number, end: number]> = [
  ['betelgeuse', 'alnitak', 0.04, 0.2],
  ['bellatrix', 'mintaka', 0.2, 0.36],
  ['betelgeuse', 'bellatrix', 0.36, 0.5],
  ['alnitak', 'saiph', 0.5, 0.66],
  ['mintaka', 'rigel', 0.66, 0.84]
]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export const Constellation: React.FC<{ progress: number; working: boolean; failed?: boolean }> = ({ progress, working, failed = false }) => {
  const p = clamp01(progress / 100)
  return (
    <svg viewBox="0 0 240 300" className="syncl-sky h-auto w-full" role="img" aria-label={`Sync ${Math.round(progress)}% complete`}>
      {/* belt: always there, it is the brand mark */}
      <line x1={STARS.alnitak.x} y1={STARS.alnitak.y} x2={STARS.mintaka.x} y2={STARS.mintaka.y} className="syncl-line is-on" />
      {LINES.map(([a, b, start, end]) => {
        const seg = clamp01((p - start) / (end - start))
        return (
          <line
            key={`${a}-${b}`}
            x1={STARS[a].x}
            y1={STARS[a].y}
            x2={STARS[b].x}
            y2={STARS[b].y}
            pathLength={1}
            className="syncl-line"
            style={{ strokeDasharray: 1, strokeDashoffset: 1 - seg }}
          />
        )
      })}
      {Object.entries(STARS).map(([name, s]) => {
        const lit = p >= s.at
        const centre = name === 'alnilam'
        return (
          <g key={name} className={`syncl-star${lit ? ' is-lit' : ''}${centre ? ' is-centre' : ''}${centre && working ? ' is-working' : ''}${centre && failed ? ' is-failed' : ''}`}>
            {centre && <circle cx={s.x} cy={s.y} r={s.r * 4} className="syncl-halo" />}
            <circle cx={s.x} cy={s.y} r={s.r} className="syncl-dot" />
          </g>
        )
      })}
    </svg>
  )
}

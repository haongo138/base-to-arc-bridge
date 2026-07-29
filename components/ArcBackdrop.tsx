/**
 * Arc's "dawn horizon" backdrop, adapted from arc.io.
 *
 * Their hero runs navy -> steel -> teal -> warm sand -> white. We take the dark
 * two-thirds and stop at a faint warm glow instead of continuing to white: this app
 * is a dark card UI, and a light lower half would wreck the panel's text contrast.
 *
 * Fixed to the viewport rather than painted on <body> so the horizon stays at the
 * bottom edge of the screen even when the card is taller than the viewport.
 */
export function ArcBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Vertical dawn ramp — stops lifted from arc.io, truncated before it goes light. */}
      {/* Held darker at the bottom than arc.io's ramp: text lives down there, and a
          #1f5f63 floor pushed small muted copy under 3:1. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, #000b24 0%, #081d36 28%, #102c47 52%, #143a4c 72%, #16454e 88%, #17494f 100%)',
        }}
      />

      {/* The warm sand band. arc.io places it at ~92% of the hero as a distinct band, so
          this is two layers: a horizontal band for the horizon line, plus a centre-weighted
          radial glow. Safe to run this warm now that every text run sits on a panel or
          scrim rather than straight on the gradient. */}
      <div
        className="absolute inset-x-0 bottom-0 h-3/5"
        style={{
          background:
            'linear-gradient(180deg, rgba(226,208,170,0) 46%, rgba(226,208,170,0.08) 72%, rgba(226,208,170,0.26) 90%, rgba(232,214,176,0.40) 100%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            'radial-gradient(105% 72% at 50% 104%, rgba(238,216,168,0.42) 0%, rgba(226,208,170,0.16) 36%, rgba(226,208,170,0) 68%)',
        }}
      />

      {/* Teal lift where the horizon meets the sky, matching their #4197A1 band. */}
      <div
        className="absolute inset-x-0 bottom-0 h-3/5"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 132%, rgba(65,151,161,0.20) 0%, rgba(65,151,161,0.06) 45%, transparent 72%)',
        }}
      />

      {/* Arc's signature curve: a huge thin circle whose lower-left edge sweeps the frame. */}
      <svg
        className="absolute -top-[45%] -right-[18%] h-[190%] w-auto"
        viewBox="0 0 1000 1000"
        fill="none"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="arcStroke" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#e2d0aa" stopOpacity="0.30" />
            <stop offset="45%" stopColor="#7fb6bd" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#4197a1" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="arcStroke2" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#e2d0aa" stopOpacity="0.14" />
            <stop offset="60%" stopColor="#4197a1" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#4197a1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="500" cy="500" r="498" stroke="url(#arcStroke)" strokeWidth="1.5" />
        <circle cx="500" cy="500" r="430" stroke="url(#arcStroke2)" strokeWidth="1" />
      </svg>

      {/* Keeps the very top black enough that the card's border still reads. */}
      <div
        className="absolute inset-x-0 top-0 h-1/3"
        style={{ background: 'linear-gradient(180deg, rgba(0,4,16,0.55), transparent)' }}
      />
    </div>
  )
}

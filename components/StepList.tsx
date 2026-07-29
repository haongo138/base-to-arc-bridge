'use client'

import { STEPS, type StepId, type StepState } from '@/hooks/useBridge'
import { useEffect, useState } from 'react'

const dot: Record<StepState, string> = {
  idle: 'border-edge text-muted',
  active: 'border-accent/40 text-accent',
  done: 'border-arc bg-arc/15 text-arc',
  error: 'border-red-500 bg-red-500/15 text-red-400',
}

const label: Record<StepState, string> = {
  idle: 'text-muted',
  active: 'text-white',
  done: 'text-white',
  error: 'text-red-300',
}

/**
 * Seconds since `since`, ticking once a second. Starts at 0 rather than Date.now()
 * so the server and first client render agree.
 */
function useElapsed(since?: number) {
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (!since) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [since])

  if (!since || !now) return 0
  return Math.max(0, Math.floor((now - since) / 1000))
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function StepList({
  states,
  activeSince,
}: {
  states: Record<StepId, StepState>
  activeSince?: number
}) {
  const elapsed = useElapsed(activeSince)
  const doneCount = STEPS.filter((s) => states[s.id] === 'done').length
  const activeIndex = STEPS.findIndex((s) => states[s.id] === 'active')
  const errorIndex = STEPS.findIndex((s) => states[s.id] === 'error')
  const errored = errorIndex >= 0
  // A failed step is still where the user is standing — falling back to doneCount here
  // would label a failure on step 3 as "Step 2 of 6", contradicting the red marker.
  const current =
    activeIndex >= 0 ? activeIndex + 1 : errored ? errorIndex + 1 : doneCount

  return (
    <div className="space-y-3">
      {/* Overall position — the fastest way to answer "where am I?" */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted">
            {doneCount === STEPS.length ? 'Complete' : `Step ${Math.max(current, 1)} of ${STEPS.length}`}
          </span>
          <span className="tnum text-muted">{doneCount}/{STEPS.length}</span>
        </div>
        <div
          className="h-1 overflow-hidden rounded-full bg-edge"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={STEPS.length}
          aria-valuenow={doneCount}
          aria-label="Bridge progress"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${errored ? 'bg-red-500' : 'bg-arc'}`}
            style={{ width: `${(doneCount / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      <ol className="relative">
        {STEPS.map((step, i) => {
          const state = states[step.id]
          const isLast = i === STEPS.length - 1
          // The rail segment below a step is "travelled" once that step is done.
          const railDone = state === 'done'
          return (
            <li
              key={step.id}
              className="relative flex gap-3 pb-3 last:pb-0"
              aria-current={state === 'active' ? 'step' : undefined}
            >
              {!isLast && (
                <span
                  aria-hidden
                  className={`absolute left-3 top-6 -translate-x-1/2 w-px ${railDone ? 'bg-arc/50' : 'bg-edge'}`}
                  style={{ height: 'calc(100% - 1.5rem)' }}
                />
              )}

              <span
                className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-full border bg-panel text-xs font-semibold tnum ${dot[state]}`}
              >
                {/* Spinning arc on the active step: motion is what says "still working". */}
                {state === 'active' && (
                  <span
                    aria-hidden
                    className="absolute -inset-px animate-spin rounded-full border-2 border-transparent border-t-accent"
                  />
                )}
                {state === 'done' ? '✓' : state === 'error' ? '!' : i + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`text-sm ${label[state]}`}>{step.label}</span>
                  {state === 'active' && elapsed > 0 && (
                    <span className="tnum shrink-0 text-xs text-accent" aria-live="off">
                      {mmss(elapsed)}
                    </span>
                  )}
                </span>
                <span className="block text-xs leading-snug text-muted">{step.detail}</span>
              </span>
            </li>
          )
        })}
      </ol>

      {/* One polite announcement per step change, for screen readers. */}
      <p className="sr-only" aria-live="polite">
        {errored
          ? `Step ${errorIndex + 1} of ${STEPS.length} failed: ${STEPS[errorIndex].label}`
          : activeIndex >= 0
            ? `Step ${activeIndex + 1} of ${STEPS.length}: ${STEPS[activeIndex].label}`
            : doneCount === STEPS.length
              ? 'Bridge complete'
              : ''}
      </p>
    </div>
  )
}

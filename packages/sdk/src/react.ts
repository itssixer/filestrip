import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Strip } from './index.js'
import type { InspectOutcome, PurgeOutcome, StripConfig } from './types.js'

export interface UseFilestrip {
  sanitize(file: Blob): Promise<PurgeOutcome>
  inspect(file: Blob): Promise<InspectOutcome>
  /** Triggers a browser download of the purged file. */
  download(result: PurgeOutcome): void
  busy: boolean
  error: Error | null
  lastPurge: PurgeOutcome | null
  lastReport: InspectOutcome | null
  reset(): void
}

/**
 * React binding for Cloudflare Pages and any other React host. The Strip
 * instance is memoised so the vision Worker is created once per component.
 */
export function useFilestrip(config: StripConfig = {}): UseFilestrip {
  const strip = useMemo(() => new Strip(config), [
    config.visionWorkerUrl,
    config.modelUrl,
    config.blurThreshold,
    config.ocr,
    config.faces,
    config.skipVision,
    config.skipSentinel
  ])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastPurge, setLastPurge] = useState<PurgeOutcome | null>(null)
  const [lastReport, setLastReport] = useState<InspectOutcome | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      strip.dispose()
    }
  }, [strip])

  const run = useCallback(async <T,>(task: () => Promise<T>, store: (value: T) => void): Promise<T> => {
    setBusy(true)
    setError(null)
    try {
      const value = await task()
      // Guard against setting state after the component unmounted.
      if (alive.current) store(value)
      return value
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error('filestrip failed')
      if (alive.current) setError(wrapped)
      throw wrapped
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  const sanitize = useCallback(
    (file: Blob) => run(() => strip.sanitize(file), setLastPurge),
    [run, strip]
  )

  const inspect = useCallback(
    (file: Blob) => run(() => strip.inspect(file), setLastReport),
    [run, strip]
  )

  const download = useCallback((result: PurgeOutcome) => {
    const url = URL.createObjectURL(result.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }, [])

  const reset = useCallback(() => {
    setLastPurge(null)
    setLastReport(null)
    setError(null)
  }, [])

  return { sanitize, inspect, download, busy, error, lastPurge, lastReport, reset }
}

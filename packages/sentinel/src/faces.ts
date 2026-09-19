import type { FaceAdapter, FaceBox } from './types.js'

interface DetectedFaceLike {
  boundingBox: { x: number; y: number; width: number; height: number }
}

interface FaceDetectorLike {
  detect(source: unknown): Promise<DetectedFaceLike[]>
}

/**
 * Uses the browser's Shape Detection API when present. It is gated behind a
 * flag in some Chromium builds, so callers must handle `null`.
 */
export function nativeFaceAdapter(): FaceAdapter | null {
  const ctor = (globalThis as { FaceDetector?: new (options?: unknown) => FaceDetectorLike }).FaceDetector
  if (!ctor) return null

  const detector = new ctor({ fastMode: true, maxDetectedFaces: 12 })

  return {
    async detect(source) {
      try {
        const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source)
        const faces = await detector.detect(bitmap)
        if (!(source instanceof ImageBitmap)) bitmap.close?.()
        return faces.map((f): FaceBox => ({
          x: Math.round(f.boundingBox.x),
          y: Math.round(f.boundingBox.y),
          width: Math.round(f.boundingBox.width),
          height: Math.round(f.boundingBox.height)
        }))
      } catch {
        return []
      }
    }
  }
}

/**
 * Wraps any custom detector, e.g. a MediaPipe or ONNX model loaded by the host
 * application, so `scan()` can consume it without knowing the backend.
 */
export function customFaceAdapter(detect: (source: Blob | ImageBitmap) => Promise<FaceBox[]>): FaceAdapter {
  return { detect }
}

/** Expands boxes outward so a blur fully covers hairline and chin. */
export function padBoxes(faces: FaceBox[], factor = 0.18): FaceBox[] {
  return faces.map((f) => {
    const dx = f.width * factor
    const dy = f.height * factor
    return {
      x: Math.max(0, Math.round(f.x - dx)),
      y: Math.max(0, Math.round(f.y - dy)),
      width: Math.round(f.width + dx * 2),
      height: Math.round(f.height + dy * 2)
    }
  })
}

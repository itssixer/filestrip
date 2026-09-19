import type { OcrAdapter } from './types.js'

/**
 * WASM OCR via tesseract.js, an optional peer dependency. Recognition runs
 * entirely in the browser; no image bytes leave the device.
 *
 * Language traineddata is fetched from whatever `workerPath`/`langPath` the host
 * configures, so self-host those files to keep the pipeline fully offline.
 */
export async function tesseractAdapter(options: {
  lang?: string
  workerPath?: string
  langPath?: string
  corePath?: string
} = {}): Promise<OcrAdapter> {
  const specifier = 'tesseract.js'
  const tesseract = (await import(specifier)) as unknown as {
    createWorker(lang?: string, oem?: number, config?: unknown): Promise<{
      recognize(image: unknown): Promise<{ data: { text: string } }>
      terminate(): Promise<void>
    }>
  }

  const worker = await tesseract.createWorker(options.lang ?? 'eng', 1, {
    workerPath: options.workerPath,
    langPath: options.langPath,
    corePath: options.corePath
  })

  return {
    async recognize(source) {
      const input = source instanceof ImageBitmap ? await bitmapToBlob(source) : source
      const result = await worker.recognize(input)
      return result.data.text ?? ''
    }
  }
}

/** Lets a host plug in any OCR backend, including a server-free custom WASM build. */
export function customOcrAdapter(recognize: (source: Blob | ImageBitmap) => Promise<string>): OcrAdapter {
  return { recognize }
}

async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob> {
  if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas unavailable')
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

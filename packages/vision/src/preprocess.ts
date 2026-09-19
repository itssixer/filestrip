import { toGrayscale } from './hash.js'

export interface DecodedImage {
  rgba: Uint8ClampedArray<ArrayBuffer>
  gray: Float32Array
  width: number
  height: number
  naturalWidth: number
  naturalHeight: number
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }
  throw new Error('no canvas implementation available')
}

/**
 * Decodes to a bounded working size. Analysis never needs full resolution, and
 * capping the long edge keeps a 50 MP phone photo from stalling the Worker.
 */
export async function decode(source: Blob | ImageBitmap, maxEdge = 512): Promise<DecodedImage> {
  const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source)
  const naturalWidth = bitmap.width
  const naturalHeight = bitmap.height

  const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight))
  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(naturalHeight * scale))

  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null
  if (!ctx) {
    bitmap.close?.()
    throw new Error('2d context unavailable')
  }

  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height)
  bitmap.close?.()

  const { data } = ctx.getImageData(0, 0, width, height)
  const rgba = data as Uint8ClampedArray<ArrayBuffer>
  return {
    rgba,
    gray: toGrayscale(rgba, width, height),
    width,
    height,
    naturalWidth,
    naturalHeight
  }
}

/**
 * Builds an NHWC float tensor normalised to 0..1, the layout NSFWJS-style
 * MobileNet exports expect.
 */
export function toTensor(image: DecodedImage, size: number): Float32Array {
  const canvas = makeCanvas(size, size)
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null
  if (!ctx) throw new Error('2d context unavailable')

  const temp = makeCanvas(image.width, image.height)
  const tempCtx = temp.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null
  if (!tempCtx) throw new Error('2d context unavailable')

  tempCtx.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0)
  ctx.drawImage(temp as unknown as CanvasImageSource, 0, 0, size, size)

  const { data } = ctx.getImageData(0, 0, size, size)
  const tensor = new Float32Array(size * size * 3)
  for (let i = 0, p = 0, t = 0; i < size * size; i++, p += 4, t += 3) {
    tensor[t] = data[p]! / 255
    tensor[t + 1] = data[p + 1]! / 255
    tensor[t + 2] = data[p + 2]! / 255
  }
  return tensor
}

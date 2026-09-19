import { createStrip, STRIP_ENGINE_VERSION } from '@filestrip/sdk'
import type { InspectOutcome, PurgeOutcome } from '@filestrip/sdk'
import { el, node, clear, stat, formatBytes, download } from './dom.js'

type Mode = 'sanitize' | 'inspect'

// Worker URL is resolved against the page so it survives sub-path deploys.
const strip = createStrip({
  visionWorkerUrl: new URL('vision.worker.js', location.href),
  blurThreshold: 0.6
})

const view = {
  sanitize: el('view-sanitize'),
  inspect: el('view-inspect')
}
const tabs = {
  sanitize: el<HTMLButtonElement>('tab-sanitize'),
  inspect: el<HTMLButtonElement>('tab-inspect')
}

const zone = el('zone')
const fileInput = el<HTMLInputElement>('file')
const zoneTitle = el('zone-title')
const zoneSub = el('zone-sub')
const pick = el<HTMLButtonElement>('pick')
const log = el<HTMLUListElement>('log')

const sanitizeIdle = el('sanitize-idle')
const sanitizeResult = el('sanitize-result')
const resultImg = el<HTMLImageElement>('result-img')
const resultStats = el('result-stats')
const scrubHeadline = el('scrub-headline')
const scrubList = el<HTMLUListElement>('scrub-list')
const downloadClean = el<HTMLButtonElement>('download-clean')
const sanitizeAgain = el<HTMLButtonElement>('sanitize-again')

const izone = el('izone')
const ifileInput = el<HTMLInputElement>('ifile')
const ipick = el<HTMLButtonElement>('ipick')
const inspectIdle = el('inspect-idle')
const inspectResult = el('inspect-result')
const inspectImg = el<HTMLImageElement>('inspect-img')
const preview = el('preview')
const unblur = el<HTMLButtonElement>('unblur')
const safety = el('safety')
const inspectMap = el('inspect-map')
const inspectMapFrame = el<HTMLIFrameElement>('inspect-map-frame')
const inspectStats = el('inspect-stats')
const inspectScore = el('inspect-score')
const inspectSections = el('inspect-sections')
const purgeAll = el<HTMLButtonElement>('purge-all')
const inspectAgain = el<HTMLButtonElement>('inspect-again')

el('engine-version').textContent = `v${STRIP_ENGINE_VERSION.split('.').slice(0, 2).join('.')}`

let mode: Mode = 'sanitize'
let busy = false
let lastPurge: PurgeOutcome | null = null
let inspectedFile: File | Blob | null = null
const urls = new Set<string>()

function trackUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  urls.add(url)
  return url
}

function releaseUrls(): void {
  for (const url of urls) URL.revokeObjectURL(url)
  urls.clear()
}

/* ── Mode switching ─────────────────────────────────────── */

function setMode(next: Mode): void {
  mode = next
  document.body.dataset['mode'] = next

  for (const key of ['sanitize', 'inspect'] as Mode[]) {
    const active = key === next
    tabs[key].classList.toggle('on', active)
    tabs[key].setAttribute('aria-selected', String(active))
    view[key].hidden = !active
  }

  const hash = next === 'inspect' ? '#inspect' : ''
  if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname)
}

tabs.sanitize.onclick = () => setMode('sanitize')
tabs.inspect.onclick = () => setMode('inspect')
if (location.hash === '#inspect') setMode('inspect')

/* ── Shared helpers ─────────────────────────────────────── */

function note(message: string, detail: string, isError = false): void {
  const li = node('li')
  const left = node('span', isError ? 'err' : undefined, message)
  const right = node('span', isError ? 'meta err' : 'meta', detail)
  li.append(left, right)
  log.prepend(li)
  while (log.children.length > 4) log.lastElementChild?.remove()
}

function setWorking(on: boolean, label = 'Working…'): void {
  busy = on
  pick.disabled = on
  zoneTitle.textContent = on ? label : 'Drag and drop files'
  zoneSub.textContent = on ? 'Everything stays on this device' : 'or paste with Ctrl+V'
}

function imagesFrom(list: ArrayLike<File>): File[] {
  return Array.from(list).filter((f) => f.type.startsWith('image/'))
}

/* ── Sanitize ───────────────────────────────────────────── */

function renderSanitize(result: PurgeOutcome, original: File): void {
  lastPurge = result
  sanitizeIdle.hidden = true
  sanitizeResult.hidden = false

  resultImg.src = trackUrl(result.blob)
  resultImg.alt = `Sanitized copy of ${original.name}`

  clear(resultStats)
  const shrank = result.bytes.byteLength <= result.originalBytes
  resultStats.append(
    stat('Clean file', result.name),
    stat('Format', result.format.toUpperCase()),
    stat('Size', `${formatBytes(result.originalBytes)} → ${formatBytes(result.bytes.byteLength)}`, shrank ? 'good' : undefined),
    stat('EXIF tags', result.exifTags ? `${result.exifTags} removed` : 'none found', result.exifTags ? 'good' : undefined)
  )

  scrubHeadline.textContent = result.headline

  clear(scrubList)
  for (const item of result.summary) {
    scrubList.append(node('li', undefined, item[0]!.toUpperCase() + item.slice(1)))
  }
}

async function runSanitize(files: File[]): Promise<void> {
  if (!files.length) {
    note('No images found', 'drop a JPEG, PNG, or WebP', true)
    return
  }

  setWorking(true, 'Purging metadata…')
  let first: PurgeOutcome | null = null
  let firstFile: File | null = null

  for (const file of files) {
    try {
      const result = await strip.sanitize(file)
      if (result.format === 'unknown') {
        note(file.name, 'unsupported format', true)
        continue
      }
      // Batches download immediately; the panel showcases the first result.
      if (!first) {
        first = result
        firstFile = file
      } else {
        download(result.blob, result.name)
        note(result.name, `${formatBytes(file.size)} → ${formatBytes(result.bytes.byteLength)}`)
      }
    } catch (err) {
      note(file.name, err instanceof Error ? err.message : 'purge failed', true)
    }
  }

  setWorking(false)
  if (first && firstFile) renderSanitize(first, firstFile)
}

downloadClean.onclick = () => {
  if (lastPurge) download(lastPurge.blob, lastPurge.name)
}

sanitizeAgain.onclick = () => {
  lastPurge = null
  sanitizeResult.hidden = true
  sanitizeIdle.hidden = false
  fileInput.click()
}

/* ── Inspect ────────────────────────────────────────────── */

function section(title: string, threat: string, rows: Array<[string, string]>, emptyText = 'None found'): HTMLDivElement {
  const block = node('div', 'vec')
  const heading = node('h3')
  heading.append(node('i', `dot ${rows.length ? threat.toLowerCase() : 'clear'}`))
  heading.append(document.createTextNode(title))
  heading.append(node('em', undefined, rows.length ? threat : 'Clear'))
  block.append(heading)

  if (!rows.length) {
    block.append(node('p', 'none', emptyText))
    return block
  }

  const list = node('ul')
  for (const [key, value] of rows) {
    const li = node('li', 'finding')
    li.append(node('span', 'k', key), node('span', 'v', value))
    list.append(li)
  }
  block.append(list)
  return block
}

function renderSafety(outcome: InspectOutcome): void {
  clear(safety)
  const vision = outcome.vision

  if (!vision) {
    safety.append(node('span', 'safety-pill clean', 'UNKNOWN'))
    safety.append(node('span', undefined, 'Content analysis unavailable'))
    return
  }

  const rating = vision.rating
  safety.append(node('span', `safety-pill ${rating.toLowerCase()}`, rating.toUpperCase()))
  safety.append(
    node('span', undefined, `${Math.round(vision.explicitConfidence * 100)}% explicit confidence`)
  )

  const backend = vision.modelAvailable
    ? `${vision.backend} model · ${vision.durationMs} ms`
    : 'colour heuristic — load a model for real moderation'
  safety.append(node('span', 'safety-meta', backend))
}

function renderInspect(outcome: InspectOutcome, file: File): void {
  inspectedFile = file
  inspectIdle.hidden = true
  inspectResult.hidden = false

  inspectImg.src = trackUrl(file)
  inspectImg.alt = `Preview of ${file.name}`

  // Auto-blur only fires for a real classifier; the toggle stays available so
  // the preview can always be covered manually.
  preview.classList.toggle('blurred', outcome.shouldBlur)
  unblur.hidden = false
  unblur.textContent = outcome.shouldBlur ? 'Unblur' : 'Blur preview'

  renderSafety(outcome)

  const { telemetry, sentinel, vision } = outcome

  inspectScore.className = `score ${outcome.level.toLowerCase()}`
  clear(inspectScore)
  inspectScore.append(node('span', undefined, 'Exposure risk'))
  inspectScore.append(node('b', undefined, outcome.level === 'Critical' ? 'Critical Risk' : outcome.level))

  clear(inspectStats)
  inspectStats.append(
    stat('Dimensions', outcome.width ? `${outcome.width} × ${outcome.height}` : '—'),
    stat('Format', telemetry.format.toUpperCase()),
    stat('EXIF tags', String(telemetry.exifTags), telemetry.exifTags ? 'warn' : 'good'),
    stat('Appended bytes', telemetry.trailingBytes ? formatBytes(telemetry.trailingBytes) : 'none', telemetry.trailingBytes ? 'warn' : 'good')
  )

  if (telemetry.gps) {
    const { lat, lon } = telemetry.gps
    const d = 0.03
    const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`
    inspectMapFrame.src =
      `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}` +
      `&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`
    inspectMap.hidden = false
  } else {
    inspectMapFrame.src = 'about:blank'
    inspectMap.hidden = true
  }

  clear(inspectSections)

  if (vision && !vision.modelAvailable) {
    inspectSections.append(
      node(
        'div',
        'notice',
        'No classifier model is configured, so the safety rating comes from a colour heuristic. ' +
          'Point the SDK at an ONNX model to get real explicit-content scores.'
      )
    )
  }

  // Telemetry vectors come straight from the core inspect pass.
  for (const vector of telemetry.vectors) {
    inspectSections.append(
      section(vector.title, vector.threat, vector.hits.map((h) => [h.key, h.value] as [string, string]))
    )
  }

  if (sentinel) {
    inspectSections.append(
      section(
        'Identity documents',
        'Critical',
        sentinel.documents.map((d) => [d.kind.replace(/-/g, ' '), `${Math.round(d.confidence * 100)}% · ${d.evidence[0] ?? ''}`])
      )
    )
    inspectSections.append(
      section(
        'PII in image text',
        'Critical',
        sentinel.pii.map((p) => [p.kind.replace(/-/g, ' '), `${p.preview} · ${Math.round(p.confidence * 100)}%`]),
        sentinel.ocrAvailable ? 'None found' : 'OCR adapter not configured'
      )
    )
    inspectSections.append(
      section(
        'Faces detected',
        'Medium',
        sentinel.faces.map((f, i) => [`face ${i + 1}`, `${f.width} × ${f.height} at ${f.x}, ${f.y}`]),
        sentinel.faceDetectionUnavailable ? 'Face detector unavailable in this browser' : 'None found'
      )
    )
  }

  if (vision) {
    const hashes = node('div', 'vec')
    const heading = node('h3')
    heading.append(node('i', 'dot clear'))
    heading.append(document.createTextNode('Perceptual hashes'))
    heading.append(node('em', undefined, 'Local'))
    hashes.append(heading)
    hashes.append(node('div', 'hashes', `dHash ${vision.hashes.dhash} · pHash ${vision.hashes.phash}`))
    hashes.append(node('div', 'hashes', `PDQ ${vision.hashes.pdq}`))
    inspectSections.append(hashes)
  }
}

async function runInspect(file: File | undefined): Promise<void> {
  if (!file) {
    note('No image found', 'drop a JPEG, PNG, or WebP', true)
    return
  }

  inspectIdle.hidden = true
  inspectResult.hidden = false
  inspectScore.className = 'score'
  clear(inspectScore)
  inspectScore.append(node('span', undefined, 'Exposure risk'))
  const pending = node('b')
  pending.append(node('i', 'spin'))
  inspectScore.append(pending)

  try {
    const outcome = await strip.inspect(file)
    renderInspect(outcome, file)
  } catch (err) {
    note(file.name, err instanceof Error ? err.message : 'inspection failed', true)
    inspectResult.hidden = true
    inspectIdle.hidden = false
  }
}

unblur.onclick = () => {
  const blurred = preview.classList.toggle('blurred')
  unblur.textContent = blurred ? 'Unblur' : 'Blur preview'
}

purgeAll.onclick = async () => {
  if (!inspectedFile || busy) return
  purgeAll.disabled = true
  const original = purgeAll.textContent
  purgeAll.textContent = 'Purging…'
  try {
    const result = await strip.sanitize(inspectedFile)
    download(result.blob, result.name)
    note(result.name, result.headline)
    purgeAll.textContent = 'Purged — downloaded'
    setTimeout(() => {
      purgeAll.textContent = original
      purgeAll.disabled = false
    }, 1600)
  } catch (err) {
    note('Purge failed', err instanceof Error ? err.message : 'unknown error', true)
    purgeAll.textContent = original
    purgeAll.disabled = false
  }
}

inspectAgain.onclick = () => {
  inspectedFile = null
  inspectResult.hidden = true
  inspectIdle.hidden = false
  inspectMapFrame.src = 'about:blank'
  ifileInput.click()
}

/* ── Input routing ──────────────────────────────────────── */

function accept(list: ArrayLike<File>): void {
  if (busy) return
  releaseUrls()
  const images = imagesFrom(list)
  if (mode === 'inspect') void runInspect(images[0])
  else void runSanitize(images)
}

function openPicker(event: Event): void {
  event.stopPropagation()
  if (!busy) fileInput.click()
}

pick.onclick = openPicker
zone.onclick = openPicker
ipick.onclick = (event) => {
  event.stopPropagation()
  ifileInput.click()
}
izone.onclick = () => ifileInput.click()

fileInput.onchange = () => {
  if (fileInput.files?.length) accept(fileInput.files)
  fileInput.value = ''
}
ifileInput.onchange = () => {
  if (ifileInput.files?.length) accept(ifileInput.files)
  ifileInput.value = ''
}

// Drag state is tracked with a counter because dragleave fires for children.
let dragDepth = 0

function hotTarget(): HTMLElement {
  if (mode === 'inspect') return inspectResult.hidden ? izone : inspectResult
  return sanitizeResult.hidden ? zone : sanitizeResult
}

function clearHot(): void {
  for (const target of [zone, izone, inspectResult, sanitizeResult]) target.classList.remove('hot')
}

document.addEventListener('dragenter', (event) => {
  event.preventDefault()
  dragDepth++
  hotTarget().classList.add('hot')
})

document.addEventListener('dragover', (event) => event.preventDefault())

document.addEventListener('dragleave', (event) => {
  event.preventDefault()
  dragDepth--
  if (dragDepth <= 0) {
    dragDepth = 0
    clearHot()
  }
})

document.addEventListener('drop', (event) => {
  event.preventDefault()
  dragDepth = 0
  clearHot()
  const files = event.dataTransfer?.files
  if (files?.length) accept(files)
})

window.addEventListener('paste', (event) => {
  if (busy || !event.clipboardData) return
  const found: File[] = []
  for (const item of event.clipboardData.items) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) found.push(file)
  }
  if (found.length) {
    event.preventDefault()
    accept(found)
  }
})

window.addEventListener('beforeunload', () => {
  releaseUrls()
  strip.dispose()
})

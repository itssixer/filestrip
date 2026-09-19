/**
 * Joins scrub fragments into one sentence with an Oxford-style conjunction, so
 * the UI never has to assemble copy from raw field names.
 */
export function headline(fragments: string[]): string {
  const items = fragments.filter(Boolean)
  if (!items.length) return 'Nothing to scrub.'
  if (items.length === 1) return `Scrubbed ${items[0]}.`
  if (items.length === 2) return `Scrubbed ${items[0]} and ${items[1]}.`
  return `Scrubbed ${items.slice(0, -1).join(', ')}, and ${items.at(-1)}.`
}

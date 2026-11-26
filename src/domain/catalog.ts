// src/domain/catalog.ts
// The stock Market Wire can find. Pure data and lookups, no I/O.
// Staples that small shops, bakeries, cafes and food stalls run out of mid-day anywhere in the world.
// Each item has one trade unit, so "1 sack flour" always means the same thing to buyer and seller.
// Aliases cover a few common languages (English, Spanish, French, Portuguese, German, Swahili, Hindi/Urdu)
// so a trader can type the word they use at their own counter.

export interface CatalogItem {
  /** Internal name stored on requests, e.g. "flour". */
  name: string
  /** Word used in the canonical command language, e.g. "FLOUR". */
  label: string
  /** Internal unit key, e.g. "sack25kg". */
  unit: string
  /** Unit word used in messages, e.g. "sack". */
  unitWord: string
  /** Short description of the unit for help text, e.g. "25 kg sack". */
  unitHint: string
  grade: string
  /** Lower-case words and phrases that name this item. */
  aliases: readonly string[]
}

export const CATALOG: readonly CatalogItem[] = [
  { name: 'flour', label: 'FLOUR', unit: 'sack25kg', unitWord: 'sack', unitHint: '25 kg sack', grade: 'baking',
    aliases: ['flour', 'baking flour', 'bread flour', 'farine', 'harina', 'farinha', 'mehl', 'unga', 'atta', 'maida'] },
  { name: 'rice', label: 'RICE', unit: 'sack25kg', unitWord: 'sack', unitHint: '25 kg sack', grade: 'long grain',
    aliases: ['rice', 'riz', 'arroz', 'reis', 'mchele', 'chawal'] },
  { name: 'sugar', label: 'SUGAR', unit: 'sack25kg', unitWord: 'sack', unitHint: '25 kg sack', grade: 'white',
    aliases: ['sugar', 'sucre', 'azucar', 'azúcar', 'acucar', 'açúcar', 'zucker', 'sukari', 'cheeni'] },
  { name: 'gas', label: 'GAS', unit: 'cylinder13kg', unitWord: 'cylinder', unitHint: '13 kg cooking gas cylinder', grade: 'lpg',
    aliases: ['gas', 'cooking gas', 'lpg', 'propane', 'butane', 'gaz', 'gás', 'gas cylinder', 'gesi'] },
  { name: 'oil', label: 'OIL', unit: 'can20l', unitWord: 'can', unitHint: '20 litre can', grade: 'cooking',
    aliases: ['oil', 'cooking oil', 'veg oil', 'vegetable oil', 'huile', 'aceite', 'oleo', 'óleo', 'mafuta'] },
  { name: 'coffee', label: 'COFFEE', unit: 'bag1kg', unitWord: 'bag', unitHint: '1 kg bag of beans', grade: 'beans',
    aliases: ['coffee', 'coffee beans', 'cafe', 'café', 'kaffee', 'kahawa'] },
  { name: 'eggs', label: 'EGGS', unit: 'tray30', unitWord: 'tray', unitHint: 'tray of 30', grade: 'medium',
    aliases: ['eggs', 'egg', 'oeufs', 'œufs', 'huevos', 'ovos', 'eier', 'mayai'] },
  { name: 'milk', label: 'MILK', unit: 'crate12', unitWord: 'crate', unitHint: 'crate of 12 litres', grade: 'fresh',
    aliases: ['milk', 'lait', 'leche', 'leite', 'milch', 'maziwa', 'doodh'] },
]

/** Unit words a trader may type before the item ("2 sacks", "1 tray"). Any of them is accepted for any item. */
export const UNIT_WORDS: readonly string[] = [
  'sack', 'sacks', 'bag', 'bags', 'tray', 'trays', 'crate', 'crates', 'cylinder', 'cylinders', 'can', 'cans',
  'jerrycan', 'jerrycans', 'drum', 'drums', 'box', 'boxes', 'case', 'cases', 'carton', 'cartons', 'unit', 'units',
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const byLength = (a: string, b: string) => b.length - a.length

const ALIAS_INDEX: ReadonlyArray<readonly [string, CatalogItem]> =
  CATALOG.flatMap(item => item.aliases.map(alias => [alias, item] as const)).sort((a, b) => byLength(a[0], b[0]))

/** Matches any known unit word as a whole word. */
export const UNIT_PATTERN = new RegExp(`\\b(${[...UNIT_WORDS].sort(byLength).map(escape).join('|')})\\b`, 'i')

/** Matches any catalogue label in canonical text, e.g. "FLOUR". */
export const LABEL_PATTERN = new RegExp(`\\b(${CATALOG.map(i => i.label).join('|')})\\b`, 'i')

/** Find the catalogue item a text names, or undefined. Longest alias wins ("cooking gas" before "gas"). */
export function findItem(text: string): CatalogItem | undefined {
  const lower = text.toLowerCase()
  for (const [alias, item] of ALIAS_INDEX) {
    if (new RegExp(`(^|[^\\p{L}])${escape(alias)}($|[^\\p{L}])`, 'u').test(lower)) return item
  }
  return undefined
}

export function itemByName(name: string): CatalogItem | undefined {
  return CATALOG.find(i => i.name === name)
}

// Units written by earlier builds, kept so saved demo sessions still read correctly.
const LEGACY_UNIT_WORDS: Record<string, string> = { crate30: 'tray', bottle50: 'bottle' }

/** The word a buyer or seller sees for an internal unit key, e.g. "sack25kg" -> "sack". */
export function unitWordFor(unit: string): string {
  return CATALOG.find(i => i.unit === unit)?.unitWord ?? LEGACY_UNIT_WORDS[unit] ?? unit
}

/** Replace every internal unit key in a message with its plain word. */
export function plainUnits(text: string): string {
  const keys = [...new Set([...CATALOG.map(i => i.unit), ...Object.keys(LEGACY_UNIT_WORDS)])].sort(byLength)
  return text.replace(new RegExp(`\\b(${keys.map(escape).join('|')})\\b`, 'g'), k => unitWordFor(k))
}

/** One-line list for help replies, e.g. "flour, rice, sugar, gas, oil, coffee, eggs, milk". */
export const ITEM_LIST = CATALOG.map(i => i.name).join(', ')

/** The example every help text uses. */
export const EXAMPLE_NEED = 'NEED 1 SACK FLOUR BEFORE 5PM'

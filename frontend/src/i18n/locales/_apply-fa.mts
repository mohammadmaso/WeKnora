import { readFileSync } from 'node:fs'
import { writeLocaleModule } from '../localeSerialize.ts'
import en from './en-US.ts'
import fa from './fa-IR.ts'

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      target[key] = value
    }
  }
}

function collect(root: unknown, path = ''): Array<{ path: string; value: string }> {
  if (typeof root === 'string') return path ? [{ path, value: root }] : []
  if (!root || typeof root !== 'object') return []
  return Object.entries(root as Record<string, unknown>).flatMap(([key, child]) =>
    collect(child, path ? `${path}.${key}` : key),
  )
}

const tree = structuredClone(fa) as Record<string, unknown>
for (const file of process.argv.slice(2)) {
  deepMerge(tree, JSON.parse(readFileSync(file, 'utf8')))
}

const language = (tree.language ??= {}) as Record<string, unknown>
language.faIR = 'فارسی'

writeLocaleModule(new URL('./fa-IR.ts', import.meta.url).pathname, tree)

const enKeys = new Set(collect(en).map((item) => item.path))
const faKeys = new Set(collect(tree).map((item) => item.path))
const missing = [...enKeys].filter((key) => !faKeys.has(key))
const extra = [...faKeys].filter((key) => !enKeys.has(key) && key !== 'language.faIR')
const same = collect(tree).filter((item) => {
  const english = collect(en).find((entry) => entry.path === item.path)
  return english && english.value === item.value
})
console.log(
  JSON.stringify(
    {
      en: enKeys.size,
      fa: faKeys.size,
      missing: missing.length,
      extra: extra.length,
      extraKeys: extra.slice(0, 20),
      stillEnglish: same.length,
      faIR: language.faIR,
    },
    null,
    2,
  ),
)

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const requiredCases = [
  'local', 'widen', 'model-disabled', 'changed-quote', 'competing-buyers',
  'two-quotes', 'cancel-in-transit', 'overlap-opt-out', 'fallback-late',
  'session-isolation', 'restart-duplicate-done', 'desktop-smoke', 'mobile-smoke',
]

export function verify(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.cases)) {
    return ['Expected an object containing a cases array.']
  }

  const errors = []
  for (const key of ['revision', 'environment']) {
    if (typeof report[key] !== 'string' || !report[key].trim()) {
      errors.push(`Missing ${key}.`)
    }
  }

  const seen = new Set()
  for (const result of report.cases) {
    if (!result || typeof result.id !== 'string' || !result.id.trim()) {
      errors.push('Every case needs an ID.')
      continue
    }
    if (seen.has(result.id)) errors.push(`Duplicate case: ${result.id}.`)
    seen.add(result.id)
    if (result.status !== 'passed') errors.push(`Case did not pass: ${result.id}.`)
    if (typeof result.evidence !== 'string' || !result.evidence.trim()) {
      errors.push(`Missing evidence: ${result.id}.`)
    }
  }

  for (const id of requiredCases) {
    if (!seen.has(id)) errors.push(`Missing case: ${id}.`)
  }
  return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = JSON.parse(readFileSync(process.argv[2], 'utf8'))
    const errors = verify(report)
    if (errors.length) {
      console.error(errors.join('\n'))
      process.exitCode = 1
    } else {
      console.log('All required acceptance outcomes were recorded as passed.')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requiredCases, verify } from './check-report.mjs'

function fixture() {
  return {
    revision: 'fixture',
    environment: 'checker unit test',
    cases: requiredCases.map(id => ({ id, status: 'passed', evidence: 'fixture only' })),
  }
}

test('accepts a complete synthetic report', () => {
  assert.deepEqual(verify(fixture()), [])
})

test('rejects an absent report and missing case evidence', () => {
  assert.notEqual(verify(null).length, 0)
  const report = fixture()
  report.cases[0].evidence = ''
  assert.ok(verify(report).some(error => error.startsWith('Missing evidence')))
})

test('rejects duplicate, failed and missing cases', () => {
  const report = fixture()
  report.cases[0].status = 'failed'
  report.cases[1] = report.cases[0]
  assert.equal(verify(report).filter(error => error.includes('Duplicate case')).length, 1)
  assert.ok(verify(report).some(error => error.startsWith('Case did not pass')))
  assert.ok(verify(report).some(error => error.startsWith('Missing case')))
})

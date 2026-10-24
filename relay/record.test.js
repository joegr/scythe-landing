import assert from 'node:assert/strict'
import { test } from 'node:test'
import { campaign, record } from './record.js'

test('every signup is attributed to the landing page', () => {
  const now = new Date('2026-10-24T12:00:00Z')
  assert.deepEqual(record('you@school.edu', null, now),
    { email: 'you@school.edu', source: 'landing', campaign: null, created_at: '2026-10-24T12:00:00.000Z' })
  assert.equal(record('you@school.edu', 'utm_source=reddit', now).source, 'landing')
})

test('the campaign keeps only utm tags', () => {
  assert.equal(campaign('utm_source=reddit&gclid=abc&email=a%40b.c'), 'utm_source=reddit')
  assert.equal(campaign('gclid=abc'), null)
  assert.equal(campaign(''), null)
  assert.equal(campaign('utm_campaign=' + 'x'.repeat(100)).length, 'utm_campaign='.length + 60)
})

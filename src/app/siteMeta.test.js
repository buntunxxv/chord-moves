import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { SITE_META, metaKeyForPath, renderMetaTags, withMeta } from './siteMeta.js'

const root = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('only /chordmoves and below are Chord Moves; everything else is the suite', () => {
  for (const p of ['/chordmoves', '/chordmoves/', '/chordmoves/demo']) assert.equal(metaKeyForPath(p), 'chordmoves', p)
  for (const p of ['/', '/upgrade', '/chord-dice', '/rhythm-dice', '/metronome', '/chordmovesx']) assert.equal(metaKeyForPath(p), 'tools', p)
})

test('the suite names itself Kynda Learning Tools, with its own image, manifest and Home Screen name', () => {
  const html = renderMetaTags('tools')
  assert.match(html, /<title>Kynda Learning Tools<\/title>/)
  assert.match(html, /og:title" content="Kynda Learning Tools"/)
  assert.match(html, /og:image" content="https:\/\/tools\.kyndalearning\.co\.uk\/og-tools\.png"/)
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/)
  assert.match(html, /apple-mobile-web-app-title" content="Kynda Tools"/)
  assert.doesNotMatch(html, /Chord Moves —|chordmoves\.webmanifest|og-image\.png/)
})

test('Chord Moves keeps its own metadata on its own pages', () => {
  const html = renderMetaTags('chordmoves')
  assert.match(html, /<title>Chord Moves — Kynda Learning<\/title>/)
  assert.match(html, /og:image" content="https:\/\/tools\.kyndalearning\.co\.uk\/og-image\.png"/)
  assert.match(html, /canonical" href="https:\/\/tools\.kyndalearning\.co\.uk\/chordmoves"/)
  assert.match(html, /rel="manifest" href="\/chordmoves\.webmanifest"/)
  assert.match(html, /apple-mobile-web-app-title" content="Chord Moves"/)
})

test('index.html carries the markers and no hard-coded identity of its own', () => {
  const html = read('index.html')
  assert.doesNotMatch(html, /<title>|og:title|apple-mobile-web-app-title|rel="manifest"/)
  const tools = withMeta(html, 'tools')
  assert.equal((tools.match(/<title>/g) || []).length, 1)
  assert.equal(withMeta(tools, 'chordmoves').match(/<title>(.*)<\/title>/)[1], 'Chord Moves — Kynda Learning')
})

test('manifests and images exist, and each identity has its own manifest', () => {
  const tools = JSON.parse(read('public/manifest.webmanifest'))
  const cm = JSON.parse(read('public/chordmoves.webmanifest'))
  assert.deepEqual([tools.name, tools.short_name, tools.start_url, tools.id], ['Kynda Learning Tools', SITE_META.tools.homeScreenName, '/', '/'])
  assert.deepEqual([cm.short_name, cm.start_url, cm.id], [SITE_META.chordmoves.homeScreenName, '/chordmoves', '/chordmoves'])
  for (const key of Object.keys(SITE_META)) assert.ok(existsSync(new URL('public' + SITE_META[key].image, root)), SITE_META[key].image)
})

test('vercel.json serves chordmoves.html for /chordmoves before the catch-all', () => {
  const rewrites = JSON.parse(read('vercel.json')).rewrites
  const at = src => rewrites.findIndex(r => r.source === src)
  assert.equal(rewrites[at('/chordmoves')].destination, '/chordmoves.html')
  assert.equal(rewrites[at('/chordmoves/:path*')].destination, '/chordmoves.html')
  assert.ok(at('/chordmoves') < at('/(.*)') && at('/chordmoves/:path*') < at('/(.*)'))
})

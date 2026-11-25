#!/usr/bin/env node
// Chord Dice end to end in Chromium, on an iPad-size screen:
//   1. From the name: build a chord, see the Result, keep it with a reason.
//   2. From the sound: the chord plays on Roll; while the student works,
//      nothing on the page (text, attributes or the accessibility tree)
//      gives it away -- two different chords render the same page. Then
//      replay twice, build it, keep it.
//   3. Reload: both kept chords are still there.
//   4. Reveal a chord, keep it: it is kept and flagged as revealed, and the
//      flag survives a reload.
// Rolls are made deterministic by setting Math.random just before Roll; the
// expected chord is worked out here with the app's own roll code.
// Needs a build: npm run build && node scripts/verify-chord-dice-e2e.mjs
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { resolveChord, rollChord } from '../src/tools/chord-dice/faces.js'
import { spelledNotes } from '../src/tools/chord-dice/answer.js'

const PORT = 4186
const BASE = `http://localhost:${PORT}`
const executablePath = process.env.CHROMIUM_PATH || undefined

const failures = []
function check(label, pass, detail) {
  console.log(`${pass ? '✓' : '✗'}  ${label}`)
  if (!pass) {
    failures.push(label)
    if (detail) console.log(`    ${detail}`)
  }
}

// The chord a forced roll gives, worked out with the app's own code.
function expected(levelKey, values) {
  const v = [...values]
  return resolveChord(rollChord(levelKey, { rng: () => (v.length ? v.shift() : 0.5) }))
}

async function forceRoll(page, values) {
  await page.evaluate(v => { const q = [...v]; Math.random = () => (q.length ? q.shift() : 0.5) }, values)
  await page.getByRole('button', { name: /^Roll/ }).click()
}

const sounds = page => page.evaluate(() => window.__cdSounds.slice())

async function build(page, chord) {
  for (const c of chord.chromas) await page.locator(`.cd-key[data-chroma="${c}"]`).click()
}

async function keepWith(page, reason) {
  await page.getByRole('tab', { name: 'Keep' }).click()
  const keepBtn = page.getByRole('button', { name: 'Keep', exact: true })
  const disabledEmpty = await keepBtn.isDisabled()
  await page.locator('#cd-reason').fill(reason)
  await keepBtn.click()
  return disabledEmpty
}

// Everything a sighted or screen-reader user could get from the page: its
// text, every attribute value, and the accessibility tree.
async function exposed(page) {
  const dom = await page.evaluate(() => {
    const root = document.querySelector('.chord-dice')
    const attrs = []
    for (const el of root.querySelectorAll('*')) for (const a of el.attributes) attrs.push(`${a.name}=${a.value}`)
    return { text: root.innerText, html: root.outerHTML, attrs: attrs.join('\n') }
  })
  const aria = await page.locator('.chord-dice').ariaSnapshot()
  return { ...dom, aria }
}

async function isUp() {
  try { return (await fetch(BASE)).ok } catch { return false }
}

if (await isUp()) throw new Error(`port ${PORT} is already serving something -- stop it and re-run`)
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] })

async function freshPage(viewport = { width: 820, height: 1106 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'reduce' })
  await ctx.addInitScript(() => {
    window.__cdSounds = []
    window.addEventListener('chorddice:sound', e => window.__cdSounds.push(e.detail.kind))
  })
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', e => page.errors.push(e.message))
  await page.goto(`${BASE}/chord-dice`, { waitUntil: 'networkidle' })
  return { ctx, page }
}

try {
  for (let i = 0; ; i++) {
    if (await isUp()) break
    if (i > 50) throw new Error('vite preview did not start -- run npm run build first')
    await new Promise(r => setTimeout(r, 200))
  }

  // ---------- 1. from the name ----------
  const { ctx, page } = await freshPage()
  await page.getByRole('radio', { name: 'Level 2' }).click()
  await page.getByRole('radio', { name: 'From name' }).click()
  const named = expected('L2', [0, 7 / 24 + 0.001]) // E♭m
  await forceRoll(page, [0, 7 / 24 + 0.001])
  check('from the name: the dice show the chord', (await page.locator('.cd-die__face').allTextContents()).join(' ') === 'E♭ minor')
  check('from the name: Roll makes no sound', (await sounds(page)).length === 0)
  check('from the name: the prompt names the chord', (await page.locator('.cd-feedback').innerText()).includes(`Build ${named.name}.`))
  // A wrong note first: the feedback names the interval and asks.
  await page.locator('.cd-key[data-chroma="7"]').click() // G, a major third above E♭
  const fb = await page.locator('.cd-feedback__line').innerText()
  check('a wrong note gets an interval reflection', /major third above E♭\. Minor needs a minor third\. .*\?$/.test(fb), fb)
  await page.locator('.cd-key[data-chroma="7"]').click() // take it away again
  await page.locator(`.cd-key[data-chroma="${named.chromas[0]}"]`).click()
  await page.getByRole('button', { name: 'Hear my chord' }).click()
  check('Hear my chord plays the notes chosen so far', (await sounds(page)).includes('selection'))
  await build(page, { chromas: named.chromas.slice(1) })
  check('from the name: completing the set opens Result', await page.getByRole('tab', { name: 'Result' }).getAttribute('aria-selected') === 'true')
  const result1 = await page.locator('.cd-result').innerText()
  check('Result shows the name, notes and a reflection',
    result1.includes(named.name) && result1.includes(spelledNotes(named)) && result1.includes('Which note makes it minor?'), result1)
  const emptyBlocked = await keepWith(page, 'Dark, and the G♭ is the reason')
  check('Keep needs a reason', emptyBlocked)
  check('kept from the name', (await page.locator('.cd-kept__item').first().innerText()).includes('From name'))

  // ---------- 2. from the sound ----------
  await page.getByRole('radio', { name: 'From sound' }).click()
  const heardValues = [0, 16 / 24 + 0.001] // G♯ major: E♭m was just kept
  const heard = expected('L2', heardValues)
  await page.locator('.cd-notice').waitFor({ state: 'detached' })
  const before = (await sounds(page)).length
  await forceRoll(page, heardValues)
  check('from the sound: the chord plays on Roll', (await sounds(page)).slice(before).includes('target'))
  const a = await exposed(page)

  // The same moment with a different chord must expose exactly the same page.
  const other = await freshPage()
  await other.page.getByRole('radio', { name: 'Level 2' }).click()
  await other.page.getByRole('radio', { name: 'From sound' }).click()
  await other.page.evaluate(() => { localStorage.setItem('kyndaTools.chordDice.keptChords', '[]') })
  await forceRoll(other.page, [0, 3 / 24 + 0.001]) // C♯m
  const b = await exposed(other.page)
  check('from the sound: two different chords render identical markup', a.html === b.html)
  check('from the sound: …and an identical accessibility tree', a.aria === b.aria, `\n${a.aria}\n---\n${b.aria}`)
  await other.ctx.close()

  const leaks = (e, chord) => {
    const out = []
    const hay = `${e.text}\n${e.attrs}\n${e.aria}`
    for (const s of [chord.name, chord.prose, spelledNotes(chord), chord.quality, chord.notes.join(' ')]) {
      // A major chord's name is its root, which every keyboard shows as a
      // key label; the die-face check below covers it.
      if (s === chord.name && chord.quality === 'major') continue
      if (hay.includes(s)) out.push(s)
    }
    if (/die: (?!hidden)/.test(hay)) out.push('a die face')
    return out
  }
  check('from the sound: no name, quality or notes in text, attributes or a11y tree', leaks(a, heard).length === 0, leaks(a, heard).join(', '))
  check('from the sound: Result and Keep are closed while working',
    await page.getByRole('tab', { name: 'Result' }).isDisabled() && await page.getByRole('tab', { name: 'Keep' }).isDisabled())

  // A note that is not in the chord, then replays: still nothing given away.
  await page.locator('.cd-key[data-chroma="2"]').click() // D
  await page.locator('.cd-replay').click()
  await page.locator('.cd-replay').click()
  const replayLabel = await page.locator('.cd-replay').getAttribute('aria-label')
  check('replays are counted neutrally', replayLabel === 'Play the chord again. 2 replays so far', replayLabel)
  const mid = await exposed(page)
  check('from the sound: still concealed after a wrong note and replays', leaks(mid, heard).length === 0, leaks(mid, heard).join(', '))
  await page.locator('.cd-key[data-chroma="2"]').click()
  await build(page, heard)
  const result2 = await page.locator('.cd-result').innerText()
  check('from the sound: Result names the chord after it is built', result2.includes(heard.name) && result2.includes(spelledNotes(heard)), result2)
  check('from the sound: reflection includes the replay count',
    result2.includes('You replayed it twice. What did you listen for on the last play?') && result2.includes('2 replays'), result2)
  check('dice faces show once built', (await page.locator('.cd-die__face').allTextContents()).join(' ') === 'G♯ major')
  await keepWith(page, 'Heard the bright third first')
  check('kept from the sound with its replays', (await page.locator('.cd-kept__item').first().innerText()).includes('From sound · 2 replays'))

  // ---------- 3. reload ----------
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'Keep' }).click()
  const afterReload = await page.locator('.cd-kept').innerText()
  check('kept chords survive a reload',
    afterReload.includes('G♯') && afterReload.includes('Heard the bright third first') && afterReload.includes('E♭m') && afterReload.includes('Dark, and the G♭ is the reason'), afterReload)

  // ---------- 4. reveal and keep ----------
  await page.getByRole('radio', { name: 'From name' }).click()
  const shown = expected('L2', [0, 0.999])
  await forceRoll(page, [0, 0.999]) // Bm
  await page.getByRole('button', { name: 'Reveal' }).click()
  const result3 = await page.locator('.cd-result').innerText()
  check('Reveal shows the answer, marked as revealed', result3.includes(shown.name) && result3.includes(spelledNotes(shown)) && result3.includes('Revealed'), result3)
  await keepWith(page, 'Needed to see it; B to D is the minor third')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: 'Keep' }).click()
  const first = page.locator('.cd-kept__item').first()
  check('a revealed chord is kept and flagged, after a reload',
    (await first.innerText()).includes('Revealed') && await first.getAttribute('data-revealed') === 'true')
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('kyndaTools.chordDice.keptChords')))
  check('storage records chord, start, replays and reveal',
    stored.length === 3
    && stored[0].symbol === 'Bm' && stored[0].revealed === true && stored[0].start === 'name'
    && stored[1].symbol === 'G#' && stored[1].start === 'sound' && stored[1].replays === 2 && stored[1].revealed === false
    && stored[2].symbol === 'Ebm' && stored[2].start === 'name' && stored[2].revealed === false,
    JSON.stringify(stored))

  check('no page errors', page.errors.length === 0, page.errors.join(' | '))
  await ctx.close()

  // ---------- 5. Level 3: nothing before Submit ----------
  // The same three keys, pressed for two different chords: for C diminished
  // they are its notes; for D augmented they are not. Until Submit the
  // pages must be identical, and the right notes must not finish the round.
  const tapped = [0, 3, 6]
  const views = []
  for (const values of [[0, 0 / 48 + 0.001], [0, 9 / 48 + 0.001]]) {
    const t = await freshPage()
    await t.page.getByRole('radio', { name: 'Level 3' }).click()
    await t.page.getByRole('radio', { name: 'From sound' }).click()
    await forceRoll(t.page, values)
    for (const c of tapped) await t.page.locator(`.cd-key[data-chroma="${c}"]`).click()
    views.push({ t, seen: await exposed(t.page) })
  }
  check('Level 3: Cdim and Daug look identical before Submit, same keys pressed', views[0].seen.html === views[1].seen.html && views[0].seen.aria === views[1].seen.aria)
  check('Level 3: the right notes do not finish the round by themselves',
    await views[0].t.page.getByRole('tab', { name: 'Result' }).isDisabled())
  check('Level 3: no feedback words before Submit', (await views[0].t.page.locator('.cd-feedback__line').count()) === 0)
  // Submit: the wrong set gets feedback (extra and missing apart); the right set finishes.
  await views[1].t.page.getByRole('button', { name: 'Submit' }).click()
  const wrongFb = await views[1].t.page.locator('.cd-feedback').innerText()
  check('Level 3: Submit on the wrong notes reflects, naming only what was placed',
    // Daug is D, F♯, A♯; F♯ was tapped. D and A♯/B♭ must not be named.
    /Your last Submit/i.test(wrongFb) && !/augmented|A♯|B♭|(^|[^A-Za-z])D(?![♯♭])/.test(wrongFb), wrongFb)
  await views[0].t.page.getByRole('button', { name: 'Submit' }).click()
  check('Level 3: Submit on the right notes opens Result',
    (await views[0].t.page.locator('.cd-result').innerText()).includes('Cdim'))
  await views[1].t.ctx.close()

  // ---------- 6. Change one die ----------
  const cp = views[0].t.page
  // From sound, the changed die is the only one hidden. Cdim's Quality can
  // become aug, sus2 or sus4; force aug.
  await cp.evaluate(() => { const v = [0]; Math.random = () => (v.length ? v.shift() : 0.5) })
  await cp.getByRole('button', { name: /^Change the Quality die/ }).click()
  const faces = await cp.locator('.cd-die__face').allTextContents()
  check('Change one die from sound: only the changed die is hidden', faces.join(' ') === 'C ?', faces.join(' '))
  check('Change one die from sound: the new chord plays', (await sounds(cp)).filter(k => k === 'target').length >= 2)
  for (const c of [0, 4, 8]) await cp.locator(`.cd-key[data-chroma="${c}"]`).click()
  await cp.getByRole('button', { name: 'Submit' }).click()
  const changedResult = await cp.locator('.cd-result').innerText()
  check('the change reflection names what moved',
    changedResult.includes('You changed the Quality: Cdim became Caug. E♭ moved up a semitone to E, and G♭ moved up a tone to G♯.'), changedResult)
  await keepWith(cp, 'The fifth going up makes it float')
  const keptChanged = JSON.parse(await cp.evaluate(() => localStorage.getItem('kyndaTools.chordDice.keptChords')))[0]
  check('a changed chord is kept with what it changed from',
    keptChanged.symbol === 'Caug' && keptChanged.changedFrom?.die === 'quality' && keptChanged.changedFrom?.symbol === 'Cdim', JSON.stringify(keptChanged))
  check('kept list says it was changed', (await cp.locator('.cd-kept__item').first().innerText()).includes('Changed Quality'))
  // Levels 1–3: two dice (Root, Quality); the Colour die waits for Level 4.
  await cp.getByRole('radio', { name: 'Level 1' }).click()
  await cp.getByRole('radio', { name: 'From name' }).click()
  await forceRoll(cp, [0, 0])
  await cp.getByRole('button', { name: 'Reveal' }).click()
  check('Levels 1–3 show two dice and no Colour die',
    (await cp.locator('.cd-die__face').allTextContents()).join(' ') === 'C major'
    && (await cp.getByRole('button', { name: /^Change the Colour die/ }).count()) === 0
    && (await cp.locator('.cd-result__hint').innerText()) === 'Change one die: tap Root or Quality above. The other stays.')
  check('no page errors at Level 3', cp.errors.length === 0, cp.errors.join(' | '))
  await views[0].t.ctx.close()
} finally {
  await browser.close()
  server.kill()
}

if (failures.length) {
  console.error(`\n${failures.length} Chord Dice end-to-end check(s) failed.`)
  process.exit(1)
}
console.log('\nChord Dice: from the name, from the sound, keep, reload and reveal all work; nothing leaks while listening.')

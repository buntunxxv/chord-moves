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

// The Pro endpoints are stubbed: `server.entitled` says what the server
// would answer for the stored email.
async function freshPage(viewport = { width: 820, height: 1106 }, server = null) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'reduce' })
  if (server) {
    await ctx.route('**/api/request-unlock-code', r => r.fulfill({ json: { ok: true } }))
    await ctx.route('**/api/verify-unlock-code', r => r.fulfill({ json: { isPro: server.entitled } }))
    await ctx.route('**/api/check-entitlement', r => r.fulfill({ json: { isPro: server.entitled } }))
  }
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

  // ---------- 7. Level 4 and Tools Pro ----------
  const server = { entitled: true }
  const pp = await freshPage(undefined, server)
  const p4 = pp.page
  check('Level 4 is marked Pro and locked', await p4.getByRole('radio', { name: 'Level 4 (sevenths), Pro' }).count() === 1)
  await p4.getByRole('radio', { name: 'Level 4 (sevenths), Pro' }).click()
  const gate = await p4.locator('[role="dialog"]').innerText()
  check('Level 4 opens the Pro sheet with its reason', gate.includes('Level 4 (sevenths) is part of Pro.') && /chord dice pro/i.test(gate), gate)
  check('the level stays where it was', await p4.getByRole('radio', { name: 'Level 1' }).getAttribute('aria-checked') === 'true')
  await p4.fill('#cd-pro-email', 'Student@Example.com')
  await p4.getByRole('button', { name: 'Send code', exact: true }).click()
  await p4.fill('#cd-pro-code', '123 456')
  check('the code field keeps six digits', await p4.inputValue('#cd-pro-code') === '123456')
  await p4.getByRole('button', { name: 'Unlock', exact: true }).click()
  await p4.getByText('Levels 4 and 5 are open').waitFor()
  check('unlocked: the sheet says what is open', (await p4.locator('[role="dialog"]').innerText()).includes('Levels 4 and 5 are open'))
  await p4.getByRole('button', { name: 'Try Level 4' }).click()
  check('Try Level 4 selects it, with a Pro chip',
    await p4.getByRole('radio', { name: 'Level 4 (sevenths)', exact: true }).getAttribute('aria-checked') === 'true'
    && await p4.getByRole('button', { name: /Pro is on for this device/ }).count() === 1)
  check('Pro is stored under the shared Tools keys',
    await p4.evaluate(() => localStorage.getItem('kyndaTools.pro') === 'pro' && localStorage.getItem('kyndaTools.proEmail') === 'student@example.com'))
  // C major seventh (index 1 of Level 4): three dice, the Colour die is back.
  await forceRoll(p4, [0, 1 / 36 + 0.001])
  // The dice read as the chord is said: major · 7 is a major seventh.
  check('Level 4 rolls three dice: major · 7 is Cmaj7', (await p4.locator('.cd-die__face').allTextContents()).join(' ') === 'C major 7')
  for (const c of [0, 4, 7, 10]) await p4.locator(`.cd-key[data-chroma="${c}"]`).click()
  await p4.getByRole('button', { name: 'Submit' }).click()
  const fb7 = await p4.locator('.cd-feedback').innerText()
  check('Level 4 Submit: the Phase 0 seventh example', fb7.includes('You played a minor seventh above C. C major seventh uses a major seventh.'), fb7)
  await p4.locator('.cd-key[data-chroma="10"]').click()
  await p4.locator('.cd-key[data-chroma="11"]').click()
  await p4.getByRole('button', { name: 'Submit' }).click()
  check('Level 4 built: Result', (await p4.locator('.cd-result').innerText()).includes('Cmaj7'))
  // At Level 4 the Colour die is always 7: it says why instead of changing.
  await p4.getByRole('button', { name: /^Change the Colour die/ }).click()
  check('a die with one face says what to change instead',
    (await p4.locator('.cd-notice').innerText()).includes('The Colour die has only “7” at this level. Change the Root or the Quality instead'))
  // The Quality die moves between the sevenths: major · 7 -> dom · 7 is C7.
  await p4.evaluate(() => { const v = [0]; Math.random = () => (v.length ? v.shift() : 0.5) })
  await p4.getByRole('button', { name: /^Change the Quality die/ }).click()
  check('the Quality die turns Cmaj7 into C7 (dom · 7)', (await p4.locator('.cd-die__face').allTextContents()).join(' ') === 'C dom 7')
  await p4.getByRole('button', { name: 'Reveal' }).click()
  await keepWith(p4, 'The flat seventh wants to move')

  // The same Pro in Rhythm Dice, on the same device.
  await p4.goto(`${BASE}/rhythm-dice`, { waitUntil: 'networkidle' })
  check('the unlock carries to Rhythm Dice', await p4.getByRole('button', { name: /Pro is on for this device/ }).count() === 1)
  await p4.goto(`${BASE}/chord-dice`, { waitUntil: 'networkidle' })

  // Remove Pro: back to Level 1; a kept seventh needs Pro to play.
  await forceRoll(p4, [0, 0])
  await p4.getByRole('button', { name: /Pro is on for this device/ }).click()
  await p4.getByRole('button', { name: 'Remove Pro from this device' }).click()
  check('removing Pro returns to Level 1 and clears the seventh on the table',
    await p4.getByRole('radio', { name: 'Level 1' }).getAttribute('aria-checked') === 'true'
    && (await p4.locator('.cd-die__face').allTextContents()).join(' ') === '– –')
  await p4.getByRole('tab', { name: 'Keep' }).click()
  await p4.getByRole('button', { name: 'Hear C7' }).click()
  check('a kept seventh asks for Pro before it plays', (await p4.locator('[role="dialog"]').innerText()).includes('This chord is from Level 4, which is part of Pro.'))
  await p4.keyboard.press('Escape')
  check('no page errors with Pro', p4.errors.length === 0, p4.errors.join(' | '))
  await pp.ctx.close()

  // Unlocked in Rhythm Dice -> open in Chord Dice. Then the lessons end:
  // the next visit's re-check removes Pro and leaves Level 4.
  const rd = await freshPage(undefined, server)
  await rd.page.goto(`${BASE}/rhythm-dice`, { waitUntil: 'networkidle' })
  await rd.page.getByRole('radio', { name: /Level 4/ }).click()
  await rd.page.fill('#rd-pro-email', 'parent@example.com')
  await rd.page.getByRole('button', { name: 'Send code', exact: true }).click()
  await rd.page.fill('#rd-pro-code', '654321')
  await rd.page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await rd.page.getByRole('button', { name: 'Try Level 4' }).waitFor()
  await rd.page.goto(`${BASE}/chord-dice`, { waitUntil: 'networkidle' })
  check('a Rhythm Dice unlock opens Level 4 in Chord Dice',
    await rd.page.getByRole('radio', { name: 'Level 4 (sevenths)', exact: true }).count() === 1
    && await rd.page.getByRole('button', { name: /Pro is on for this device/ }).count() === 1)
  await rd.page.getByRole('radio', { name: 'Level 4 (sevenths)', exact: true }).click()
  server.entitled = false
  await rd.page.reload({ waitUntil: 'networkidle' })
  await rd.page.locator('.cd-notice').waitFor()
  check('a "not Pro" re-check removes Pro and leaves Level 4',
    (await rd.page.locator('.cd-notice').innerText()).includes('Pro is no longer on this device')
    && await rd.page.getByRole('radio', { name: 'Level 1' }).getAttribute('aria-checked') === 'true'
    && await rd.page.evaluate(() => localStorage.getItem('kyndaTools.pro')) === null)
  await rd.ctx.close()

  // ---------- 8. Level 5: the Bass die ----------
  const l5 = await freshPage(undefined, { entitled: true })
  const p5 = l5.page
  await p5.evaluate(() => { localStorage.setItem('kyndaTools.pro', 'pro'); localStorage.setItem('kyndaTools.proEmail', 'a@b.co') })
  await p5.reload({ waitUntil: 'networkidle' })
  await p5.getByRole('radio', { name: 'Level 5 (bass and ninths)', exact: true }).click()
  await p5.getByRole('radio', { name: 'From name' }).click()
  await forceRoll(p5, [0, 0.0001]) // C/E
  check('Level 5 rolls four dice', (await p5.locator('.cd-die__face').allTextContents()).join(' ') === 'C major none 3rd')
  for (const c of [0, 4, 7]) await p5.locator(`.cd-key[data-chroma="${c}"]`).click()
  await p5.getByRole('button', { name: 'Submit' }).click()
  const unmarked = await p5.locator('.cd-feedback').innerText()
  check('the right notes with the root in the bass are not C/E', unmarked.includes('The bass is still the root. Which note is the major third? Mark it as the bass.'), unmarked)
  await p5.getByRole('button', { name: 'Mark the bass' }).click()
  await p5.locator('.cd-key[data-chroma="7"]').click()
  check('the marked key says so to a screen reader', await p5.locator('.cd-key[data-chroma="7"]').getAttribute('aria-label') === 'G, marked as the bass')
  await p5.getByRole('button', { name: 'Submit' }).click()
  const wrongBass = await p5.locator('.cd-feedback').innerText()
  check('Phase 0 bass example', wrongBass.includes('Your chord tones are there. You chose the perfect fifth as bass. Which note is the major third?'), wrongBass)
  await p5.getByRole('button', { name: /^Change the bass/ }).click()
  await p5.locator('.cd-key[data-chroma="4"]').click()
  await p5.getByRole('button', { name: 'Hear my chord' }).click()
  await p5.getByRole('button', { name: 'Submit' }).click()
  const r5 = await p5.locator('.cd-result').innerText()
  check('marked E: C/E is built', r5.includes('C/E') && r5.includes('E in the bass'), r5)
  // Change the Bass die: C/E -> C/G (rng 0 picks the first of 5th, 2nd).
  await p5.evaluate(() => { const v = [0]; Math.random = () => (v.length ? v.shift() : 0.5) })
  await p5.getByRole('button', { name: /^Change the Bass die/ }).click()
  check('the Bass die changes on its own', (await p5.locator('.cd-die__face').allTextContents()).join(' ') === 'C major none 5th')
  await p5.getByRole('button', { name: 'Reveal' }).click()
  check('the change reflection names the new lowest note',
    (await p5.locator('.cd-result').innerText()).includes('C/G'))
  await keepWith(p5, 'The fifth underneath makes it float')
  const keptL5 = JSON.parse(await p5.evaluate(() => localStorage.getItem('kyndaTools.chordDice.keptChords')))[0]
  check('a kept slash chord keeps its bass', keptL5.symbol === 'C/G' && keptL5.bass === '5' && keptL5.revealed === true, JSON.stringify(keptL5))

  // From the sound: C/E and Cadd9 with the same keys and the same marked
  // bass look identical before Submit; the Bass die is hidden.
  await p5.getByRole('radio', { name: 'From sound' }).click()
  const l5views = []
  for (const values of [[0, 0.0001], [0, 6 / 132 + 0.0001]]) {
    await forceRoll(p5, values)
    for (const c of [0, 4, 7]) await p5.locator(`.cd-key[data-chroma="${c}"]`).click()
    await p5.getByRole('button', { name: 'Mark the bass' }).click()
    await p5.locator('.cd-key[data-chroma="4"]').click()
    await p5.locator('.cd-die--rolling').first().waitFor({ state: 'detached' }) // the roll's tumble, not the chord
    l5views.push(await exposed(p5))
  }
  {
    const [x, y] = [l5views[0].html, l5views[1].html]
    let k = 0
    while (k < x.length && x[k] === y[k]) k++
    check('Level 5 from the sound: C/E and Cadd9 look identical before Submit', x === y && l5views[0].aria === l5views[1].aria,
      `first difference: …${x.slice(Math.max(0, k - 120), k + 80)}… vs …${y.slice(Math.max(0, k - 120), k + 80)}…`)
  }
  check('Level 5 from the sound: all four dice hidden', (await p5.locator('.cd-die__face').allTextContents()).join(' ') === '? ? ? ?')

  // Mix with Pro: every round offers the Bass button, triads included.
  await p5.getByRole('radio', { name: /^Mix levels/ }).click()
  await forceRoll(p5, [0, 0])
  check('Mix with Pro: the Bass button is there on a Level 1 triad', await p5.getByRole('button', { name: 'Mark the bass' }).count() === 1)
  check('no page errors at Level 5', p5.errors.length === 0, p5.errors.join(' | '))
  await l5.ctx.close()
} finally {
  await browser.close()
  server.kill()
}

if (failures.length) {
  console.error(`\n${failures.length} Chord Dice end-to-end check(s) failed.`)
  process.exit(1)
}
console.log('\nChord Dice: from the name, from the sound, keep, reload and reveal all work; nothing leaks while listening.')

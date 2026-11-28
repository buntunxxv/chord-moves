// M0 notation feasibility check -- DISPOSABLE PROTOTYPE, never merged.
//
// Draws a fixture (approved note format, AP 36) as read-only treble-clef
// notation with VexFlow 4.2.2. Contract (AP 60, threshold T7): this module
// takes spelled pitches, ticks and chord symbols exactly as supplied and
// imports no theory library. It decides only how to *write* durations
// (splitting at barlines and beats) and where to place glyphs; it never
// changes a pitch, a spelling or a timing.
import { Accidental, Barline, Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveNote, StaveTie, Voice } from 'vexflow/bravura'

export const TICKS_PER_CROTCHET = 12
export const BAR = 48

// Written values, longest first. Rests use a stricter set (no dotted rests).
const NOTE_VALUES = [[48, 'w'], [36, 'hd'], [24, 'h'], [18, 'qd'], [12, 'q'], [9, '8d'], [6, '8'], [3, '16']]
const REST_VALUES = [[48, 'w'], [24, 'h'], [12, 'q'], [6, '8'], [3, '16']]

const sameBeat = (p, d) => Math.floor(p / 12) === Math.floor((p + d - 1) / 12)

// Common-practice 4/4 writing rules, kept deliberately simple:
// only a note starting on beat 1 may cross the middle of the bar; values
// longer than a crotchet start on a beat; notes starting off the quaver grid
// stay inside their beat.
function noteFits(p, d, end) {
  if (p + d > end) return false
  if (p !== 0 && p < 24 && p + d > 24) return false
  if (d > 12 && p % 12 !== 0) return false
  if (d === 36 && p !== 0) return false
  if (p % 6 !== 0 && !sameBeat(p, d)) return false
  return true
}
function restFits(p, d, end) {
  if (p + d > end) return false
  if (d === 48) return p === 0
  if (d === 24) return p === 0 || p === 24
  if (d === 12) return p % 12 === 0
  return sameBeat(p, d)
}
function writeValues(p, end, values, fits) {
  const out = []
  while (p < end) {
    const v = values.find(([d]) => fits(p, d, end))
    if (!v) throw new Error(`No written value at tick ${p}`)
    out.push({ start: p, ticks: v[0], dur: v[1] })
    p += v[0]
  }
  return out
}

// 'Eb4' -> 'eb/4'; 'D#4' -> 'd#/4'. Parsing only: the spelling is the caller's.
function vexKey(pitch) {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(pitch)
  if (!m) throw new Error(`Bad pitch ${pitch}`)
  return `${m[1].toLowerCase()}${m[2] ?? ''}/${m[3]}`
}
const displaySymbol = s => s.replace(/#/g, '♯').replace(/b(?=\d|$|\/)/g, '♭')

// Splits the melody into written pieces per bar, plus the ties between them.
export function layoutPieces(fixture) {
  const bars = Array.from({ length: fixture.bars }, () => ({ pieces: [], chords: [] }))
  const ties = []
  fixture.notes.forEach((note, noteIndex) => {
    let prev = null
    let t = note.start
    const end = note.start + note.ticks
    while (t < end) {
      const bar = Math.floor(t / BAR)
      const barEnd = Math.min(end, (bar + 1) * BAR)
      for (const w of writeValues(t - bar * BAR, barEnd - bar * BAR, NOTE_VALUES, noteFits)) {
        const piece = { ...w, type: 'note', pitch: note.pitch, noteIndex, bar }
        bars[bar].pieces.push(piece)
        if (prev) ties.push([prev, piece])
        prev = piece
      }
      t = barEnd
    }
  })
  bars.forEach((bar, b) => {
    bar.pieces.sort((x, y) => x.start - y.start)
    const filled = []
    let p = 0
    for (const piece of bar.pieces) {
      if (piece.start > p) filled.push(...writeValues(p, piece.start, REST_VALUES, restFits).map(r => ({ ...r, type: 'rest', bar: b })))
      filled.push(piece)
      p = piece.start + piece.ticks
    }
    if (p < BAR) filled.push(...writeValues(p, BAR, REST_VALUES, restFits).map(r => ({ ...r, type: 'rest', bar: b })))
    bar.pieces = filled
  })
  for (const ch of fixture.chords ?? []) {
    const b = Math.floor(ch.start / BAR)
    bars[b]?.chords.push({ ...ch, tick: ch.start - b * BAR })
  }
  return { bars, ties }
}

let seq = 0
function makeNotes(bar, ink) {
  return bar.pieces.map(piece => {
    const rest = piece.type === 'rest'
    const note = new StaveNote({ keys: [rest ? 'b/4' : vexKey(piece.pitch)], duration: piece.dur + (rest ? 'r' : ''), auto_stem: !rest })
    note.setAttribute('id', `m0-${rest ? 'rest' : 'note'}-${seq++}`)
    if (piece.dur.endsWith('d')) Dot.buildAndAttach([note], { all: true })
    note.setStyle({ fillStyle: ink, strokeStyle: ink })
    piece.vf = note
    return note
  })
}

function prepareVoice(notes, keySignature) {
  const voice = new Voice({ num_beats: 4, beat_value: 4 }).setMode(Voice.Mode.SOFT)
  voice.addTickables(notes)
  Accidental.applyAccidentals([voice], keySignature || 'C')
  // Rests stay in the list so beat positions are counted correctly; they
  // break beams rather than join them (M0 visual review found cross-beat
  // beams when rests were filtered out first).
  const beams = Beam.generateBeams(notes, { groups: [new Fraction(1, 4)], beam_rests: false })
  return { voice, beams }
}

// Width taken by clef, key and time signature at the start of a system.
function modifierWidth({ key, time }) {
  const s = new Stave(0, 0, 400)
  s.addClef('treble')
  if (key) s.addKeySignature(key)
  if (time) s.addTimeSignature('4/4')
  return s.getNoteStartX() - s.getX()
}

const SYSTEM_HEIGHT = 150
const MARGIN = 10
const MIN_BAR = 150 // a readable minimum width for any bar
const CHORD_GAP = 10
const CHORD_FONT = 'bold 13px Poppins, Arial, sans-serif'

let measureCtx = null
function textWidth(text) {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  measureCtx.font = CHORD_FONT
  return measureCtx.measureText(text).width
}

// Renders into `el`. Returns a report used by the measurement script.
// width: CSS pixels available. scale: drawing scale (phones draw at 0.75).
export function renderScore(el, fixture, { width, ink = '#1a1a1a', scale: scaleOverride = null } = {}) {
  el.replaceChildren()
  // Phones draw smaller so two bars fit on a line (T4); legibility is the
  // founder's call from the screenshots.
  // ?scale= overrides this for the legibility sweep only.
  const scale = scaleOverride ?? (width < 480 ? 0.65 : width < 600 ? 0.8 : 1)
  const logicalWidth = width / scale
  const usable = logicalWidth - 2 * MARGIN
  const key = fixture.keySignature
  const { bars, ties } = layoutPieces(fixture)

  // Minimum width of each bar's notes, from a throwaway copy.
  const minWidths = bars.map(bar => {
    const copy = { pieces: bar.pieces.map(p => ({ ...p })) }
    const { voice } = prepareVoice(makeNotes(copy, ink), key)
    const notesWidth = new Formatter().joinVoices([voice]).preCalculateMinTotalWidth([voice]) + 20
    // Room for the chord symbols written above this bar.
    const chordsWidth = bar.chords.reduce((sum, ch) => sum + textWidth(displaySymbol(ch.symbol)) + CHORD_GAP, 0) + 20
    return Math.max(notesWidth, chordsWidth, MIN_BAR)
  })

  // Greedy packing into systems.
  const firstExtra = modifierWidth({ key, time: true })
  const laterExtra = modifierWidth({ key, time: false })
  const systems = []
  let cur = []
  let used = 0
  bars.forEach((bar, i) => {
    const extra = cur.length === 0 ? (systems.length === 0 ? firstExtra : laterExtra) : 0
    const w = minWidths[i] + extra
    if (cur.length && used + w > usable) {
      systems.push(cur)
      cur = []
      used = 0
      const e2 = laterExtra
      cur.push({ i, w: minWidths[i] + e2 })
      used = minWidths[i] + e2
    } else {
      cur.push({ i, w })
      used += w
    }
  })
  if (cur.length) systems.push(cur)

  const swingSpace = fixture.swing ? 22 : 0
  const height = systems.length * SYSTEM_HEIGHT + swingSpace + 20
  const renderer = new Renderer(el, Renderer.Backends.SVG)
  renderer.resize(width, height * scale)
  const ctx = renderer.getContext()
  ctx.scale(scale, scale)
  ctx.setFillStyle(ink)
  ctx.setStrokeStyle(ink)

  const report = { scale, staffSpacePx: 10 * scale, systems: systems.map(s => s.length), barsPerSystem: systems.map(s => s.length), accidentals: { '#': 0, b: 0, n: 0, other: 0 }, chords: 0, swing: false, beams: [] }

  if (fixture.swing) {
    ctx.openGroup('m0swing')
    ctx.setFont('Poppins, Arial, sans-serif', 13, 'bold')
    ctx.fillText('Swing', MARGIN, 16)
    ctx.closeGroup()
    report.swing = true
  }

  let lastChordRight = -Infinity
  systems.forEach((system, si) => {
    const natural = system.reduce((a, b) => a + b.w, 0)
    const isLast = si === systems.length - 1
    const stretch = isLast && natural < usable * 0.7 ? 1 : usable / natural
    const y = swingSpace + si * SYSTEM_HEIGHT + 50
    let x = MARGIN
    system.forEach(({ i, w }, k) => {
      const bar = bars[i]
      const width = w * stretch
      const stave = new Stave(x, y, width)
      if (k === 0) {
        stave.addClef('treble')
        if (key) stave.addKeySignature(key)
        if (si === 0) stave.addTimeSignature('4/4')
      }
      if (i === bars.length - 1) stave.setEndBarType(Barline.type.END)
      stave.setStyle({ fillStyle: ink, strokeStyle: ink })
      stave.setContext(ctx).draw()

      const notes = makeNotes(bar, ink)
      const { voice, beams } = prepareVoice(notes, key)
      new Formatter().joinVoices([voice]).formatToStave([voice], stave)
      voice.draw(ctx, stave)
      beams.forEach(b => { b.setStyle({ fillStyle: ink, strokeStyle: ink }); b.setContext(ctx).draw() })
      // For the beam-by-beat check: the bar ticks of the notes in each beam.
      for (const b of beams) {
        report.beams.push({ bar: i, starts: b.getNotes().map(n => bar.pieces.find(p => p.vf === n)?.start) })
      }

      for (const note of notes) {
        for (const mod of note.getModifiersByType('Accidental')) {
          const t = mod.type
          if (t in report.accidentals) report.accidentals[t] += 1
          else report.accidentals.other += 1
        }
      }

      // Chord symbols above, at their tick; interpolated when the change
      // falls inside a held note.
      const staveTop = stave.getYForLine(0)
      const end = stave.getNoteEndX()
      if (k === 0) lastChordRight = -Infinity
      bar.chords.forEach((chord, ci) => {
        const idx = bar.pieces.findIndex(p => p.start <= chord.tick && chord.tick < p.start + p.ticks)
        const piece = bar.pieces[idx]
        const x0 = piece.vf.getAbsoluteX()
        const x1 = bar.pieces[idx + 1]?.vf.getAbsoluteX() ?? end
        const label = displaySymbol(chord.symbol)
        const cx = Math.max(x0 + ((chord.tick - piece.start) / piece.ticks) * (x1 - x0), lastChordRight + CHORD_GAP)
        lastChordRight = cx + textWidth(label)
        const nextTick = bar.chords[ci + 1]?.tick ?? BAR
        let top = staveTop
        for (const p of bar.pieces) {
          if (p.start + p.ticks <= chord.tick || p.start >= nextTick) continue
          const bb = p.vf.getBoundingBox()
          if (bb) top = Math.min(top, bb.getY())
        }
        ctx.openGroup('m0chord')
        ctx.setFont('Poppins, Arial, sans-serif', 13, 'bold')
        ctx.fillText(label, cx, top - 8)
        ctx.closeGroup()
        report.chords += 1
      })
      x += width
    })
  })

  // Ties last, once every note has a position; a tie across a system break
  // is drawn as two halves with the same tie id.
  const systemOfBar = new Map()
  systems.forEach((s, si) => s.forEach(({ i }) => systemOfBar.set(i, si)))
  ties.forEach(([a, b], k) => {
    const opts = { first_indices: [0], last_indices: [0] }
    const parts = systemOfBar.get(a.bar) === systemOfBar.get(b.bar)
      ? [new StaveTie({ ...opts, first_note: a.vf, last_note: b.vf })]
      : [new StaveTie({ ...opts, first_note: a.vf }), new StaveTie({ ...opts, last_note: b.vf })]
    parts.forEach((tie, h) => {
      tie.setAttribute('id', `m0-tie-${k}-${h}`)
      tie.setContext(ctx).draw()
    })
  })

  return report
}

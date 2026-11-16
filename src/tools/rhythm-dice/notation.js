// Draws one die face in standard notation with VexFlow: notes only, no
// stave, the way the physical dice print them (decided 15 Nov 2026). The
// stave is still created, because VexFlow positions notes against one, but
// it is never drawn. Each die is exactly one beat, so beaming per die is
// beaming per beat.
import { Beam, Dot, Formatter, Fraction, Renderer, Stave, StaveNote, StaveTie, Tuplet, Voice } from 'vexflow/bravura'

const DURATIONS = { 18: 'qd', 12: 'q', 9: '8d', 6: '8', 3: '16' }
const TRIPLET = { 4: '8', 8: 'q' }
const SEXTUPLET = { 2: '16' }

function tupletKind(events) {
  if (events.some(e => e.ticks === 2)) return 'sextuplet'
  if (events.some(e => e.ticks === 4 || e.ticks === 8)) return 'triplet'
  return null
}

export function vexDuration(ticks, kind) {
  const table = kind === 'triplet' ? TRIPLET : kind === 'sextuplet' ? SEXTUPLET : DURATIONS
  const d = table[ticks]
  if (!d) throw new Error(`No notation for ${ticks} ticks${kind ? ` in a ${kind}` : ''}`)
  return d
}

// el: an empty element. Renders an SVG cropped to the glyphs, centred, so
// every face sits at the same place on its die. `tieOut` draws the tie arc
// toward the next die when the tie applies.
export function drawFace(el, face, { beatTicks = 12, tieOut = false, ink = '#1a1a1a' } = {}) {
  el.replaceChildren()
  const W = 220
  const H = 112
  const renderer = new Renderer(el, Renderer.Backends.SVG)
  renderer.resize(W, H)
  const ctx = renderer.getContext()
  ctx.setFillStyle(ink)
  ctx.setStrokeStyle(ink)
  const stave = new Stave(6, 6, W - 12, { left_bar: false, right_bar: false })
  stave.setContext(ctx)

  const kind = tupletKind(face.events)
  const notes = face.events.map(e => {
    const d = vexDuration(e.ticks, kind)
    const note = new StaveNote({ keys: ['b/4'], duration: d + (e.type === 'rest' ? 'r' : ''), stem_direction: 1 })
    if (d.endsWith('d')) Dot.buildAndAttach([note], { all: true })
    note.setStyle({ fillStyle: ink, strokeStyle: ink })
    return note
  })
  const tuplet = kind === 'triplet' ? new Tuplet(notes, { num_notes: 3, notes_occupied: 2, ratioed: false })
    : kind === 'sextuplet' ? new Tuplet(notes, { num_notes: 6, notes_occupied: 4, ratioed: false })
      : null
  const voice = beatTicks === 18 ? new Voice({ num_beats: 3, beat_value: 8 }) : new Voice({ num_beats: 1, beat_value: 4 })
  voice.setMode(Voice.Mode.SOFT)
  voice.addTickables(notes)
  const groups = beatTicks === 18 ? [new Fraction(3, 8)] : [new Fraction(1, 4)]
  const beams = Beam.generateBeams(notes, { groups, beam_rests: false, maintain_stem_directions: true })
  new Formatter().joinVoices([voice]).format([voice], W - 70)
  voice.draw(ctx, stave)
  beams.forEach(b => { b.setStyle({ fillStyle: ink, strokeStyle: ink }); b.setContext(ctx).draw() })
  tuplet?.setContext(ctx).draw()
  if (tieOut) {
    new StaveTie({ first_note: notes.at(-1), last_note: null, first_indices: [0], last_indices: [0] }).setContext(ctx).draw()
  }

  const svg = el.querySelector('svg')
  if (!svg) return
  // Crop to the glyphs. getBBox needs the element in the document; when it
  // is not, fall back to the full drawing area rather than a zero box.
  let bb = { x: 0, y: 0, width: W, height: H }
  try {
    const b = svg.getBBox()
    if (b.width > 0) bb = b
  } catch { /* detached: keep the full area */ }
  const pad = 4
  const side = Math.max(bb.width, bb.height, 44) + pad * 2
  const cx = bb.x + bb.width / 2
  const cy = bb.y + bb.height / 2
  svg.setAttribute('viewBox', `${cx - side / 2} ${cy - side / 2} ${side} ${side}`)
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.style.width = ''
  svg.style.height = ''
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
}

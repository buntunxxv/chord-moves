// MusicXML export: a bar or a phrase as one percussion part, for worksheets
// and notation apps (MuseScore, Sibelius, Dorico, Logic's score view).
//
// Durations are written straight from the tick grid: <divisions> is 12 per
// crotchet, the same as our 12 ticks per crotchet, so no rounding happens.
// Notes sit on the middle line of a one-line percussion stave, the way the
// dice print them. Each die is one beat, so beams run within a die and never
// across one. Ties are drawn the way the app resolves them.
import { TICKS_PER_CROTCHET } from './faces.js'
import { barTicks, midiTempo, resolveTies } from './rhythm.js'

const PLAIN = { 18: ['quarter', 1], 12: ['quarter', 0], 9: ['eighth', 1], 6: ['eighth', 0], 3: ['16th', 0] }
const TRIPLET = { 4: 'eighth', 8: 'quarter' }
const SEXTUPLET = { 2: '16th' }

function tupletOf(face) {
  if (face.events.some(e => e.ticks === 2)) return { actual: 6, normal: 4, types: SEXTUPLET }
  if (face.events.some(e => e.ticks === 4 || e.ticks === 8)) return { actual: 3, normal: 2, types: TRIPLET }
  return null
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Beam state for each note in a die: begin / continue / end, or none.
// Rests break a beam; crotchets and longer are never beamed.
function beamStates(face) {
  const beamable = face.events.map(e => e.type === 'note' && e.ticks < 12 && !(e.ticks === 8))
  const states = face.events.map(() => null)
  let run = []
  const flush = () => {
    if (run.length >= 2) run.forEach((idx, k) => { states[idx] = k === 0 ? 'begin' : k === run.length - 1 ? 'end' : 'continue' })
    run = []
  }
  face.events.forEach((e, i) => { if (beamable[i]) run.push(i); else flush() })
  flush()
  return states
}

function noteXml(e, { type, dots, tuplet, tupletPos, tieStart, tieStop, beam }) {
  const lines = ['<note>']
  if (e.type === 'rest') lines.push('<rest/>')
  else lines.push('<unpitched><display-step>B</display-step><display-octave>4</display-octave></unpitched>')
  lines.push(`<duration>${e.ticks}</duration>`)
  if (tieStop) lines.push('<tie type="stop"/>')
  if (tieStart) lines.push('<tie type="start"/>')
  lines.push('<voice>1</voice>')
  lines.push(`<type>${type}</type>`)
  for (let d = 0; d < dots; d++) lines.push('<dot/>')
  if (tuplet) lines.push(`<time-modification><actual-notes>${tuplet.actual}</actual-notes><normal-notes>${tuplet.normal}</normal-notes></time-modification>`)
  if (e.type === 'note') lines.push('<stem>up</stem>')
  if (beam) lines.push(`<beam number="1">${beam}</beam>`)
  const notations = []
  if (tieStop) notations.push('<tied type="stop"/>')
  if (tieStart) notations.push('<tied type="start"/>')
  if (tupletPos === 'start') notations.push('<tuplet type="start" bracket="yes"/>')
  if (tupletPos === 'stop') notations.push('<tuplet type="stop"/>')
  if (notations.length) lines.push(`<notations>${notations.join('')}</notations>`)
  lines.push('</note>')
  return lines.join('')
}

function measureXml(faces, metre, number, { first, bpm }) {
  const ties = resolveTies(faces)
  const parts = [`<measure number="${number}">`]
  if (first) {
    const [beats, beatType] = metre.timeSignature
    parts.push(
      `<attributes><divisions>${TICKS_PER_CROTCHET}</divisions><key><fifths>0</fifths></key>`
      + `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`
      + '<clef><sign>percussion</sign></clef><staff-details><staff-lines>1</staff-lines></staff-details></attributes>',
    )
    // The printed mark counts the beat the player counts (crotchet, dotted
    // crotchet or quaver); playback tempo is always in crotchets.
    const tempo = Math.round(midiTempo(metre, bpm) * 100) / 100
    const unit = metre.unitTicks === 18 ? '<beat-unit>quarter</beat-unit><beat-unit-dot/>'
      : metre.unitTicks === 6 ? '<beat-unit>eighth</beat-unit>' : '<beat-unit>quarter</beat-unit>'
    parts.push(`<direction placement="above"><direction-type><metronome>${unit}<per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>`)
    if (metre.grouping) {
      parts.push(`<direction placement="above"><direction-type><words>${esc(metre.grouping)}</words></direction-type></direction>`)
    }
  }
  faces.forEach((face, die) => {
    const tuplet = tupletOf(face)
    const beams = beamStates(face)
    face.events.forEach((e, i) => {
      const last = i === face.events.length - 1
      const [type, dots] = tuplet ? [tuplet.types[e.ticks], 0] : PLAIN[e.ticks]
      if (!type) throw new Error(`No MusicXML note type for ${e.ticks} ticks in ${face.id}`)
      parts.push(noteXml(e, {
        type,
        dots,
        tuplet,
        tupletPos: tuplet ? (i === 0 ? 'start' : last ? 'stop' : null) : null,
        tieStart: last && ties[die] === true,
        tieStop: i === 0 && die > 0 && ties[die - 1] === true,
        beam: beams[i],
      }))
    })
  })
  parts.push('</measure>')
  return parts.join('')
}

// `bars`: one or more bars (each a list of faces), all in `metre`.
export function buildMusicXml({ bars, metre, bpm, title = 'Rhythm Dice' }) {
  for (const faces of bars) {
    const total = faces.reduce((s, f) => s + f.events.reduce((a, e) => a + e.ticks, 0), 0)
    if (total !== barTicks(metre) || faces.length !== metre.dice) throw new Error(`A bar does not fit ${metre.id}`)
    faces.forEach((f, i) => {
      const t = f.events.reduce((a, e) => a + e.ticks, 0)
      if (t !== metre.dieTicks[i]) throw new Error(`${f.id} does not fit die ${i + 1} of ${metre.id}`)
    })
  }
  const measures = bars.map((faces, i) => measureXml(faces, metre, i + 1, { first: i === 0, bpm })).join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
    + '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
    + '<score-partwise version="4.0">'
    + `<work><work-title>${esc(title)}</work-title></work>`
    + '<identification><encoding><software>Kynda Rhythm Dice</software></encoding></identification>'
    + '<part-list><score-part id="P1"><part-name>Rhythm</part-name><score-instrument id="P1-I1"><instrument-name>Hand Clap</instrument-name></score-instrument>'
    + '<midi-instrument id="P1-I1"><midi-channel>10</midi-channel><midi-unpitched>40</midi-unpitched></midi-instrument></score-part></part-list>'
    + `<part id="P1">${measures}</part>`
    + '</score-partwise>\n'
}

export function musicXmlFilename(bars, metre) {
  const sig = metre.timeSignature.join('-')
  return bars.length > 1 ? `rhythm-dice-phrase-${sig}-${bars.length}-bars.musicxml` : `rhythm-dice-${sig}-${bars[0].map(f => f.id).join('_')}.musicxml`
}

export function downloadMusicXml(xml, filename) {
  const blob = new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

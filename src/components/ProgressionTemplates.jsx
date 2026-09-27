import { useMemo } from 'react'
import { PROGRESSION_TEMPLATES } from '../progressionTemplates'
import { resolveTemplate } from '../utils/resolveTemplate'
import { useCardDeck } from '../hooks/useCardDeck'
import DeckNav from './DeckNav'
import { ROOTS, ROOT_DISPLAY } from './ChordSelector'
import Dropdown from './Dropdown'
import './ProgressionTemplates.css'
import { formatChordName } from '../utils/formatChordName'

export default function ProgressionTemplates({ keyRoot, keyMode, onKeyRootChange, onKeyModeChange, onLoad }) {
  // Only the templates written in the selected key's mode. That is what makes
  // a position counter meaningful: every card in the deck can actually be
  // loaded, so "2 of 4" counts real choices. The old list rendered all seven
  // at every setting and left the three off-mode ones permanently disabled
  // as "Needs a minor key" -- three cards of a seven-card scroll that existed
  // only to be skipped.
  const templates = useMemo(() => PROGRESSION_TEMPLATES.filter(t => t.mode === keyMode), [keyMode])

  const { index, isDeck, trackRef, cardRefs, chipRefs, goTo, handleChipKeyDown } = useCardDeck(templates)

  function handleLoad(template, entries) {
    if (entries) onLoad(entries, template)
  }

  return (
    <div className="progression-templates" id="wt-progression-templates">
      {/* No heading here: the workspace h1 names whichever slide you are on.
          The hint stays -- that title does not tell you the key comes first. */}
      <p className="progression-templates__hint">Pick a key, then load a named progression built from it</p>

      <div className="progression-templates__key">
        <div className="progression-templates__key-field">
          <label className="progression-templates__label">Key</label>
          {/* title, not label: this Dropdown already has a visible <label>
              beside it, and `label` would repeat that inside the trigger.
              title only names the sheet. */}
          <Dropdown
            value={keyRoot}
            onChange={onKeyRootChange}
            title="Key"
            options={ROOTS.map((r, i) => ({ value: r, label: ROOT_DISPLAY[i] }))}
          />
        </div>
        <div className="progression-templates__mode-toggle" role="group" aria-label="Key mode">
          <button
            type="button"
            className={`progression-templates__mode-btn ${keyMode === 'major' ? 'progression-templates__mode-btn--active' : ''}`}
            onClick={() => onKeyModeChange('major')}
          >
            Major
          </button>
          <button
            type="button"
            className={`progression-templates__mode-btn ${keyMode === 'minor' ? 'progression-templates__mode-btn--active' : ''}`}
            onClick={() => onKeyModeChange('minor')}
          >
            Minor
          </button>
        </div>
      </div>

      {/* Mood was a filter before, but every template has a distinct one, so
          picking one could only ever narrow seven cards to one. As the deck's
          chip labels the same words name each card and double as the position
          indicator the deck would otherwise need dots for. */}
      <DeckNav
        count={templates.length}
        index={index}
        name={templates[index]?.name}
        chipLabels={templates.map(template => template.mood)}
        noun="template"
        onGoTo={goTo}
        onChipKeyDown={handleChipKeyDown}
        chipRefs={chipRefs}
      />

      <div className="progression-templates__deck deck-track" ref={trackRef}>
        {templates.map((template, i) => {
          const resolved = resolveTemplate(template, keyRoot, keyMode)
          return (
            <article
              key={template.name}
              ref={el => { cardRefs.current[i] = el }}
              className="progression-templates__card"
              aria-label={isDeck ? `${template.name}, ${i + 1} of ${templates.length}` : undefined}
            >
              <div className="progression-templates__card-header">
                <span className="progression-templates__card-name">{template.name}</span>
                <span className="progression-templates__mood-badge">{template.mood}</span>
              </div>
              {/* resolveTemplate still returns null on a key whose diatonic
                  table is missing a degree. Mode-matching makes that
                  unreachable for the seven templates shipped today -- all 119
                  template/key pairs resolve -- but the fallback costs nothing
                  and keeps a new template from rendering a blank card. */}
              {resolved ? (
                <div className="progression-templates__degrees">
                  {resolved.map((entry, j) => (
                    <span key={j} className="progression-templates__resolved-chord">
                      <span className="progression-templates__resolved-chord-name">{formatChordName(entry.chord)}</span>
                      <span className="progression-templates__degree-pill">{entry.degree}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="progression-templates__degrees progression-templates__degrees--plain">{template.degrees.join(' – ')}</span>
              )}
              <p className="progression-templates__description">{template.description}</p>
              <button
                type="button"
                className="progression-templates__load-btn"
                onClick={() => handleLoad(template, resolved)}
                disabled={!resolved}
              >
                Load
              </button>
            </article>
          )
        })}
      </div>
    </div>
  )
}

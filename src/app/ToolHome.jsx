import { Link } from 'react-router-dom'
import ToolShell from './ToolShell'
import { TOOLS } from './tools'
import './ToolHome.css'

export default function ToolHome() {
  return (
    <ToolShell title="Small tools for making more sense of music" eyebrow="Kynda Learning">
      <p className="tool-home__lede">
        Practical, browser-based helpers for writing, practising and learning. Start anywhere—no setup required.
      </p>

      <div className="tool-home__grid">
        {TOOLS.map(tool => {
          const content = (
            <>
              <span className="tool-home__icon" aria-hidden="true">{tool.icon}</span>
              <div>
                <h2>{tool.name}</h2>
                <p>{tool.description}</p>
              </div>
              <span className={`tool-home__label ${tool.path ? '' : 'tool-home__label--muted'}`}>
                Open tool{tool.path && ' →'}
              </span>
            </>
          )

          return tool.path ? (
            <Link key={tool.name} to={tool.path} className="tool-home__card">
              {content}
            </Link>
          ) : (
            <article key={tool.name} className="tool-home__card tool-home__card--planned">
              {content}
            </article>
          )
        })}
      </div>
    </ToolShell>
  )
}

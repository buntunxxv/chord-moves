import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ThemeToggle from '../components/ThemeToggle'
import SuiteMenuLinks from './SuiteMenuLinks'
import { useTheme } from '../hooks/useTheme'
import { useDismissOnOutsidePress } from '../hooks/useDismiss'
import './ToolShell.css'

export default function ToolShell({ title, eyebrow, learningAction, children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const hamburgerRef = useRef(null)
  useDismissOnOutsidePress(menuOpen, () => setMenuOpen(false), [menuRef, hamburgerRef])
  const { preference, resolvedTheme, setPreference } = useTheme()

  return (
    <div className="tool-shell">
      <header className="tool-shell__header">
        <div className="tool-shell__header-inner">
          <Link to="/tools" className="tool-shell__brand" aria-label="Kynda Tools home">
            <img
              src={resolvedTheme === 'dark' ? '/kynda-logo-white.png' : '/kynda-logo-full.png'}
              alt="Kynda Learning"
            />
            <span className="tool-shell__brand-divider" aria-hidden="true" />
            <span className="tool-shell__brand-name">Tools</span>
          </Link>
          <div className="tool-shell__header-actions">
            {learningAction && (
              <button
                type="button"
                className="tool-shell__learning-link"
                onClick={learningAction.onClick}
                aria-label={learningAction.ariaLabel ?? learningAction.label}
              >
                <span className="tool-shell__learning-label--desktop">{learningAction.label}</span>
                <span className="tool-shell__learning-label--mobile" aria-hidden="true">
                  {learningAction.mobileLabel ?? learningAction.label}
                </span>
              </button>
            )}
            <ThemeToggle preference={preference} onChange={setPreference} />
            <button
              ref={hamburgerRef}
              type="button"
              className="tool-shell__hamburger"
              onClick={() => setMenuOpen(open => !open)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="tool-shell-menu"
            >
              <span className="tool-shell__hamburger-line" />
              <span className="tool-shell__hamburger-line" />
              <span className="tool-shell__hamburger-line" />
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="tool-shell-menu" ref={menuRef} className="tool-shell__mobile-menu" aria-label="Tool menu">
            <SuiteMenuLinks
              className="tool-shell__mobile-menu-link"
              currentClassName="tool-shell__mobile-menu-link--current"
              childClassName="tool-shell__mobile-menu-link--child"
              onNavigate={() => setMenuOpen(false)}
            />
            <div className="tool-shell__mobile-menu-theme">
              <span>Appearance</span>
              <ThemeToggle preference={preference} onChange={setPreference} />
            </div>
          </nav>
        )}
      </header>

      <main className="tool-shell__main">
        {title && (
          <div className="tool-shell__intro">
            {eyebrow && <p className="tool-shell__eyebrow">{eyebrow}</p>}
            <h1>{title}</h1>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}

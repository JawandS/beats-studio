import { useEffect, useState } from 'react';
import './App.css';
import { StepGrid } from './components/StepGrid';
import { TransportBar } from './components/TransportBar';
import { SongAnalysis } from './components/SongAnalysis';
import { Remix } from './components/Remix';

type Page = 'sequencer' | 'analysis' | 'remix';
const PAGE_KEY = 'beatstudio_active_page_v1';

function App() {
  const [page, setPage] = useState<Page>('sequencer');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(PAGE_KEY);
    if (saved === 'analysis' || saved === 'sequencer' || saved === 'remix') {
      setPage(saved as Page);
    }
  }, []);

  const navigate = (next: Page) => {
    setPage(next);
    try {
      localStorage.setItem(PAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="app-shell">
      <div className="top-bar">
        <nav className={`nav-links ${menuOpen ? 'open' : ''}`}>
          <button
            type="button"
            className={`nav-link ${page === 'sequencer' ? 'active' : ''}`}
            onClick={() => navigate('sequencer')}
          >
            Sequencer
          </button>
          <button
            type="button"
            className={`nav-link ${page === 'analysis' ? 'active' : ''}`}
            onClick={() => navigate('analysis')}
          >
            Analysis
          </button>
          <button
            type="button"
            className={`nav-link ${page === 'remix' ? 'active' : ''}`}
            onClick={() => navigate('remix')}
          >
            Remix
          </button>
        </nav>

        <button
          type="button"
          className={`hamburger ${menuOpen ? 'is-open' : ''}`}
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {page === 'sequencer' && (
        <header className="hero">
          <div className="hero-left">
            <div className="hero-actions">
              <TransportBar />
            </div>
          </div>
        </header>
      )}

      <main>
        {page === 'sequencer' && <StepGrid />}
        {page === 'analysis' && <SongAnalysis />}
        {page === 'remix' && <Remix />}
      </main>
    </div>
  );
}

export default App;

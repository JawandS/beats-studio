import { useState } from 'react';
import './App.css';
import { StepGrid } from './components/StepGrid';
import { TransportBar } from './components/TransportBar';
import { SongAnalysis } from './components/SongAnalysis';

type Page = 'sequencer' | 'analysis';

function App() {
  const [page, setPage] = useState<Page>('sequencer');
  const [menuOpen, setMenuOpen] = useState(false);

  const navigate = (next: Page) => {
    setPage(next);
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

      <header className="hero">
        <div className="hero-left">
           <div className="hero-actions">
            <TransportBar />
          </div>
        </div>
      </header>

      <main>
        {page === 'sequencer' ? <StepGrid /> : <SongAnalysis />}
      </main>
    </div>
  );
}

export default App;

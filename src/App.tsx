import './App.css';
import { StepGrid } from './components/StepGrid';
import { TransportBar } from './components/TransportBar';

function App() {
  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-left">
          <p className="eyebrow">Beat lab · MVP</p>
          <h1>Personal beat studio</h1>
          <div className="hero-actions">
            <TransportBar />
            <p className="hint">Best in Chrome/Edge with sound on. Tempo range 60–180 BPM.</p>
          </div>
        </div>
      </header>

      <main>
        <StepGrid />
        <section className="callout">
          <div className="pill secondary subtle">AudioWorklet ready for future metering/scheduling.</div>
        </section>
      </main>
    </div>
  );
}

export default App;

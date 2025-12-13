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
          <p className="lede">
            16-step drum sequencer backed by a click-free WebAudio engine and lookahead scheduler.
          </p>
          <div className="hero-actions">
            <TransportBar />
            <p className="hint">Best in Chrome/Edge with sound on. Tempo range 60–180 BPM.</p>
          </div>
        </div>

        <div className="hero-card">
          <div className="card-title">Included in v1.0</div>
          <ul>
            <li>Kick / snare / hat voices synthesized with AudioContext</li>
            <li>Lookahead scheduler (150–200ms) for steady playback</li>
            <li>Konva canvas grid with per-track mute + step toggles</li>
          </ul>
        </div>
      </header>

      <main>
        <StepGrid />
        <section className="callout">
          <div>
            <div className="callout-title">Quick tips</div>
            <p>Hit play once to unlock audio, then click pads to sketch a beat. Drag a BPM number to scrub.</p>
          </div>
          <div className="pill secondary subtle">AudioWorklet ready for future metering/scheduling.</div>
        </section>
      </main>
    </div>
  );
}

export default App;

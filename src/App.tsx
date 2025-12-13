import './App.css';
import { StepGrid } from './components/StepGrid';
import { TransportBar } from './components/TransportBar';

function App() {
  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-left">
          <div className="hero-actions">
            <TransportBar />
          </div>
        </div>
      </header>

      <main>
        <StepGrid />
      </main>
    </div>
  );
}

export default App;

import './SongAnalysis.css';

export function SongAnalysis() {
  return (
    <section className="analysis">
      <div className="analysis-header">
        <div>
          <p className="eyebrow">Song intelligence</p>
          <h2>Analyze a track</h2>
          <p className="lede">
            Drop an audio file or paste a link to prep future AI-assisted arrangement, BPM detection, and
            tone balance checks.
          </p>
        </div>
      </div>

      <div className="analysis-card">
        <div className="analysis-upload">
          <div className="upload-box">
            <input type="file" accept="audio/*" id="audio-upload" />
            <label htmlFor="audio-upload">
              <strong>Choose audio</strong> or drop a file here
            </label>
            <p className="hint">Supported: wav, mp3, aac, flac</p>
          </div>
          <div className="or-divider">
            <span />
            <span>or</span>
            <span />
          </div>
          <div className="link-box">
            <label htmlFor="analysis-link">Track link</label>
            <input id="analysis-link" type="url" placeholder="https://…" />
            <button type="button">Analyze</button>
          </div>
        </div>

        <div className="analysis-notes">
          <h3>What you’ll get</h3>
          <ul>
            <li>BPM + key detection (planned)</li>
            <li>Energy map per section (planned)</li>
            <li>Suggested drum grid seed</li>
            <li>Frequency balance hints</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

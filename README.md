# Beat Studio MVP

Lightweight beat sketcher built with Vite, React, TypeScript, Zustand, and Konva. The audio engine uses the Web Audio API with a lookahead scheduler for steady playback and synthesized drum voices (no sample files).

## Quick start

```bash
npm install
npm run dev
```

Then open the printed localhost URL and click **Play** once to unlock audio.

## Features

- 16-step sequencer (kick, snare, hat) rendered with react-konva
- Lookahead scheduler (~150–200ms) to avoid timing drift and clicks
- Web Audio drum synthesis (sine kick, noise snare/hat) with basic envelopes
- Global transport (play/stop), BPM control (60–180), per-track mute, and live step toggling

## Notes

- Works best in modern Chromium-based browsers with audio output enabled.
- The code is structured to drop in AudioWorklet-based metering/scheduling later.

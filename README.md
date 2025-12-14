# Beat Studio MVP

Lightweight beat sketcher built with Vite, React, TypeScript, Zustand, and Konva. The audio engine uses the Web Audio API with a lookahead scheduler for steady playback and synthesized drum voices (no sample files).

## Quick start

```bash
npm install
npm run dev
```

Then open the printed localhost URL and click **Play** once to unlock audio.

## Backend (FastAPI + Demucs)

- Install Python deps (from `server/pyproject.toml`): `cd server && uv sync` (or `pip install .`)
- Start the API (proxied at `/api` in dev): `npm run backend` (runs uvicorn on port 8000)
- The Song Analysis page posts audio to `/api/separate`, runs Demucs (`htdemucs` by default), zips stems, and returns them for playback/mixing in the UI.

For non-dev/preview builds, set `VITE_API_URL` to your backend base (e.g., `http://localhost:8000/api`) so the frontend hits the right server.

If you see `TorchCodec is required` from Demucs, ensure the backend venv has the heavy deps installed: `uv sync` (includes torch/torchaudio/torchcodec) or `pip install torch torchaudio torchcodec`.

## Features

- 16-step sequencer (kick, snare, hat) rendered with react-konva
- Lookahead scheduler (~150–200ms) to avoid timing drift and clicks
- Web Audio drum synthesis (sine kick, noise snare/hat) with basic envelopes
- Global transport (play/stop), BPM control (60–180), per-track mute, and live step toggling

## Notes

- Works best in modern Chromium-based browsers with audio output enabled.
- The code is structured to drop in AudioWorklet-based metering/scheduling later.

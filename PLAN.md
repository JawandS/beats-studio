## MVP Plan

1. Scaffold the app with Vite + React + TypeScript; set up basic project metadata and scripts for dev/build.
2. Add core dependencies: Zustand for state, Konva/react-konva for canvas UI, and lightweight helpers (classnames/types) as needed.
3. Implement audio foundation: create a reusable `AudioEngine` with `AudioContext`, basic drum voices (synth kick/snare/hat), gain staging, and a lookahead scheduler that schedules ~150–200ms ahead.
4. Wire global state: a Zustand store for transport (play/stop, tempo), step patterns per track, and engine lifecycle hooks (start/stop context, schedule callbacks).
5. Build UI: transport bar (play/stop, tempo), Konva-based step sequencer grid with per-track labels, step toggles, and playhead highlighting; include a minimal layout/theme.
6. QA pass: ensure scheduling is click-free, default pattern plays on load, and document usage/run steps.

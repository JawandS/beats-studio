# Remix Tab Plan

Simple, high-impact tools to make separated stems feel like a remix without needing production experience.

## Goals
- Make stems feel balanced, clear, and loud with minimal controls.
- Offer one-click polish options for vocals, drums, and bass.
- Add musical space and transitions that are hard to mess up.
- Keep everything stem-aware (drums/bass/vocals/other) and loop-friendly.

## UX principles
- Defaults sound good; sliders are small moves (not wide expert ranges).
- Macro-style buttons apply multiple tweaks at once and can be toggled off.
- Presets save per stem set; clear labels like “Vocal up” vs. technical terms.
- Live-safe: limiter on the master to prevent clipping; meters show green/amber/red only.

## Current Remix tab snapshot (code)
- `src/components/Remix.tsx`: stem decode/playback with per-stem gain + pitch + pan + width + reverb send; tempo slider; per-entry state persisted in `REMIX_STATE_KEY` (`tempo`, `controls`, `entryId`, `perEntryControls`).
- Master chain: `masterGain` → stutter gate → master HP/LP filters → soft limiter (DynamicsCompressor) → analyser → destination; impulse-based reverb bus summed into master pre-limiter. Limiter toggle + output meter added in UI.
- Sources: one `AudioBufferSourceNode` per stem, looped; playback rate = pitch-to-rate * tempo; per-stem nodes = filters → gain → StereoPanner → width stage (mid/side) → master + optional reverb send.
- Macro filters: per-stem filter stages with macro toggles (Vocal clean, Drum punch, Bass tight) driving high-pass/tone/low-pass settings. Build sweep, tape stop/start, and stutter (1/4, 1/8) automation hooked to master filters/playback rate/stutter gate.
- Mixdown: offline render to WAV via `Mixdown to WAV` button (includes macros, pan/width, reverb).
- Persistence: localStorage + per-entry map; defaults in `DEFAULT_CONTROLS`; sample manifests fetched from `/sample-stems/manifest.json`.
- SongAnalysis page already writes stems to IndexedDB via `stemStorage`; Remix page pulls from it (sample/saved dropdowns).

## Feature set (priority order)
1) **Balance & safety**
   - Master auto-gain + soft limiter to prevent clipping when boosting stems.
   - Per-stem pan and stereo width (L/R placement, width trim to reduce mud).
   - Simple loudness meter (post-limiter) with a target line for “good enough”.
2) **Quick polish macros**
   - Vocal up/clean: high-pass ~90 Hz, gentle presence boost, light compressor.
   - Drum punch: transient boost on drums, tiny saturation, optional low-cut on reverb send.
   - Bass tighten: low-pass shimmer removal, subtle saturation, mono-below-120 Hz toggle.
   - “Bandpass hook”: temporary mid focus for choruses (macro users can trigger per loop).
3) **Space & vibe**
   - Global reverb send with 3 scenes: Small room (tight), Plate (vocals), Hall (washy). One knob for send amount per stem.
   - Slapback delay macro for vocals/other (fixed ~90–120 ms, low feedback, tone-damped).
   - Stereo widener for “other” stem with width guardrails to avoid mono loss.
4) **Movement & transitions**
   - Low-pass/high-pass sweep macro (one XY pad or “Build” button) that ramps on the master, auto-resets at loop end.
   - Tape stop/starts on master with fixed curve and safety fade.
   - Stutter/retrigger on drums (1/4 or 1/8 rate) for fills, with “undo” in one click.
5) **Workflow helpers**
   - A/B compare: duplicate current settings to B, quick toggle, “copy B to A”.
   - Per-song presets (stored with the stem zip entry) and 3 global defaults (“Clean”, “Club”, “Spacey”).
   - Bounce stem mix: render current mixdown of stems to WAV for export/share.

## Implementation notes (Web Audio)
- Master chain: stem mixes → master gain → soft clipper/limiter (WaveShaper + DynamicsCompressor) → analyser for meters.
- Per-stem nodes: Gain → StereoPanner → StereoWidth (mid/side matrix) → optional FX sends.
- Macros: bundle parameter sets and apply them with small ranges; show an active chip per stem.
- Sends: Reverb (Convolver + pre-delay + tone filter), Delay (FeedbackDelayNetwork not needed; simple StereoDelay).
- Automation: use `setTargetAtTime`/`linearRampToValueAtTime` for sweeps; guard against resumed contexts.
- Persistence: extend `REMIX_STATE_KEY` to store new controls per entry; keep backward compatibility by defaulting missing values.

## Implementation plan (grounded in current code)
- Foundation (audio graph + state)
  - Add master limiter chain in `ensureContext` (Remix): `masterGain` → `DynamicsCompressor` soft clipper → analyser → destination. Expose analyser ref for meters.
  - Extend per-stem chain to `Gain → StereoPanner → width node (mid/side matrix) → masterGain`; keep gain/pitch logic intact.
  - Add FX send bus nodes (reverb, delay) created once per context; stems feed them via per-stem send gains; reverb return hits master pre-limiter.
  - Update state shape: add pan, width, reverbSend, macro flags, AB slots; migrate `REMIX_STATE_KEY` reads to default missing fields so old saves load.
- UI/controls (match existing card layout)
  - Per-stem row: add pan slider (-1..1), width slider (0..1.5), reverb send knob (0..1), macro chips (Vocal clean, Drum punch, Bass tighten).
  - Master row: limiter toggle (default on), output meter (green/amber/red), target loudness hint line; master mixdown button placeholder.
  - Movement macros: buttons for Build (LP/HP sweep with auto reset), Tape stop, Stutter (1/4, 1/8) with clear button.
  - A/B compare: two in-memory slots; buttons to copy/swap; persist per entry along with current selection.
- Behavior wiring
  - On loadEntry: hydrate new controls per entry (with defaults) and attach to localStorage map; keep tempo/pitch behaviors untouched.
  - On play: connect stems through new chain and sends; ensure tempo/pitch still update playbackRate; reset automation envelopes when stopping.
  - Macros: define parameter bundles; toggle sets gain/pan/filters/compression to predetermined safe ranges; display “active” chip.
  - Meter: poll analyser in `requestAnimationFrame` (reuse existing progress timer pattern) and render simple bar + text.
- Export
  - Add mixdown: render offline (OfflineAudioContext) using current settings, then `toWav` and prompt download; guard with try/catch and loading state.

## MVP slice to ship first (incremental)
- Master limiter + loudness meter.
- Per-stem pan/width + reverb send (plate impulse).
- Vocal clean macro + Drum punch macro (toggle buttons per stem).
- A/B compare state save (local only, per entry).

## Step-by-step TODOs
- [x] Audio graph foundation (`src/components/Remix.tsx`)
  - [x] Add master chain: gain → soft clipper/compressor → analyser → destination inside `ensureContext`.
  - [x] Create shared send nodes (reverb now; delay pending) and per-stem send gains; route returns to master pre-limiter.
  - [x] Extend per-stem chain to include `StereoPanner` + width node (mid/side matrix helper).
- [x] State model updates
  - [x] Extend `StemControl` to include `pan`, `width`, `reverbSend`, macro flags; add defaults.
  - [x] Update `perEntryControls`/`REMIX_STATE_KEY` hydration to backfill missing fields for old saves.
- [ ] UI controls
  - [x] Per-stem UI: pan slider, width slider, reverb send knob.
  - [x] Macro toggles (Vocal clean, Drum punch, Bass tighten).
  - [x] Master UI: limiter on/off (default on), loudness meter display.
  - [x] Master UI: build/tape/stutter buttons, mixdown button.
- [ ] Behavior wiring
  - [x] Apply pan/width/reverb sends when starting playback; live updates propagate to active nodes.
  - [x] Macro handlers that set safe parameter bundles and mark active chips; reset on toggle off.
  - [x] Meter loop using analyser + `requestAnimationFrame`; tie into existing progress loop lifecycle.
  - [x] Automation helpers for build/tape/stutter with auto-reset on stop.
- [x] Mixdown/export
  - [x] Implement offline render with current settings; convert to WAV; surface download + error state.
- [ ] Persistence/QA
  - [ ] Confirm localStorage migrations work (old saves load with defaults).
  - [ ] Sanity test sample and saved stem flows; verify limiter prevents clipping when boosting stems.

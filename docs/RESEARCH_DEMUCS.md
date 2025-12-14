## Demucs Overview

Demucs (Décomposition en U-Net de Mélanges et de Sources) is a deep-learning source separation model originally from Meta AI (now maintained by Alexandre Défossez). It separates stems (vocals, drums, bass, other; optionally guitar/piano) and is up to v4, which adds a Hybrid Transformer U-Net working across waveform and spectrogram domains.

### Architecture
- **Input**: Raw waveform chunks (44.1 kHz stereo, ~6s segments).
- **Encoder/Decoder (U-Net)**: Strided 2D convolutions downsample time and increase channels; transposed convolutions decode with skip connections.
- **Bottleneck**:
  - **v1–v2**: Bidirectional LSTM stack over flattened temporal dim.
  - **v3 Hybrid Demucs**: Dual branches (waveform + STFT) merged mid-network.
  - **v4 Hybrid Transformer Demucs (HT Demucs)**: Cross-domain Transformer encoder between encoders/decoders; self-attention within each branch + cross-attention across branches. Sparse attention variant extends receptive field (paper, not released).
- **Outputs**: Per-stem waveforms; “other” stem often residual to close the mix.
- **Loss**: L1/L2 on waveform plus multires STFT losses to stabilize high-frequency detail (in hybrid variants).

### Training Regimen
- **Data**: MUSDB18/HQ base dataset; v4 trained on MUSDB HQ + ~800 extra songs. Some releases fine-tune per-source.
- **Augmentations**: Random gains per stem, channel shuffling, time shifts, remixing mixtures on the fly; sometimes pitch or EQ perturbations.
- **Chunking**: Train/infer on fixed-length windows; overlap-add during full-song inference to reduce edge artifacts.
- **Ensembling**: Use multiple checkpoints, flip stereo channels, and average predictions to improve SI-SDR.

### Variants & Evolutions
- **Demucs v1–v2**: Waveform U-Net + BiLSTM bottleneck.
- **Hybrid Demucs (v3)**: Waveform + spectrogram branches merged mid-network; Sony MDX winner.
- **Hybrid Transformer Demucs (v4)**: Cross-domain Transformer between branches; models `htdemucs` (base), `htdemucs_ft` (fine-tuned), `hdemucs_mmi` (retrained baseline). Experimental 6-stem model adds `guitar`/`piano` (piano quality noted as weak).
- **Conditioning/Extensions**: Sparse attention version in paper (not released); community forks add prompts or post-filters.

### Performance Notes
- HT Demucs reports ~9.0 dB SDR on MUSDB HQ (9.2 dB with sparse attention + per-source fine-tuning in paper).
- Waveform path preserves transients/phase; hybrid branch improves highs.
- Heavy compute: multi-GPU training; inference improved with overlap-add but increases latency. Quantized `mdx_q` exists for lighter use.

### Practical Usage
- **Install**: `pip install -U demucs` (PyPI); `pip install -U git+https://github.com/facebookresearch/demucs#egg=demucs` for bleeding-edge.
- **CLI**: `demucs yourfile.mp3`; select models via `-n htdemucs` / `-n htdemucs_ft` / `-n hdemucs_mmi` / `-n mdx_q`. Two-stem mode: `--two-stems=vocals` (or drums/bass). MP3 export: `--mp3 --mp3-bitrate`.
- **Env**: Python 3.8+, CUDA env via `environment-cuda.yml`; CPU env via `environment-cpu.yml`. Requires `soundstretch/soundtouch` for tempo/pitch augmentation.
- **Inference tips**:
  - Use overlap-add (~50%) to reduce boundary artifacts.
  - Normalize loudness consistently across chunks.
  - Disable ensembling or pick `mdx_q` for speed/low-resource runs; expect quality drop.
- **Deployment**: PyTorch official; Docker and Colab demos exist. ONNX/JS ports run but may lose quality; on-device often needs pruning/quantization.

### References
- Demucs repo: https://github.com/adefossez/demucs (official)
- Hybrid Transformer Demucs paper: https://ai.honu.io/papers/htdemucs/index.html
- Original Demucs paper: “Demucs: Deep Extractor for Music Sources in the Waveform Domain” (Défossez et al.)

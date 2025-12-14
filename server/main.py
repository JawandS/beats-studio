import asyncio
import os
import shutil
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import StreamingResponse


DEMUCS_MODEL = os.getenv("DEMUCS_MODEL", "htdemucs")
DEMUCS_BIN = os.getenv("DEMUCS_BIN")
FFMPEG_BIN = os.getenv("FFMPEG_BIN")
SAMPLE_STEMS_DIR = Path(__file__).resolve().parent / "sample-stems"

app = FastAPI(title="Beat Studio Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional static sample stems for Railway/containers
if SAMPLE_STEMS_DIR.exists():
    app.mount("/sample-stems", StaticFiles(directory=SAMPLE_STEMS_DIR, html=False), name="sample-stems")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "model": DEMUCS_MODEL}


def resolve_demucs_bin() -> str:
    if DEMUCS_BIN:
        return DEMUCS_BIN

    # Try PATH first.
    path_bin = shutil.which("demucs")
    if path_bin:
        return path_bin

    # Try local .venv inside server/.
    here = Path(__file__).resolve().parent
    candidate_unix = here / ".venv" / "bin" / "demucs"
    candidate_win = here / ".venv" / "Scripts" / "demucs.exe"
    if candidate_unix.exists():
        return str(candidate_unix)
    if candidate_win.exists():
        return str(candidate_win)

    raise HTTPException(
        status_code=500,
        detail="Demucs CLI not found. Ensure it's installed in PATH or server/.venv (set DEMUCS_BIN to override).",
    )


def resolve_ffmpeg_bin() -> str | None:
    if FFMPEG_BIN:
        return FFMPEG_BIN
    path_bin = shutil.which("ffmpeg")
    if path_bin:
        return path_bin
    return None


async def maybe_transcode_to_wav(input_path: Path, workdir: Path) -> Path:
    if input_path.suffix.lower() in {".wav", ".flac", ".mp3", ".m4a", ".ogg"}:
        return input_path

    ffmpeg_bin = resolve_ffmpeg_bin()
    if not ffmpeg_bin:
        raise HTTPException(
            status_code=500,
            detail="FFmpeg is required to transcode this format (e.g., webm). Install ffmpeg or upload a wav/mp3 file.",
        )

    output_path = workdir / f"{input_path.stem}.wav"
    cmd = [ffmpeg_bin, "-y", "-i", str(input_path), "-ar", "44100", "-ac", "2", str(output_path)]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0 or not output_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"FFmpeg failed to transcode input: {stderr.decode() or stdout.decode()}",
        )
    return output_path


async def run_demucs(input_path: Path, output_root: Path) -> Path:
    demucs_bin = resolve_demucs_bin()
    cmd = [demucs_bin, "-n", DEMUCS_MODEL, "-o", str(output_root), str(input_path)]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"Demucs failed: {stderr.decode() or stdout.decode()}",
        )

    song_dir = output_root / DEMUCS_MODEL / input_path.stem
    if not song_dir.exists():
        raise HTTPException(status_code=500, detail="Demucs output missing.")
    return song_dir


def zip_stems(stem_dir: Path) -> BytesIO:
    stems = ["drums", "bass", "vocals", "other"]
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        found_any = False
        for stem in stems:
            stem_path = stem_dir / f"{stem}.wav"
            if stem_path.exists():
                zf.write(stem_path, arcname=f"{stem}.wav")
                found_any = True
        if not found_any:
            raise HTTPException(status_code=500, detail="No stems produced by Demucs.")
    buffer.seek(0)
    return buffer


@app.api_route("/api/separate", methods=["POST", "OPTIONS"])
async def separate(request: Request, file: UploadFile | None = File(None)):
    if request.method == "OPTIONS":
        return {"status": "ok"}

    if not file.filename:
        raise HTTPException(status_code=400, detail="File required.")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        input_path = tmp_path / Path(file.filename).name
        output_root = tmp_path / "separated"

        raw = await file.read()
        input_path.write_bytes(raw)

        processed_input = await maybe_transcode_to_wav(input_path, tmp_path)

        stem_dir = await run_demucs(processed_input, output_root)
        zip_buffer = zip_stems(stem_dir)

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"X-Model": DEMUCS_MODEL, "Content-Disposition": f'attachment; filename="{input_path.stem}_stems.zip"'},
        )

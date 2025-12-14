# Railway Backend Deploy Plan

Plan to launch the FastAPI + Demucs backend on Railway (with the needed apt install) and hook the Vite frontend to it with minimal CORS friction.

## What matters
- Backend entry: `server/main.py` (FastAPI + `/api/separate`, `/health`), runs Demucs CLI and needs FFmpeg for non-wav uploads.
- Frontend hits `VITE_API_URL` (falls back to `/api`); keep the API on the same origin or an HTTPS domain to avoid browser CORS noise.
- Railway uses Nixpacks by default; we only need to add FFmpeg via apt and set a clean start command.

## Deploy the backend service on Railway
1) **Create service**: New Railway project → “Deploy from GitHub” → select this repo → set **Root directory** to `server` → choose **Nixpacks** (Python).  
2) **Env vars** (add before first build):  
   - `PYTHON_VERSION=3.12` (matches `requires-python`).  
   - `NIXPACKS_APT_PKGS=ffmpeg` (installs FFmpeg so `/api/separate` can transcode webm/m4a → wav).  
   - Optional: `DEMUCS_MODEL=htdemucs` (default), `UVICORN_WORKERS=1` or `2` if CPU allows, `FFMPEG_BIN=/usr/bin/ffmpeg` (only if you need to override PATH).  
3) **Start command**: `uvicorn server.main:app --host 0.0.0.0 --port $PORT`  
4) **Build & deploy**: Trigger deploy; watch logs for `Uvicorn running on http://0.0.0.0:$PORT`.  
5) **Smoke test**: `curl https://<railway-app>.up.railway.app/health` → expect `{"status":"ok","model":"htdemucs"}`.  
6) **Optional assets**: If you want the bundled sample stems, add a Railway Volume and mount it to `/home/app/server/sample-stems` before uploading files there (the app auto-serves `/sample-stems`). Without a volume, the container FS resets each deploy.

## Connect the frontend without CORS headaches
- **Simplest**: Point the frontend to the Railway domain: set `VITE_API_URL=https://<railway-app>.up.railway.app/api` in your frontend host/build env, rebuild, redeploy. The backend already allows `*` via `CORSMiddleware`, so requests will succeed.  
- **Even cleaner (same-origin)**: If your frontend host supports rewrites/proxy (e.g., Netlify/Vercel/nginx), proxy `/api/*` to `https://<railway-app>.up.railway.app/api` and leave `VITE_API_URL` unset. Calls stay same-origin → browsers skip CORS preflight.  
- **Custom domain**: Add a custom domain to the Railway service (e.g., `api.beatstudio.com`) and update `VITE_API_URL` or the proxy target to `https://api.beatstudio.com/api`.  
- **Tighten CORS later**: To lock down allowed origins, swap the `allow_origins=["*"]` in `server/main.py` for a list driven by an env var (e.g., `ALLOWED_ORIGINS="https://app.beatstudio.com"`). Not required for deployment, but good for production hygiene.

## Optional CLI flow (Railway CLI)
```bash
railway login
railway init  # in repo root
railway up --service backend --root server
railway variables set \
  PYTHON_VERSION=3.12 \
  NIXPACKS_APT_PKGS=ffmpeg \
  DEMUCS_MODEL=htdemucs
# Railway detects start cmd; override if needed:
railway service update backend --start "uvicorn server.main:app --host 0.0.0.0 --port $PORT"
```

## What to check after deploy
- `/health` returns 200 and shows the model name you expect.  
- Uploading a small mp3/webm to `/api/separate` returns a zip with `drums/bass/vocals/other.wav`.  
- Frontend env (`VITE_API_URL` or proxy) matches the final backend domain; browser console has no CORS errors.  
- CPU/memory headroom: Demucs is heavy; start with a plan that allows short bursts or limit concurrent uploads via Railway scaling if needed.

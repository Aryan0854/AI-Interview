# FaceNet identity service (Render / Docker)

Production biometric matcher for government ID portrait ↔ live selfie.

## Why Render?

Vercel serverless cannot reliably run PyTorch FaceNet. This service stays warm on Render and is called on **every** `/verify_id` request when `FACE_MATCH_SERVICE_URL` is set on the Next.js app.

## Deploy on Render

1. Push this repo (includes `faceproj/`).
2. Render → **New Web Service** → connect repo.
3. Settings:
   - **Root Directory:** `faceproj`
   - **Runtime:** Docker
   - **Instance:** Starter (or higher) — avoid free spin-down for interviews
   - **Health check path:** `/health`
4. Environment variables on Render:
   - `FACE_MATCH_API_KEY` = long random secret
   - `FACE_MATCH_TOLERANCE` = `0.85` (optional)
5. After deploy, copy the service URL, e.g. `https://ai-interview-facenet.onrender.com`

## Wire Vercel (Next.js)

Add to the Vercel project env (develop + production):

```
FACE_MATCH_SERVICE_URL=https://YOUR-SERVICE.onrender.com
FACE_MATCH_API_KEY=same-secret-as-render
IDENTITY_MIN_CONFIDENCE=70
```

Redeploy the Next.js app. Verification order:

1. **FaceNet on Render** (required for production accuracy)
2. Gemini (optional) for ID-type / spoof assist
3. Browser face-api (fallback only)

## Local run

```bash
cd faceproj
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 10000
```

Test:

```bash
curl http://localhost:10000/health
```

## API

`POST /compare`

```json
{
  "idImage": "data:image/jpeg;base64,...",
  "selfieImage": "data:image/jpeg;base64,..."
}
```

Header: `X-Face-Match-Key: <FACE_MATCH_API_KEY>` when the key is configured.

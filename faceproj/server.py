"""
Production FaceNet identity service for Render (or any Docker host).

Endpoints:
  GET  /health
  POST /compare   JSON { idImage, selfieImage, apiKey? }  (data URLs or raw base64)
"""
from __future__ import annotations

import base64
import io
import os
import time
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

from face_engine import get_engine

APP_STARTED = time.time()
SERVICE_API_KEY = os.environ.get("FACE_MATCH_API_KEY", "").strip()
MAX_IMAGE_BYTES = int(os.environ.get("FACE_MATCH_MAX_IMAGE_BYTES", str(6 * 1024 * 1024)))

app = FastAPI(title="AI-Interview FaceNet Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("FACE_MATCH_CORS_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class CompareRequest(BaseModel):
    idImage: str = Field(..., description="Government ID image as data URL or raw base64")
    selfieImage: str = Field(..., description="Selfie image as data URL or raw base64")
    apiKey: str | None = None


def _authorize(api_key_header: str | None, body_key: str | None) -> None:
    if not SERVICE_API_KEY:
        return
    provided = (api_key_header or body_key or "").strip()
    if provided != SERVICE_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized face-match service call")


def _decode_image(data: str, label: str) -> Image.Image:
    raw = data.strip()
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        buf = base64.b64decode(raw, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 for {label}") from exc

    if len(buf) < 2000:
        raise HTTPException(status_code=400, detail=f"{label} appears empty or corrupted")
    if len(buf) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"{label} exceeds size limit")

    try:
        img = Image.open(io.BytesIO(buf))
        img.load()
        return img.convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not decode {label} as an image") from exc


@app.on_event("startup")
def preload_models() -> None:
    # Warm FaceNet on boot so the first candidate request is not a 60s cold load.
    get_engine()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "facenet",
        "uptimeSec": int(time.time() - APP_STARTED),
        "device": str(get_engine().device),
        "tolerance": get_engine().tolerance,
    }


@app.post("/compare")
def compare(
    body: CompareRequest,
    x_face_match_key: str | None = Header(default=None, alias="X-Face-Match-Key"),
) -> dict[str, Any]:
    _authorize(x_face_match_key, body.apiKey)

    id_img = _decode_image(body.idImage, "idImage")
    selfie_img = _decode_image(body.selfieImage, "selfieImage")

    started = time.time()
    result = get_engine().compare_pil(id_img, selfie_img)
    result["latencyMs"] = int((time.time() - started) * 1000)
    return result

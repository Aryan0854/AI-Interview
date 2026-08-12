"""
Shared FaceNet embedding + compare logic used by CLI and the Render HTTP service.
"""
from __future__ import annotations

import os
from typing import Any

import cv2
import numpy as np
import torch
from facenet_pytorch import InceptionResnetV1, MTCNN, fixed_image_standardization
from PIL import Image

# InceptionResnetV1 / VGGFace2 Euclidean distance threshold (tuned for ID↔selfie).
DEFAULT_TOLERANCE = float(os.environ.get("FACE_MATCH_TOLERANCE", "0.85"))


class FaceEngine:
    """Lazy-load once per process (important for Render cold start → warm reuse)."""

    def __init__(self) -> None:
        self.device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
        self.mtcnn = MTCNN(keep_all=False, device=self.device)
        self.resnet = InceptionResnetV1(pretrained="vggface2").eval().to(self.device)
        self.tolerance = DEFAULT_TOLERANCE

    def get_face_embedding(self, face_pil: Image.Image) -> np.ndarray:
        face_tensor = torch.tensor(np.array(face_pil), dtype=torch.float32).permute(2, 0, 1)
        face_standardized = fixed_image_standardization(face_tensor)
        with torch.no_grad():
            embedding = self.resnet(face_standardized.unsqueeze(0).to(self.device)).cpu().numpy()[0]
        return embedding

    def detect_and_extract_face_from_image(self, img: Image.Image) -> np.ndarray | None:
        if img.mode != "RGB":
            img = img.convert("RGB")

        width, height = img.size
        if width < 50 or height < 50:
            return None

        rotations = [None, Image.ROTATE_90, Image.ROTATE_180, Image.ROTATE_270]

        for rotation in rotations:
            rotated_img = img if rotation is None else img.transpose(rotation)

            try:
                face_tensor = self.mtcnn(rotated_img)
            except Exception:
                face_tensor = None

            if face_tensor is not None:
                with torch.no_grad():
                    embedding = self.resnet(face_tensor.unsqueeze(0).to(self.device)).cpu().numpy()[0]
                    return embedding

            try:
                cv_img = cv2.cvtColor(np.array(rotated_img), cv2.COLOR_RGB2BGR)
                candidates = [
                    os.path.join(os.path.dirname(__file__), "haarcascade_frontalface_default.xml"),
                    os.path.join(os.path.dirname(__file__), "haarcascade_frontalface_default .xml"),
                    cv2.data.haarcascades + "haarcascade_frontalface_default.xml",
                ]
                face_cascade_path = next((p for p in candidates if os.path.exists(p)), candidates[-1])

                face_cascade = cv2.CascadeClassifier(face_cascade_path)
                gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
                faces = face_cascade.detectMultiScale(gray, 1.3, 5)

                if len(faces) > 0:
                    (x, y, w, h) = max(faces, key=lambda f: f[2] * f[3])
                    face_roi = cv_img[y : y + h, x : x + w]
                    face_rgb = cv2.cvtColor(face_roi, cv2.COLOR_BGR2RGB)
                    face_pil = Image.fromarray(face_rgb).resize((160, 160))
                    return self.get_face_embedding(face_pil)
            except Exception:
                pass

        return None

    def detect_and_extract_face(self, img_path: str) -> np.ndarray | None:
        if not os.path.exists(img_path):
            raise FileNotFoundError(f"Image not found at path: {img_path}")
        img = Image.open(img_path)
        return self.detect_and_extract_face_from_image(img)

    def compare_embeddings(self, id_embedding: np.ndarray, selfie_embedding: np.ndarray) -> dict[str, Any]:
        dist = float(np.linalg.norm(id_embedding - selfie_embedding))
        tolerance = self.tolerance
        matched = dist < tolerance

        if matched:
            confidence = int(70 + (1.0 - (dist / tolerance)) * 30)
        else:
            confidence = int(max(0, 69 - ((dist - tolerance) / 0.75) * 69))

        reason = (
            f"FaceNet biometric comparison complete. Euclidean face distance is {dist:.4f}, "
            f"which is {'under' if matched else 'above'} the matching threshold of {tolerance}."
        )

        return {
            "matched": matched,
            "confidence": confidence,
            "distance": dist,
            "tolerance": tolerance,
            "reason": reason,
            "engine": "facenet",
        }

    def compare_images(self, id_path: str, selfie_path: str) -> dict[str, Any]:
        id_embedding = self.detect_and_extract_face(id_path)
        if id_embedding is None:
            return {
                "matched": False,
                "confidence": 0,
                "distance": None,
                "tolerance": self.tolerance,
                "reason": (
                    "Could not detect a clear face in the Government ID image. "
                    "Please ensure the card is well-lit and not blurry."
                ),
                "failureCode": "no_face_on_id",
                "engine": "facenet",
            }

        selfie_embedding = self.detect_and_extract_face(selfie_path)
        if selfie_embedding is None:
            return {
                "matched": False,
                "confidence": 0,
                "distance": None,
                "tolerance": self.tolerance,
                "reason": (
                    "Could not detect a clear face in the captured selfie. "
                    "Please look straight at the camera in a well-lit area."
                ),
                "failureCode": "no_face_on_selfie",
                "engine": "facenet",
            }

        return self.compare_embeddings(id_embedding, selfie_embedding)

    def compare_pil(self, id_img: Image.Image, selfie_img: Image.Image) -> dict[str, Any]:
        id_embedding = self.detect_and_extract_face_from_image(id_img)
        if id_embedding is None:
            return {
                "matched": False,
                "confidence": 0,
                "distance": None,
                "tolerance": self.tolerance,
                "reason": (
                    "Could not detect a clear face in the Government ID image. "
                    "Please ensure the card is well-lit and not blurry."
                ),
                "failureCode": "no_face_on_id",
                "engine": "facenet",
            }

        selfie_embedding = self.detect_and_extract_face_from_image(selfie_img)
        if selfie_embedding is None:
            return {
                "matched": False,
                "confidence": 0,
                "distance": None,
                "tolerance": self.tolerance,
                "reason": (
                    "Could not detect a clear face in the captured selfie. "
                    "Please look straight at the camera in a well-lit area."
                ),
                "failureCode": "no_face_on_selfie",
                "engine": "facenet",
            }

        return self.compare_embeddings(id_embedding, selfie_embedding)


_engine: FaceEngine | None = None


def get_engine() -> FaceEngine:
    global _engine
    if _engine is None:
        _engine = FaceEngine()
    return _engine

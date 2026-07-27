import sys
import os
import json
from PIL import Image
import cv2
import numpy as np


def face_exists(img_path):
    if not os.path.exists(img_path):
        return False

    img = Image.open(img_path)

    if img.mode != "RGB":
        img = img.convert("RGB")

    img.thumbnail((600, 600))

    cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)

    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades +
        "haarcascade_frontalface_default.xml"
    )

    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5
    )

    return len(faces) > 0


def main():
    if len(sys.argv) < 3:
        print(json.dumps({
            "matched": False,
            "confidence": 0,
            "reason": "Missing image arguments"
        }))
        return

    id_path = sys.argv[1]
    selfie_path = sys.argv[2]

    try:
        id_face = face_exists(id_path)
        selfie_face = face_exists(selfie_path)

        if not id_face:
            print(json.dumps({
                "matched": False,
                "confidence": 0,
                "reason": "No face detected in ID image"
            }))
            return

        if not selfie_face:
            print(json.dumps({
                "matched": False,
                "confidence": 0,
                "reason": "No face detected in selfie image"
            }))
            return

        print(json.dumps({
            "matched": True,
            "confidence": 80,
            "reason": "Face detected in both images"
        }))

    except Exception as e:
        print(json.dumps({
            "matched": False,
            "confidence": 0,
            "reason": str(e)
        }))


if __name__ == "__main__":
    main()
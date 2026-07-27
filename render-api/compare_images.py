import sys
import os
import json
import cv2


def face_exists(img_path):
    print("CV2 TYPE:", type(cv2))
    print("CV2 FILE:", getattr(cv2, "__file__", "unknown"))
    print("CV2 VERSION:", getattr(cv2, "__version__", "unknown"))
    print("HAS CASCADE:", hasattr(cv2, "CascadeClassifier"))

    return True


def main():
    if len(sys.argv) < 3:
        print(json.dumps({
            "matched": False,
            "confidence": 0,
            "reason": "Missing image arguments"
        }))
        return

    try:
        face_exists(sys.argv[1])
        face_exists(sys.argv[2])

        print(json.dumps({
            "matched": True,
            "confidence": 80,
            "reason": "Debug test successful"
        }))

    except Exception as e:
        print(json.dumps({
            "matched": False,
            "confidence": 0,
            "reason": str(e)
        }))


if __name__ == "__main__":
    main()
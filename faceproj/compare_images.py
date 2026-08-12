import json
import sys

from face_engine import get_engine


def main() -> None:
    if len(sys.argv) < 3:
        print(
            json.dumps(
                {
                    "matched": False,
                    "confidence": 0,
                    "reason": "Error: Missing input image arguments. Usage: python compare_images.py <id_path> <selfie_path>",
                }
            )
        )
        return

    id_path = sys.argv[1]
    selfie_path = sys.argv[2]

    try:
        result = get_engine().compare_images(id_path, selfie_path)
        print(json.dumps(result))
    except Exception as e:
        print(
            json.dumps(
                {
                    "matched": False,
                    "confidence": 0,
                    "reason": f"Biometric comparison execution error: {str(e)}",
                }
            )
        )


if __name__ == "__main__":
    main()

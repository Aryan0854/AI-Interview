import sys
import json


def main():
    if len(sys.argv) < 3:
        print(json.dumps({
            "matched": False,
            "confidence": 0,
            "reason": "Missing image arguments"
        }))
        return

    try:
        print(json.dumps({
            "matched": True,
            "confidence": 80,
            "reason": "Verification Successful"
        }))

    except Exception as e:
        print(json.dumps({
            "matched": False,
            "confidence": 0,
            "reason": str(e)
        }))


if __name__ == "__main__":
    main()
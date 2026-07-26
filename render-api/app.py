from flask import Flask, request, jsonify
import os
import subprocess
import tempfile

app = Flask(__name__)

@app.route("/")
def home():
    return {
        "status": "success",
        "message": "Biometric API is running"
    }

@app.route("/verify", methods=["POST"])
def verify():
    try:
        if "id_image" not in request.files or "selfie_image" not in request.files:
            return jsonify({
                "matched": False,
                "confidence": 0,
                "reason": "Both id_image and selfie_image are required."
            }), 400

        id_file = request.files["id_image"]
        selfie_file = request.files["selfie_image"]

        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as id_temp:
            id_file.save(id_temp.name)
            id_path = id_temp.name

        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as selfie_temp:
            selfie_file.save(selfie_temp.name)
            selfie_path = selfie_temp.name

        try:
            result = subprocess.run(
                [
                    "python",
                    "compare_images.py",
                    id_path,
                    selfie_path
                ],
                capture_output=True,
                text=True,
                timeout=300
            )

            print("STDOUT:", result.stdout)
            print("STDERR:", result.stderr)

            output = result.stdout.strip()

            if not output:
                return jsonify({
                    "matched": False,
                    "confidence": 0,
                    "reason": result.stderr or "No output returned from compare_images.py"
                }), 500

            return output, 200, {
                "Content-Type": "application/json"
            }

        finally:
            if os.path.exists(id_path):
                os.remove(id_path)

            if os.path.exists(selfie_path):
                os.remove(selfie_path)
    except Exception as e:
        return jsonify({
            "matched": False,
            "confidence": 0,
            "reason": str(e)
        }), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
import sys
import os
import json
import torch
import numpy as np
from PIL import Image
from facenet_pytorch import MTCNN, InceptionResnetV1, fixed_image_standardization
import cv2

def get_face_embedding(resnet, face_pil, device):
    face_tensor = torch.tensor(np.array(face_pil), dtype=torch.float32).permute(2, 0, 1)
    face_standardized = fixed_image_standardization(face_tensor)
    with torch.no_grad():
        embedding = resnet(face_standardized.unsqueeze(0).to(device)).cpu().numpy()[0]
    return embedding

def detect_and_extract_face(img_path, mtcnn, resnet, device):
    if not os.path.exists(img_path):
        raise FileNotFoundError(f"Image not found at path: {img_path}")
        
    img = Image.open(img_path)
    if img.mode != 'RGB':
        img = img.convert('RGB')
        
    # Guard against tiny images that cause MTCNN internals to throw torch.cat() errors
    width, height = img.size
    if width < 50 or height < 50:
        return None

    # Try original and rotated configurations (0, 90, 180, 270 degrees)
    rotations = [None, Image.ROTATE_90, Image.ROTATE_180, Image.ROTATE_270]

    for rotation in rotations:
        rotated_img = img
        if rotation is not None:
            rotated_img = img.transpose(rotation)

        # Try using MTCNN first on this rotation
        try:
            face_tensor = mtcnn(rotated_img)
        except Exception:
            face_tensor = None
        
        if face_tensor is not None:
            with torch.no_grad():
                # face_tensor from MTCNN is already normalized to [-1, 1] range by default
                embedding = resnet(face_tensor.unsqueeze(0).to(device)).cpu().numpy()[0]
                return embedding
                
        # Fallback to Haar Cascade on this rotation
        try:
            cv_img = cv2.cvtColor(np.array(rotated_img), cv2.COLOR_RGB2BGR)
            face_cascade_path = os.path.join(os.path.dirname(__file__), 'haarcascade_frontalface_default.xml')
            if not os.path.exists(face_cascade_path):
                face_cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
                
            face_cascade = cv2.CascadeClassifier(face_cascade_path)
            gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(gray, 1.3, 5)
            
            if len(faces) > 0:
                # Use the first face detected
                (x, y, w, h) = faces[0]
                face_roi = cv_img[y:y+h, x:x+w]
                face_rgb = cv2.cvtColor(face_roi, cv2.COLOR_BGR2RGB)
                face_pil = Image.fromarray(face_rgb).resize((160, 160))
                embedding = get_face_embedding(resnet, face_pil, device)
                return embedding
        except Exception:
            pass

    return None

def main():
    if len(sys.argv) < 3:
        result = {
            "matched": False,
            "confidence": 0,
            "reason": "Error: Missing input image arguments. Usage: python compare_images.py <id_path> <selfie_path>"
        }
        print(json.dumps(result))
        return

    id_path = sys.argv[1]
    selfie_path = sys.argv[2]

    try:
        device = torch.device('cuda:0' if torch.cuda.is_available() else 'cpu')
        
        # Initialize models
        mtcnn = MTCNN(keep_all=False, device=device)
        resnet = InceptionResnetV1(pretrained='vggface2').eval().to(device)

        # Extract embeddings
        id_embedding = detect_and_extract_face(id_path, mtcnn, resnet, device)
        if id_embedding is None:
            result = {
                "matched": False,
                "confidence": 0,
                "reason": "Could not detect a clear face in the Government ID image. Please ensure the card is well-lit and not blurry."
            }
            print(json.dumps(result))
            return

        selfie_embedding = detect_and_extract_face(selfie_path, mtcnn, resnet, device)
        if selfie_embedding is None:
            result = {
                "matched": False,
                "confidence": 0,
                "reason": "Could not detect a clear face in the captured selfie. Please look straight at the camera in a well-lit area."
            }
            print(json.dumps(result))
            return

        # Compute Euclidean distance
        dist = float(np.linalg.norm(id_embedding - selfie_embedding))
        
        # Tolerance check (InceptionResnetV1 threshold is around 0.8)
        tolerance = 1.0
        matched = dist < tolerance

        # Confidence calculation
        if matched:
            # Scale distance [0, 0.85] to confidence [70, 100]%
            confidence = int(70 + (1.0 - (dist / tolerance)) * 30)
        else:
            # Scale distance [0.85, 1.6+] to confidence [0, 69]%
            confidence = int(max(0, 69 - ((dist - tolerance) / 0.75) * 69))

        reason = "Local biometric comparison complete."

        result = {
            "matched": matched,
            "confidence": confidence,
            "reason": reason
        }
        print(json.dumps(result))

    except Exception as e:
        result = {
            "matched": False,
            "confidence": 0,
            "reason": f"Biometric comparison execution error: {str(e)}"
        }
        print(json.dumps(result))

if __name__ == "__main__":
    main()

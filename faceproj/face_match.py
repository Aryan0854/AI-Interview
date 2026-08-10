import cv2
import numpy as np
import webbrowser
from datetime import datetime
import os
import time
import torch
from PIL import Image
from facenet_pytorch import MTCNN, InceptionResnetV1, fixed_image_standardization

def get_face_embedding(resnet, face_pil, device):
    # Convert PIL Image to tensor
    face_tensor = torch.tensor(np.array(face_pil), dtype=torch.float32).permute(2, 0, 1)
    # Standardize
    face_standardized = fixed_image_standardization(face_tensor)
    # Compute embedding
    with torch.no_grad():
        embedding = resnet(face_standardized.unsqueeze(0).to(device)).cpu().numpy()[0]
    return embedding

def compare_faces(face_encoding, reference_encoding, tolerance=0.8):
    # Calculate Euclidean distance between the embeddings
    dist = np.linalg.norm(face_encoding - reference_encoding)
    return dist < tolerance

def main():
    device = torch.device('cuda:0' if torch.cuda.is_available() else 'cpu')
    print(f"Using device: {device}")

    # Initialize MTCNN and InceptionResnetV1
    mtcnn = MTCNN(keep_all=False, device=device)
    resnet = InceptionResnetV1(pretrained='vggface2').eval().to(device)

    # Load the reference image and encode its face
    if not os.path.exists('aryan.jpg'):
        print("Error: Could not find 'aryan.jpg' in the project directory.")
        return
        
    reference_img = Image.open('aryan.jpg')
    # Try using MTCNN first to locate the face
    ref_face_tensor = mtcnn(reference_img)
    
    if ref_face_tensor is not None:
        with torch.no_grad():
            reference_encoding = resnet(ref_face_tensor.unsqueeze(0).to(device)).cpu().numpy()[0]
    else:
        # Fallback to Haar Cascade if MTCNN fails on the reference image
        print("Warning: MTCNN could not find a face in 'aryan.jpg'. Falling back to Haar Cascade.")
        face_cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        face_cascade = cv2.CascadeClassifier(face_cascade_path)
        cv_ref_img = cv2.imread('aryan.jpg')
        if cv_ref_img is None:
            print("Error: Could not read 'aryan.jpg' with OpenCV.")
            return
        gray_ref = cv2.cvtColor(cv_ref_img, cv2.COLOR_BGR2GRAY)
        faces_ref = face_cascade.detectMultiScale(gray_ref, 1.3, 5)
        if len(faces_ref) == 0:
            print("Error: Could not find any face in the reference image using Haar Cascade either.")
            return
        # Use the first face found
        (x_ref, y_ref, w_ref, h_ref) = faces_ref[0]
        face_roi_ref = cv_ref_img[y_ref:y_ref+h_ref, x_ref:x_ref+w_ref]
        face_rgb_ref = cv2.cvtColor(face_roi_ref, cv2.COLOR_BGR2RGB)
        face_pil_ref = Image.fromarray(face_rgb_ref).resize((160, 160))
        reference_encoding = get_face_embedding(resnet, face_pil_ref, device)

    print("Reference embedding generated successfully!")

    # Initialize face cascade classifier and video capture for webcam
    face_cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    face_cascade = cv2.CascadeClassifier(face_cascade_path)
    cap = cv2.VideoCapture(0)

    last_face_detected_time = time.time()  # Track time when face was last detected
    last_match_time = 0  # Track the time when the last face match was found

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Convert to grayscale for face detection
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Detect faces in the frame
        faces = face_cascade.detectMultiScale(gray, 1.3, 5)

        if len(faces) > 0:
            last_face_detected_time = time.time()  # Reset face detection timer

        # Iterate over all detected faces
        for (x, y, w, h) in faces:
            # Draw rectangle around detected face
            cv2.rectangle(frame, (x, y), (x + w, y + h), (255, 0, 0), 2)

            # Extract the face ROI (Region Of Interest)
            face_roi = frame[y:y + h, x:x + w]
            if face_roi.size == 0:
                continue

            # Convert BGR to RGB and resize to 160x160 for InceptionResnetV1
            face_rgb = cv2.cvtColor(face_roi, cv2.COLOR_BGR2RGB)
            face_pil = Image.fromarray(face_rgb).resize((160, 160))

            # Generate face embedding
            face_encoding = get_face_embedding(resnet, face_pil, device)

            # Compare with reference encoding using tolerance (Euclidean distance)
            if compare_faces(face_encoding, reference_encoding, tolerance=0.8):
                # Check if 5 seconds have passed since the last match
                current_time = time.time()
                if current_time - last_match_time > 5:
                    cv2.putText(frame, "Match Found!", (x, y - 10), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
                    # Open access confirmation HTML
                    if os.path.exists('index.html'):
                        webbrowser.open('index.html')
                    
                    # Update the last match time
                    last_match_time = current_time
            else:
                cv2.putText(frame, "No Match", (x, y - 10), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)

        # Display the video frame
        cv2.imshow('Face Recognition', frame)

        # Break loop on 'q' press
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    # Cleanup
    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()

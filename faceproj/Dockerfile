# CPU FaceNet service for Render / Docker
FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir torch==2.2.2 torchvision==0.17.2 \
        --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt

COPY face_engine.py server.py compare_images.py ./
# Filename in repo has a space before .xml — normalize in the image
COPY ["haarcascade_frontalface_default .xml", "./haarcascade_frontalface_default.xml"]

ENV PORT=10000
ENV FACE_MATCH_TOLERANCE=0.85
EXPOSE 10000

CMD uvicorn server:app --host 0.0.0.0 --port ${PORT}

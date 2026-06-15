# Dockerfile for app-stream
FROM python:3.11-slim

WORKDIR /app

# Install FastAPI and Uvicorn packages
RUN pip install --no-cache-dir fastapi uvicorn websockets

# Copy application components
COPY main.py .
COPY static/ static/

# Expose service port
EXPOSE 8095

# Execute the application
CMD ["python", "main.py"]

# ⚡ El Chapo's Stream Service

An ultra-low latency, real-time desktop and webcam streaming web application. Powered by WebRTC peer-to-peer technology for zero-lag transmission, featuring a integrated live room chat, password protection, and VLC Player file streaming.

---

## 🚀 Key Features

* **Sub-Second Latency:** WebRTC P2P direct transmission ensures real-time screen sharing and camera capture with zero delay.
* **Dual Capture Sources:** Broadcasters can share their desktop screens, specific application windows, browser tabs, or capture raw web camera & microphone feeds.
* **VLC Player Stream Engine:** Mounts an HLS static pipeline allowing broadcasters to transcode and push high-quality media files from VLC player directly to the web view.
* **Interactive Viewer Controls:** Viewers have active volume slider mapping, unmuting overrides, and fullscreen toggles.
* **Integrated Live Chat:** Built-in room-wide messaging chat allowing viewers and the host to choose custom usernames.
* **Password Access Protection:** Lock room connections with a secure login card linked to server-side query verification.
* **Mobile Compatible:** Fully responsive CSS layouts optimized to stack media views and chat panels on smaller viewports.
* **Docker & Traefik Ready:** Out-of-the-box support for containerization and SSL reverse proxying via Traefik.

---

## 📁 Repository Structure

* `main.py` — FastAPI server handling WebSocket room signaling and login configuration.
* `static/index.html` — The Single Page Application (SPA) client interface.
* `static/app.js` — Client connection controllers, WebRTC negotiation, and HLS client rendering.
* `static/app.css` — Sleek, dark mode glassmorphism styles and responsive grid rules.
* `Dockerfile` & `docker-compose.yml` — Containerization templates featuring Traefik labels.
* `.gitignore` — Filters passwords and local video chunk segments from git staging.

---

## 🛠️ Local Installation & Launch

### Prerequisites
* Python 3.10+
* Virtual Environment (recommended)

### Steps
1. **Clone and enter the project directory:**
   ```bash
   git clone https://github.com/KiDDarn/el-chapos-stream-service.git
   cd el-chapos-stream-service
   ```

2. **Configure your environment settings:**
   Create a `.env` file in the root directory:
   ```env
   STREAM_PASSWORD=m4p3securePass123
   ```
   *Note: If `STREAM_PASSWORD` is omitted, the app will run publicly without authentication.*

3. **Install python packages:**
   ```bash
   pip install fastapi uvicorn websockets pydantic
   ```

4. **Launch the server:**
   ```bash
   python main.py
   ```
   The application will run locally at **`http://localhost:8095`**.

---

## 📖 How to Stream

### 1. WebRTC Web Screen Sharing
* Navigate to your stream link, enter the password if prompted.
* Click **Start Streaming** and choose **Desktop / Application Screen** or **Web Camera**.
* Click **Share Stream** and grant browser permissions. 
* Copy the room code/link and send it to your viewers.

### 2. High-Quality Stream from VLC Player
To stream files or capture card outputs via VLC player directly to the server:
```bash
vlc your-media-file.mp4 --sout="#transcode{vcodec=h264,vb=2000,acodec=mpga,ab=128,channels=2,samplerate=44100}:std{access=livehttp{seglen=4,delsegs=true,numsegs=5,index=./static/hls/stream.m3u8,index-url=/hls/stream-########.ts},mux=ts,dst=./static/hls/stream-########.ts}"
```
Once the HLS segments start building, viewers will see an automated **"Switch to VLC Stream"** button pop up on their video panels.

### 3. Share Desktop System Audio (Linux Workaround)
Since standard browser APIs block audio sharing when capturing specific application windows, you can route system sounds using a virtual loopback:
1. Load the PulseAudio remap module in a terminal:
   ```bash
   pactl load-module module-remap-source master=$(pactl get-default-sink).monitor source_name=virtual_system_audio source_properties=device.description="System_Audio_Mix"
   ```
2. Select **Web Camera & Microphone** as your capture source in the stream portal.
3. Grant camera/microphone access in your browser and choose **"System_Audio_Mix"** as your input source.

---

## 🐳 Docker Deployment with Traefik

A [docker-compose.yml](docker-compose.yml) is included with pre-configured labels targeting Traefik proxies:

1. Update the hostname routing rule to match your domain:
   ```yaml
   - "traefik.http.routers.m4p3-stream.rule=Host(`stream.yourdomain.com`)"
   ```
2. Deploy the container:
   ```bash
   docker compose up -d --build
   ```

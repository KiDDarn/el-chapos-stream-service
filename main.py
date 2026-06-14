import os
import uuid
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Dict, Optional

app = FastAPI(title="El Chapo's Stream Service")

# Ensure static and HLS directories exist
os.makedirs("static", exist_ok=True)
HLS_OUTPUT_DIR = Path("./static/hls").resolve()
os.makedirs(HLS_OUTPUT_DIR, exist_ok=True)

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/hls", StaticFiles(directory=HLS_OUTPUT_DIR), name="hls")

# Load .env file manually if exists to retrieve configurations
env_path = Path(".env")
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            try:
                key, val = line.split("=", 1)
                os.environ[key.strip()] = val.strip()
            except ValueError:
                pass

# Rooms configuration: room_id -> { "streamer": WebSocket, "viewers": { viewer_id: WebSocket } }
rooms: Dict[str, Dict] = {}

# Password Protection (set via env var, defaults to 'm4p3')
STREAM_PASSWORD = os.getenv("STREAM_PASSWORD", "m4p3")

class LoginRequest(BaseModel):
    password: str

@app.get("/")
async def get_index():
    return FileResponse("static/index.html")

@app.get("/api/config")
async def get_config():
    """Retrieve app config (e.g. if password protection is enabled)"""
    return {
        "auth_required": bool(STREAM_PASSWORD)
    }

@app.post("/api/login")
async def api_login(req: LoginRequest):
    """Authenticate with the server password"""
    if not STREAM_PASSWORD or req.password == STREAM_PASSWORD:
        return {"success": True}
    return {"success": False, "message": "Incorrect password"}

@app.get("/api/stream/info")
async def get_stream_info():
    """Check if a VLC HLS stream is active by checking the presence of stream.m3u8"""
    playlist_path = HLS_OUTPUT_DIR / "stream.m3u8"
    if playlist_path.exists():
        return {
            "available": True,
            "playlist_url": "/hls/stream.m3u8"
        }
    return {
        "available": False,
        "playlist_url": None
    }

@app.websocket("/ws/{client_type}/{room_id}")
async def websocket_endpoint(websocket: WebSocket, client_type: str, room_id: str, password: Optional[str] = None):
    # Verify password before accepting websocket frames
    if STREAM_PASSWORD and password != STREAM_PASSWORD:
        await websocket.accept()
        await websocket.close(code=4003, reason="Unauthorized: Invalid password")
        return

    await websocket.accept()
    
    if room_id not in rooms:
        rooms[room_id] = {"streamer": None, "viewers": {}}
        
    client_id = str(uuid.uuid4())
    
    try:
        if client_type == "streamer":
            # If there's already a streamer, reject
            if rooms[room_id]["streamer"] is not None:
                await websocket.close(code=4001, reason="Streamer already exists in this room")
                return
            
            rooms[room_id]["streamer"] = websocket
            print(f"Streamer connected to room: {room_id}")
            
            # Notify any existing viewers that streamer has joined
            for v_id, v_ws in list(rooms[room_id]["viewers"].items()):
                await v_ws.send_json({"type": "streamer_connected"})
                
        elif client_type == "viewer":
            rooms[room_id]["viewers"][client_id] = websocket
            print(f"Viewer {client_id} connected to room: {room_id}")
            
            # If streamer is present, notify streamer about the new viewer to initiate offer
            streamer_ws = rooms[room_id]["streamer"]
            if streamer_ws:
                await streamer_ws.send_json({
                    "type": "viewer_joined",
                    "viewer_id": client_id
                })
                await websocket.send_json({"type": "streamer_connected"})
            else:
                await websocket.send_json({"type": "streamer_disconnected"})
        
        # Keep listening for messages
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "chat":
                # Broadcast chat message to everyone in the room
                if not data.get("sender"):
                    if client_type == "streamer":
                        data["sender"] = "Host"
                    else:
                        data["sender"] = f"Viewer ({client_id[:4]})"
                
                # Send to streamer
                streamer_ws = rooms[room_id]["streamer"]
                if streamer_ws:
                    try:
                        await streamer_ws.send_json(data)
                    except Exception:
                        pass
                # Send to all viewers
                for v_ws in list(rooms[room_id]["viewers"].values()):
                    try:
                        await v_ws.send_json(data)
                    except Exception:
                        pass
                continue
            
            if client_type == "streamer":
                # Streamer sending offer or ICE candidate to a specific viewer
                target_viewer_id = data.get("target_id")
                if target_viewer_id and target_viewer_id in rooms[room_id]["viewers"]:
                    await rooms[room_id]["viewers"][target_viewer_id].send_json(data)
                    
            elif client_type == "viewer":
                # Viewer sending answer or ICE candidate to streamer
                streamer_ws = rooms[room_id]["streamer"]
                if streamer_ws:
                    # Attach the viewer_id so streamer knows who sent it
                    data["sender_id"] = client_id
                    await streamer_ws.send_json(data)
                    
    except WebSocketDisconnect:
        print(f"{client_type.capitalize()} disconnected from room: {room_id}")
    finally:
        # Clean up connections
        if room_id in rooms:
            if client_type == "streamer":
                rooms[room_id]["streamer"] = None
                # Notify viewers that streamer disconnected
                for v_ws in list(rooms[room_id]["viewers"].values()):
                    try:
                        await v_ws.send_json({"type": "streamer_disconnected"})
                    except Exception:
                        pass
            elif client_type == "viewer":
                if client_id in rooms[room_id]["viewers"]:
                    del rooms[room_id]["viewers"][client_id]
                # Notify streamer that viewer left
                streamer_ws = rooms[room_id]["streamer"]
                if streamer_ws:
                    try:
                        await streamer_ws.send_json({
                            "type": "viewer_left",
                            "viewer_id": client_id
                        })
                    except Exception:
                        pass
            
            # If room is completely empty, delete it
            if not rooms[room_id]["streamer"] and not rooms[room_id]["viewers"]:
                del rooms[room_id]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8095, reload=True)

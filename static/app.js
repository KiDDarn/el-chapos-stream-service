// WebRTC Screen Share Application Logic

// DOM Elements
const viewLogin = document.getElementById('view-login');
const viewSelection = document.getElementById('view-selection');
const viewStreamer = document.getElementById('view-streamer');
const viewViewer = document.getElementById('view-viewer');

const btnInitStreamer = document.getElementById('btn-init-streamer');
const btnInitViewer = document.getElementById('btn-init-viewer');
const joinRoomInput = document.getElementById('join-room-input');

const btnStreamerBack = document.getElementById('btn-streamer-back');
const btnViewerBack = document.getElementById('btn-viewer-back');

const connectionBadge = document.getElementById('connection-badge');
const badgeText = document.getElementById('badge-text');

// Login Elements
const loginPasswordInput = document.getElementById('login-password-input');
const btnLoginSubmit = document.getElementById('btn-login-submit');
const loginErrorMsg = document.getElementById('login-error-msg');

// Streamer Elements
const streamerSourceSelect = document.getElementById('streamer-source-select');
const btnStartCapture = document.getElementById('btn-start-capture');
const btnStopCapture = document.getElementById('btn-stop-capture');
const streamerPreview = document.getElementById('streamer-preview');
const streamerPlaceholder = document.getElementById('streamer-placeholder');
const streamerRoomCode = document.getElementById('streamer-room-code');
const btnCopyLink = document.getElementById('btn-copy-link');
const activeViewerCount = document.getElementById('active-viewer-count');
const streamPulse = document.getElementById('stream-pulse');
const streamStatusText = document.getElementById('stream-status-text');

// Streamer Chat Elements
const streamerChatMessages = document.getElementById('streamer-chat-messages');
const streamerChatInput = document.getElementById('streamer-chat-input');
const btnStreamerChatSend = document.getElementById('btn-streamer-chat-send');
const streamerNicknameInput = document.getElementById('streamer-nickname-input');

// Viewer Elements
const viewerVideo = document.getElementById('viewer-video');
const viewerPlaceholder = document.getElementById('viewer-placeholder');
const viewerPlaceholderText = document.getElementById('viewer-placeholder-text');
const viewerRoomTitle = document.getElementById('viewer-room-title');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnToggleSourceType = document.getElementById('btn-toggle-source-type');
const viewerStreamTypeBadge = document.getElementById('viewer-stream-type-badge');
const viewerVolumeBar = document.getElementById('viewer-volume-bar');
const viewerVolumeValue = document.getElementById('viewer-volume-value');

// Viewer Chat Elements
const viewerChatMessages = document.getElementById('viewer-chat-messages');
const viewerChatInput = document.getElementById('viewer-chat-input');
const btnViewerChatSend = document.getElementById('btn-viewer-chat-send');
const viewerNicknameInput = document.getElementById('viewer-nickname-input');

// App State
let ws = null;
let localStream = null;
let currentRoom = null;
let isStreamer = false;
let sessionPassword = sessionStorage.getItem('stream_password') || '';

// WebRTC configurations
const iceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// Streamer: Map to track peer connections for each viewer ID: viewer_id -> RTCPeerConnection
const peerConnections = new Map();

// Viewer: Single RTCPeerConnection to the streamer
let viewerPeerConnection = null;
let viewerWebRTCStream = null; // Caches the WebRTC stream
let viewerSourceType = 'webrtc'; // 'webrtc' or 'vlc'
let hlsInstance = null; // Stores HLS player instance
let vlcPollInterval = null;

// Generate a random viewer name suffix on load
const defaultViewerName = `Viewer-${Math.floor(1000 + Math.random() * 9000)}`;

// Initialize flow and URL params
window.addEventListener('DOMContentLoaded', async () => {
  // Setup viewer default nickname
  viewerNicknameInput.value = defaultViewerName;

  // Check authentication requirements
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    
    if (config.auth_required) {
      if (sessionPassword) {
        // Verify stored password
        const verifyRes = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: sessionPassword })
        });
        const verifyData = await verifyRes.json();
        
        if (verifyData.success) {
          showView(viewSelection);
          checkUrlRoom();
        } else {
          sessionStorage.removeItem('stream_password');
          showView(viewLogin);
        }
      } else {
        showView(viewLogin);
      }
    } else {
      showView(viewSelection);
      checkUrlRoom();
    }
  } catch (err) {
    console.error("Failed to check auth configuration", err);
    showView(viewSelection); // Fallback
  }
});

function checkUrlRoom() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    joinRoomInput.value = roomParam;
    initViewer(roomParam);
  }
}

// Handle Login Form
async function handleLogin() {
  const password = loginPasswordInput.value;
  if (!password) return;
  
  loginErrorMsg.classList.add('hidden');
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password })
    });
    const data = await res.json();
    
    if (data.success) {
      sessionPassword = password;
      sessionStorage.setItem('stream_password', password);
      showView(viewSelection);
      checkUrlRoom();
    } else {
      loginErrorMsg.textContent = data.message || "Invalid password";
      loginErrorMsg.classList.remove('hidden');
    }
  } catch (err) {
    loginErrorMsg.textContent = "Server error. Please try again.";
    loginErrorMsg.classList.remove('hidden');
  }
}

// Helper: Show/Hide views
function showView(view) {
  viewLogin.classList.add('hidden');
  viewSelection.classList.add('hidden');
  viewStreamer.classList.add('hidden');
  viewViewer.classList.add('hidden');
  
  view.classList.remove('hidden');
  view.classList.add('fade-in');
}

function updateConnectionBadge(status) {
  connectionBadge.className = 'badge';
  if (status === 'connected') {
    connectionBadge.classList.add('badge-connected');
    badgeText.textContent = 'Connected';
  } else if (status === 'disconnected') {
    connectionBadge.classList.add('badge-disconnected');
    badgeText.textContent = 'Disconnected';
  } else {
    connectionBadge.classList.add('badge-disconnected');
    badgeText.textContent = status;
  }
}

// Generate Room ID
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// WS Connection Setup
function connectWS(clientType, roomId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  
  // Append password query parameter if auth token exists
  let wsUrl = `${protocol}//${window.location.host}/ws/${clientType}/${roomId}`;
  if (sessionPassword) {
    wsUrl += `?password=${encodeURIComponent(sessionPassword)}`;
  }
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    updateConnectionBadge('connected');
  };
  
  ws.onclose = (event) => {
    updateConnectionBadge('disconnected');
    if (event.code === 4001) {
      alert('Room already has an active streamer.');
      resetApp();
    } else if (event.code === 4003) {
      alert('Authentication failed: Invalid Password.');
      sessionStorage.removeItem('stream_password');
      window.location.reload();
    }
  };
  
  ws.onerror = () => {
    updateConnectionBadge('Error');
  };
  
  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'chat') {
      const container = isStreamer ? streamerChatMessages : viewerChatMessages;
      const isHost = data.sender === 'Host';
      appendChatMessage(container, data.sender, data.text, isHost);
      return;
    }
    
    if (isStreamer) {
      await handleStreamerMessage(data);
    } else {
      await handleViewerMessage(data);
    }
  };
}

// Helper to Append Chat Message
function appendChatMessage(container, sender, text, isHost) {
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg';
  
  if (sender.startsWith('System')) {
    msgEl.classList.add('system');
    msgEl.textContent = text;
  } else {
    if (isHost) {
      msgEl.classList.add('host');
    } else {
      msgEl.classList.add('viewer');
    }
    
    const senderEl = document.createElement('span');
    senderEl.className = 'msg-sender';
    senderEl.textContent = sender;
    
    const textEl = document.createElement('span');
    textEl.textContent = `: ${text}`;
    
    msgEl.appendChild(senderEl);
    msgEl.appendChild(textEl);
  }
  
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

// Send Chat Message
function sendChatMessage(inputElement, nicknameElement) {
  const text = inputElement.value.trim();
  if (!text || !ws) return;
  
  const senderName = nicknameElement.value.trim() || (isStreamer ? 'Host' : defaultViewerName);
  
  ws.send(JSON.stringify({
    type: 'chat',
    sender: senderName,
    text: text
  }));
  
  inputElement.value = '';
}

// Reset App State
function resetApp() {
  if (ws) {
    ws.close();
    ws = null;
  }
  
  stopScreenShare();
  
  // Close all peer connections for streamer
  peerConnections.forEach((pc) => pc.close());
  peerConnections.clear();
  activeViewerCount.textContent = '0';
  
  // Close viewer connection and clear streams
  if (viewerPeerConnection) {
    viewerPeerConnection.close();
    viewerPeerConnection = null;
  }
  viewerWebRTCStream = null;
  
  // Destroy HLS instance if active
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  
  if (vlcPollInterval) {
    clearInterval(vlcPollInterval);
    vlcPollInterval = null;
  }
  
  viewerSourceType = 'webrtc';
  btnToggleSourceType.classList.add('hidden');
  btnToggleSourceType.textContent = 'Switch to VLC Stream';
  viewerStreamTypeBadge.textContent = '(WebRTC)';
  
  // Clear videos
  streamerPreview.srcObject = null;
  viewerVideo.srcObject = null;
  viewerVideo.src = '';
  
  // Clear chats
  streamerChatMessages.innerHTML = '<div class="chat-msg system">System: Stream room created. Welcome to the chat!</div>';
  viewerChatMessages.innerHTML = '<div class="chat-msg system">System: Connected to the stream room. Chat is active.</div>';
  
  // Remove room query parameter
  const url = new URL(window.location);
  url.searchParams.delete('room');
  window.history.pushState({}, '', url);
  
  isStreamer = false;
  currentRoom = null;
  
  updateConnectionBadge('disconnected');
  showView(viewSelection);
}

// --- Broadcaster / Streamer Logic ---

async function initStreamer() {
  isStreamer = true;
  currentRoom = generateRoomCode();
  streamerRoomCode.textContent = currentRoom;
  
  showView(viewStreamer);
  connectWS('streamer', currentRoom);
  
  // Update state text
  streamStatusText.textContent = "Status: Capturing device...";
  
  // Trigger screen share dialog immediately for a better UX
  await startScreenShare();
}

async function startScreenShare() {
  const sourceType = streamerSourceSelect.value;
  
  try {
    if (sourceType === 'webcam') {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });
    } else {
      try {
        localStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: "always",
            frameRate: { ideal: 30, max: 60 }
          },
          audio: true
        });
      } catch (err) {
        console.warn("Retrying desktop capture with basic constraints for browser compatibility:", err);
        localStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
      }
    }
    
    streamerPreview.srcObject = localStream;
    streamerPlaceholder.classList.add('hidden');
    btnStartCapture.classList.add('hidden');
    btnStopCapture.classList.remove('hidden');
    streamPulse.classList.remove('hidden');
    
    const label = sourceType === 'webcam' ? 'camera' : 'screen';
    streamStatusText.textContent = `Status: Broadcasting ${label}`;
    
    // Listen for stream ended (e.g. browser's built-in "Stop sharing" button)
    localStream.getVideoTracks()[0].onended = () => {
      stopScreenShare();
    };
    
    // If we already have viewers connected, negotiate connection
    peerConnections.forEach((pc, viewerId) => {
      // Re-add tracks
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
      negotiateConnection(pc, viewerId);
    });
    
  } catch (err) {
    console.error("Error capturing screen: ", err);
    streamStatusText.textContent = "Status: Stream failed to start";
    alert("Could not start capture device. Please check permissions and try again.");
  }
}

function stopScreenShare() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  streamerPreview.srcObject = null;
  streamerPlaceholder.classList.remove('hidden');
  btnStartCapture.classList.remove('hidden');
  btnStopCapture.classList.add('hidden');
  streamPulse.classList.add('hidden');
  streamStatusText.textContent = "Status: Idle";
  
  // Remove tracks from existing peer connections
  peerConnections.forEach((pc) => {
    const senders = pc.getSenders();
    senders.forEach(sender => pc.removeTrack(sender));
  });
}

async function handleStreamerMessage(data) {
  const { type, viewer_id, sender_id, sdp, candidate } = data;
  
  if (type === 'viewer_joined') {
    // A new viewer wants to watch
    createPeerConnectionForViewer(viewer_id);
    activeViewerCount.textContent = peerConnections.size;
    appendChatMessage(streamerChatMessages, 'System', `Viewer (${viewer_id.substring(0, 4)}) joined the room.`);
  } 
  else if (type === 'viewer_left') {
    // Viewer left
    const pc = peerConnections.get(viewer_id);
    if (pc) {
      pc.close();
      peerConnections.delete(viewer_id);
    }
    activeViewerCount.textContent = peerConnections.size;
    appendChatMessage(streamerChatMessages, 'System', `Viewer (${viewer_id.substring(0, 4)}) left the room.`);
  } 
  else if (type === 'answer') {
    const pc = peerConnections.get(sender_id);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  } 
  else if (type === 'candidate') {
    const pc = peerConnections.get(sender_id);
    if (pc && candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }
}

function createPeerConnectionForViewer(viewerId) {
  const pc = new RTCPeerConnection(iceConfig);
  peerConnections.set(viewerId, pc);
  
  // Add tracks if active
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }
  
  pc.onicecandidate = (event) => {
    if (event.candidate && ws) {
      ws.send(JSON.stringify({
        type: 'candidate',
        candidate: event.candidate,
        target_id: viewerId
      }));
    }
  };
  
  negotiateConnection(pc, viewerId);
}

async function negotiateConnection(pc, viewerId) {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    if (ws) {
      ws.send(JSON.stringify({
        type: 'offer',
        sdp: offer,
        target_id: viewerId
      }));
    }
  } catch (err) {
    console.error("Negotiation error:", err);
  }
}

// --- Watcher / Viewer Logic ---

function initViewer(roomId) {
  if (!roomId) {
    alert("Please enter a room code.");
    return;
  }
  
  isStreamer = false;
  currentRoom = roomId.toUpperCase();
  viewerRoomTitle.textContent = currentRoom;
  
  showView(viewViewer);
  connectWS('viewer', currentRoom);
  
  // Set room query param in URL
  const url = new URL(window.location);
  url.searchParams.set('room', currentRoom);
  window.history.pushState({}, '', url);
  
  // Initialize video volume states
  viewerVideo.volume = viewerVolumeBar.value / 100;
  viewerVideo.muted = false; // Start unmuted
  btnToggleSound.textContent = 'Mute Audio';

  // Start polling to detect if a VLC stream becomes active on the server
  startVlcPoll();
}

function startVlcPoll() {
  if (vlcPollInterval) clearInterval(vlcPollInterval);
  
  const poll = async () => {
    try {
      const res = await fetch('/api/stream/info');
      const data = await res.json();
      
      if (data.available) {
        btnToggleSourceType.classList.remove('hidden');
      } else {
        btnToggleSourceType.classList.add('hidden');
        // If VLC stream is active but goes away, fall back to WebRTC
        if (viewerSourceType === 'vlc') {
          switchViewerSource('webrtc');
        }
      }
    } catch (err) {
      console.error("VLC HLS stream check failed:", err);
    }
  };
  
  poll();
  vlcPollInterval = setInterval(poll, 4000);
}

// Switch stream source type between WebRTC and VLC HLS
function switchViewerSource(type) {
  if (type === viewerSourceType) return;
  
  viewerSourceType = type;
  
  if (type === 'vlc') {
    // Switch to VLC HLS Stream
    viewerVideo.srcObject = null;
    viewerStreamTypeBadge.textContent = '(VLC HLS Stream)';
    btnToggleSourceType.textContent = 'Switch to WebRTC';
    
    const hlsUrl = '/hls/stream.m3u8';
    
    if (Hls.isSupported()) {
      if (hlsInstance) hlsInstance.destroy();
      
      hlsInstance = new Hls();
      hlsInstance.loadSource(hlsUrl);
      hlsInstance.attachMedia(viewerVideo);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        viewerVideo.play().catch(e => console.log("Playback error:", e));
        viewerPlaceholder.classList.add('hidden');
      });
      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error("HLS fatal error:", data.type);
          viewerPlaceholderText.textContent = "Loading VLC HLS feed segments...";
          viewerPlaceholder.classList.remove('hidden');
        }
      });
    } else if (viewerVideo.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (e.g. Safari)
      viewerVideo.src = hlsUrl;
      viewerVideo.addEventListener('loadedmetadata', () => {
        viewerVideo.play().catch(e => console.log("Playback error:", e));
        viewerPlaceholder.classList.add('hidden');
      });
    } else {
      alert("HLS playback is not supported on this browser.");
      switchViewerSource('webrtc');
    }
  } else {
    // Switch back to WebRTC stream
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    viewerVideo.src = '';
    viewerStreamTypeBadge.textContent = '(WebRTC)';
    btnToggleSourceType.textContent = 'Switch to VLC Stream';
    
    if (viewerWebRTCStream) {
      viewerVideo.srcObject = viewerWebRTCStream;
      viewerPlaceholder.classList.add('hidden');
    } else {
      viewerVideo.srcObject = null;
      viewerPlaceholderText.textContent = "Waiting for host to share screen...";
      viewerPlaceholder.classList.remove('hidden');
    }
  }
}

async function handleViewerMessage(data) {
  const { type, sdp, candidate } = data;
  
  if (type === 'streamer_connected') {
    viewerPlaceholderText.textContent = "Waiting for host to share screen...";
    appendChatMessage(viewerChatMessages, 'System', 'Broadcaster connected.');
  } 
  else if (type === 'streamer_disconnected') {
    viewerPlaceholderText.textContent = "Streamer offline. Waiting for host...";
    viewerPlaceholder.classList.remove('hidden');
    if (viewerPeerConnection) {
      viewerPeerConnection.close();
      viewerPeerConnection = null;
    }
    viewerWebRTCStream = null;
    if (viewerSourceType === 'webrtc') {
      viewerVideo.srcObject = null;
    }
    appendChatMessage(viewerChatMessages, 'System', 'Broadcaster went offline.');
  } 
  else if (type === 'offer') {
    viewerPlaceholderText.textContent = "Establishing live stream connection...";
    await createPeerConnectionForStreamer(sdp);
  } 
  else if (type === 'candidate') {
    if (viewerPeerConnection && candidate) {
      await viewerPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }
}

async function createPeerConnectionForStreamer(offerSdp) {
  if (viewerPeerConnection) {
    viewerPeerConnection.close();
  }
  
  viewerPeerConnection = new RTCPeerConnection(iceConfig);
  
  viewerPeerConnection.ontrack = (event) => {
    viewerWebRTCStream = event.streams[0];
    
    // Only mount directly if the user is in WebRTC mode
    if (viewerSourceType === 'webrtc') {
      viewerVideo.srcObject = viewerWebRTCStream;
      viewerPlaceholder.classList.add('hidden');
    }
  };
  
  viewerPeerConnection.onicecandidate = (event) => {
    if (event.candidate && ws) {
      ws.send(JSON.stringify({
        type: 'candidate',
        candidate: event.candidate
      }));
    }
  };
  
  await viewerPeerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp));
  const answer = await viewerPeerConnection.createAnswer();
  await viewerPeerConnection.setLocalDescription(answer);
  
  if (ws) {
    ws.send(JSON.stringify({
      type: 'answer',
      sdp: answer
    }));
  }
}

// Event Listeners

// Password Login Events
btnLoginSubmit.addEventListener('click', handleLogin);
loginPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLogin();
});

// Mode Selection Events
btnInitStreamer.addEventListener('click', initStreamer);
btnInitViewer.addEventListener('click', () => initViewer(joinRoomInput.value));
joinRoomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') initViewer(joinRoomInput.value);
});

btnStreamerBack.addEventListener('click', resetApp);
btnViewerBack.addEventListener('click', resetApp);

btnStartCapture.addEventListener('click', startScreenShare);
btnStopCapture.addEventListener('click', stopScreenShare);

btnCopyLink.addEventListener('click', () => {
  const shareUrl = `${window.location.origin}/?room=${currentRoom}`;
  navigator.clipboard.writeText(shareUrl).then(() => {
    const originalText = btnCopyLink.textContent;
    btnCopyLink.textContent = 'Copied!';
    setTimeout(() => {
      btnCopyLink.textContent = originalText;
    }, 2000);
  });
});

btnFullscreen.addEventListener('click', () => {
  if (viewerVideo.requestFullscreen) {
    viewerVideo.requestFullscreen();
  } else if (viewerVideo.webkitRequestFullscreen) { /* Safari */
    viewerVideo.webkitRequestFullscreen();
  } else if (viewerVideo.msRequestFullscreen) { /* IE11 */
    viewerVideo.msRequestFullscreen();
  }
});

btnToggleSound.addEventListener('click', () => {
  if (viewerVideo.muted) {
    viewerVideo.muted = false;
    btnToggleSound.textContent = 'Mute Audio';
    viewerVolumeBar.value = viewerVideo.volume * 100;
    viewerVolumeValue.textContent = `${Math.round(viewerVideo.volume * 100)}%`;
  } else {
    viewerVideo.muted = true;
    btnToggleSound.textContent = 'Unmute Audio';
    viewerVolumeBar.value = 0;
    viewerVolumeValue.textContent = `0%`;
  }
});

// Switch stream source type (WebRTC vs VLC HLS) button
btnToggleSourceType.addEventListener('click', () => {
  const targetType = viewerSourceType === 'webrtc' ? 'vlc' : 'webrtc';
  switchViewerSource(targetType);
});

// Viewer Volume Control Bar
viewerVolumeBar.addEventListener('input', (e) => {
  const vol = e.target.value;
  viewerVideo.volume = vol / 100;
  viewerVolumeValue.textContent = `${vol}%`;
  
  if (vol > 0) {
    viewerVideo.muted = false;
    btnToggleSound.textContent = 'Mute Audio';
  } else {
    viewerVideo.muted = true;
    btnToggleSound.textContent = 'Unmute Audio';
  }
});

// Broadcaster Chat events
btnStreamerChatSend.addEventListener('click', () => sendChatMessage(streamerChatInput, streamerNicknameInput));
streamerChatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage(streamerChatInput, streamerNicknameInput);
});

// Viewer Chat events
btnViewerChatSend.addEventListener('click', () => sendChatMessage(viewerChatInput, viewerNicknameInput));
viewerChatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage(viewerChatInput, viewerNicknameInput);
});

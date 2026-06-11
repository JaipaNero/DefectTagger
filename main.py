from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Request, Security, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import secrets
from contextlib import asynccontextmanager
from schemas import EvidenceMetadata, HandshakeRequest, PairingRequest, ClipboardRequest
from services import save_evidence_file, get_local_ip, UDPDiscovery, show_approval_popup, get_storage_path
from pydantic import ValidationError
import jwt
import uuid
import threading
import asyncio
import socket
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from firebase_sync import start_sync_service
from secure_secrets import encrypt_secrets, decrypt_secrets # SEC-04: Secure secrets at rest
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        RotatingFileHandler("server.log", maxBytes=5*1024*1024, backupCount=5),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Security & Config
CONFIG_DIR = Path("config")
CONFIG_DIR.mkdir(exist_ok=True)
SECRETS_FILE = CONFIG_DIR / "secrets.env"

class SecretManager:
    """Manages persistent security tokens to survive restarts."""
    def __init__(self):
        self.setup_token, self.secret_key = self._load_or_create()

    def _load_or_create(self):
        try:
            if SECRETS_FILE.exists():
                try:
                    data = decrypt_secrets()
                    return data.get("setup_token"), data.get("secret_key")
                except Exception as e:
                    logger.warning(f"Secrets file corrupted or unreadable: {e}. Regenerating.")
            
            # SEC-04: Generate and encrypt secrets using utility
            setup = secrets.token_urlsafe(32)
            key = secrets.token_hex(32)
            encrypt_secrets({"setup_token": setup, "secret_key": key})
            
            return setup, key
        except PermissionError:
            logger.critical("Fatal: No write permission in hub directory. Security tokens cannot be persisted.")
            # Fallback to in-memory only (safe but session will reset on Hub restart)
            return secrets.token_urlsafe(32), secrets.token_hex(32)
        except Exception as e:
            logger.error(f"Secret generation error: {e}")
            return secrets.token_urlsafe(32), secrets.token_hex(32)

secrets_mgr = SecretManager()
SETUP_TOKEN = secrets_mgr.setup_token
SECRET_KEY = secrets_mgr.secret_key
ALGORITHM = "HS256"

security = HTTPBearer()

class SessionStore:
    """Thread-safe session storage with auto-cleanup."""
    def __init__(self):
        self._sessions = {}
    
    def add(self, tech_id: str, expires: datetime):
        self._cleanup()
        self._sessions[tech_id] = {"expires": expires}
        
    def validate(self, tech_id: str) -> bool:
        if tech_id not in self._sessions:
            return False
        if datetime.now(ZoneInfo("Europe/Amsterdam")) > self._sessions[tech_id]["expires"]:
            del self._sessions[tech_id]
            return False
        return True
    
    def _cleanup(self):
        """Removes expired sessions."""
        now = datetime.now(ZoneInfo("Europe/Amsterdam"))
        self._sessions = {k: v for k, v in self._sessions.items() if v["expires"] > now}

SESSIONS = SessionStore()

def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        tech_id = payload.get("sub")
        if not tech_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        
        if not SESSIONS.validate(tech_id):
            raise HTTPException(status_code=401, detail="Session expired or invalid")
            
        return tech_id
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

# Pairing Requests Store
# Key: request_id, Value: { "status": "pending"|"approved"|"denied", "ts": datetime }
MAX_PAIRING_REQUESTS = 50       # SEC-06: Hard cap on concurrent requests
PAIRING_TTL_SECONDS = 300       # SEC-06: 5 minute expiry
_pairing_lock = threading.Lock()
_pairing_store = {}

class _PairingStoreProxy:
    """Dict-like proxy with thread-safe access to the pairing store."""
    def __contains__(self, key):
        with _pairing_lock:
            return key in _pairing_store
    def __getitem__(self, key):
        with _pairing_lock:
            return dict(_pairing_store[key])  # Return a copy
    def __setitem__(self, key, value):
        with _pairing_lock:
            _pairing_store[key] = value
    def get(self, key, default=None):
        with _pairing_lock:
            v = _pairing_store.get(key)
            return dict(v) if v is not None else default
    def __len__(self):
        with _pairing_lock:
            return len(_pairing_store)
    def items(self):
        with _pairing_lock:
            return [(k, dict(v)) for k, v in _pairing_store.items()]
    def update_status(self, key, status):
        with _pairing_lock:
            if key in _pairing_store:
                _pairing_store[key]["status"] = status

PAIRING_REQUESTS = _PairingStoreProxy()

def cleanup_pairing_requests():
    """SEC-06: Evicts expired pairing requests and enforces max-size."""
    now = datetime.now()
    with _pairing_lock:
        expired = [k for k, v in _pairing_store.items()
                   if (now - v["ts"]).total_seconds() > PAIRING_TTL_SECONDS]
        for k in expired:
            del _pairing_store[k]

import threading
import queue
from server_dashboard import start_dashboard

# Activity log queue for GUI
LOG_QUEUE = queue.Queue()

class GUIHandler(logging.Handler):
    def emit(self, record):
        msg = self.format(record)
        LOG_QUEUE.put(msg)

# Update logger to send messages to GUI
logger.addHandler(GUIHandler())

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    global udp_service
    ip = get_local_ip()
    port = 8000
    
    # Start UDP Discovery
    udp_service = UDPDiscovery()
    udp_service.daemon = True
    udp_service.start()
    
    logger.info(f"Server starting on {ip}:{port}")
    logger.info("Zero-Touch Auto-Connection active.")
    
    yield
    # Shutdown logic
    if udp_service:
        udp_service.stop()

# SEC-10: Thread-safe Rate Limiter with bounded memory
class RateLimiter:
    def __init__(self, requests: int, window: int, max_clients: int = 10000):
        self.requests = requests
        self.window = window
        self.max_clients = max_clients
        self._lock = threading.Lock()
        self.clients = {}

    def is_allowed(self, client_ip: str) -> bool:
        now = time.time()
        with self._lock:
            if client_ip not in self.clients:
                # Evict oldest entry if at capacity
                if len(self.clients) >= self.max_clients:
                    oldest_ip = min(self.clients, key=lambda k: self.clients[k][-1] if self.clients[k] else 0)
                    del self.clients[oldest_ip]
                self.clients[client_ip] = [now]
                return True
            
            # Remove expired timestamps
            self.clients[client_ip] = [t for t in self.clients[client_ip] if now - t < self.window]
            
            if len(self.clients[client_ip]) < self.requests:
                self.clients[client_ip].append(now)
                return True
            return False

upload_limiter = RateLimiter(requests=10, window=60) # 10 uploads/min
auth_limiter = RateLimiter(requests=5, window=60)   # 5 auth attempts/min

async def limit_auth(request: Request):
    client_ip = (request.client.host if request.client else "unknown")
    if not auth_limiter.is_allowed(client_ip):
         logger.warning(f"Rate Limit exceeded for handshake: {client_ip}")
         raise HTTPException(status_code=429, detail="Too many attempts. Please wait.")

async def limit_upload(request: Request):
    client_ip = (request.client.host if request.client else "unknown")
    if not upload_limiter.is_allowed(client_ip):
         logger.warning(f"Rate Limit exceeded for upload: {client_ip}")
         raise HTTPException(status_code=429, detail="Upload limit reached. Please wait.")

app = FastAPI(lifespan=lifespan, title="Local Sync Hub Secure")

# SEC-11: Formalize CORS — restrict to known origins
import os as _cors_os
_ALLOWED_ORIGINS = _cors_os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:8081"
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
)


@app.get("/")
async def health_check():
    """Endpoint for mobile app to verify server presence during network scan."""
    return {
        "status": "online",
        "version": "v2.0",
        "computer_name": socket.gethostname()
    }

@app.post("/auth/handshake", dependencies=[Depends(limit_auth)])
async def handshake(handshake_data: HandshakeRequest):
    """Exchanges a setup token for a session JWT."""

    if handshake_data.token != SETUP_TOKEN:
        logger.warning(f"Handshake failed: Invalid token from {handshake_data.technician_id}")
        raise HTTPException(status_code=401, detail="Invalid setup token")
    
    # Create session with 24h expiry
    expires = datetime.now(ZoneInfo("Europe/Amsterdam")) + timedelta(hours=24)
    SESSIONS.add(handshake_data.technician_id, expires)
    
    token_data = {
        "sub": handshake_data.technician_id,
        "exp": expires
    }
    access_token = jwt.encode(token_data, SECRET_KEY, algorithm=ALGORITHM)
    
    logger.info(f"Handshake successful for technician: {handshake_data.technician_id}")
    return {"access_token": access_token}

@app.get("/auth/verify")
async def verify(tech_id: str = Depends(get_current_user)):
    """Verifies if the current session is valid."""
    return {"status": "valid", "technician_id": tech_id}

@app.post("/auth/pair-request")
async def pair_request(request: PairingRequest):
    """Initiates a pairing request that requires manual approval on the server."""
    # SEC-06: Evict stale requests and enforce capacity
    cleanup_pairing_requests()
    if len(PAIRING_REQUESTS) >= MAX_PAIRING_REQUESTS:
        raise HTTPException(status_code=429, detail="Too many pending pairing requests. Try again later.")

    request_id = str(uuid.uuid4())
    PAIRING_REQUESTS[request_id] = {
        "device_name": request.device_name,
        "device_id": request.device_id,
        "status": "pending",
        "ts": datetime.now()
    }
    
    logger.info(f"Pairing request from {request.device_name} ({request.device_id})")
    
    # Show popup in a separate thread to not block the API
    def ask_user():
        if show_approval_popup(request.device_name, request.device_id):
            PAIRING_REQUESTS.update_status(request_id, "approved")
            logger.info(f"Pairing APPROVED for {request.device_name}")
        else:
            PAIRING_REQUESTS.update_status(request_id, "denied")
            logger.info(f"Pairing DENIED for {request.device_name}")

    threading.Thread(target=ask_user, daemon=True).start()
    
    return {"request_id": request_id, "status": "pending"}

@app.get("/auth/pair-status")
async def pair_status(request_id: str):
    """Polls the status of a pairing request. Returns a scoped, short-lived token on approval."""
    req = PAIRING_REQUESTS.get(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    
    if req["status"] == "approved":
        # SEC-12: Return a scoped pairing token instead of the raw SETUP_TOKEN
        scoped_token = jwt.encode(
            {
                "type": "pairing",
                "request_id": request_id,
                "device_id": req.get("device_id", ""),
                "exp": datetime.now(ZoneInfo("Europe/Amsterdam")) + timedelta(minutes=5),
            },
            SECRET_KEY,
            algorithm=ALGORITHM,
        )
        return {"status": "approved", "setup_token": scoped_token}
    elif req["status"] == "denied":
        raise HTTPException(status_code=403, detail="Pairing request denied")
    
    return {"status": "pending"}

@app.post("/clipboard")
async def set_pc_clipboard(
    request: ClipboardRequest,
    tech_id: str = Depends(get_current_user)
):
    """Securely copies the scanned barcode text to the PC clipboard."""
    text = request.text
    logger.info(f"Clipboard sync request from {tech_id}: copying {len(text)} chars")
    
    try:
        import platform
        import subprocess
        
        system = platform.system()
        if system == 'Darwin':  # macOS
            process = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
            process.communicate(input=text.encode('utf-8'))
        elif system == 'Windows':
            process = subprocess.Popen(['clip'], stdin=subprocess.PIPE)
            process.communicate(input=text.encode('utf-8'))
        else:  # Linux
            try:
                process = subprocess.Popen(['xclip', '-selection', 'clipboard'], stdin=subprocess.PIPE)
                process.communicate(input=text.encode('utf-8'))
            except FileNotFoundError:
                process = subprocess.Popen(['xsel', '--clipboard', '--input'], stdin=subprocess.PIPE)
                process.communicate(input=text.encode('utf-8'))
                
        logger.info("Successfully copied to PC clipboard")
        return {"status": "success", "message": "Copied to PC clipboard"}
    except Exception as e:
        logger.error(f"Failed to copy to clipboard: {e}")
        raise HTTPException(status_code=500, detail="Clipboard operation failed")

@app.post("/upload-evidence", dependencies=[Depends(limit_upload)])
async def upload_evidence(
    file: UploadFile = File(...),
    metadata: str = Form(...),
    tech_id: str = Depends(get_current_user)
):
    """Securely handles evidence file uploads with session verification."""
    
    start_time = datetime.now()

    
    try:
        # 1. Parse Metadata
        meta_json = json.loads(metadata)
        meta_obj = EvidenceMetadata(**meta_json)
        
        # 2. Identity Check (Ensure technician matches session)
        if meta_obj.technician_id != tech_id:
             logger.error(f"Security Alert: Technician mismatch! Session: {tech_id}, Meta: {meta_obj.technician_id}")
             raise HTTPException(status_code=403, detail="Technician ID mismatch")
        
        # 3. Process & Save
        saved_path = save_evidence_file(file.file, file.filename, meta_obj)
        
        duration = (datetime.now() - start_time).total_seconds() * 1000
        logger.info(f"Evidence saved from {tech_id}: {Path(saved_path).name} ({int(duration)}ms)")
        
        return {
            "status": "success",
            "file_path": saved_path,
            "processing_time_ms": int(duration)
        }
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid metadata JSON")
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors())
    except ValueError as e:
        logger.error(f"Upload blocked: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Internal upload error")
        raise HTTPException(status_code=500, detail="Internal server error")

if __name__ == "__main__":
    import uvicorn
    ip = get_local_ip()
    
    # Start FastAPI in a separate thread
    def run_server():
        ssl_cert = Path("config/ssl/server.crt")
        ssl_key = Path("config/ssl/server.key")
        
        if ssl_cert.exists() and ssl_key.exists():
            logger.info("SSL Certificates found. Starting in HTTPS mode.")
            uvicorn.run(
                app, 
                host="0.0.0.0", 
                port=8000, 
                log_level="info",
                ssl_certfile=str(ssl_cert),
                ssl_keyfile=str(ssl_key)
            )
        else:
            logger.warning("SSL Certificates NOT found. Falling back to HTTP.")
            uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")

    api_thread = threading.Thread(target=run_server, daemon=True)
    api_thread.start()
    
    # Start Firebase Sync Background Process
    def run_sync():
        try:
            start_sync_service(str(get_storage_path()))
        except Exception as e:
            logger.error(f"Sync Service Startup Error: {e}")

    sync_thread = threading.Thread(target=run_sync, daemon=True)
    sync_thread.start()
    
    # Start Dashboard in main thread (required by Tkinter)
    start_dashboard(ip, LOG_QUEUE, setup_token=SETUP_TOKEN)

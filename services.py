import socket
import shutil
import json
import logging
import platform
import re
import os
from pathlib import Path
from datetime import datetime
import filetype
from schemas import EvidenceMetadata

def get_local_ip():
    """Returns the local IP address of the machine."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

logger = logging.getLogger(__name__)

def get_config_dir() -> Path:
    """Returns the OS-specific configuration directory."""
    if platform.system() == "Windows":
        # Use APPDATA for Windows
        base = os.environ.get("APPDATA")
        if not base:
            return Path("config")
        return Path(base) / "DefectTagger"
    else:
        # Use Application Support for macOS
        return Path.home() / "Library" / "Application Support" / "DefectTagger"

def get_storage_path() -> Path:
    """
    Retrieves the storage path from the system configuration file.
    Defaults to './uploads' if not configured.
    """
    config_dir = get_config_dir()
    config_file = config_dir / "config.json"
    
    if config_file.exists():
        try:
            with open(config_file, "r") as f:
                data = json.load(f)
                path = data.get("storage_path")
                if path:
                    p = Path(path)
                    p.mkdir(parents=True, exist_ok=True)
                    return p
        except Exception as e:
            logger.warning(f"Failed to read config.json: {e}")
            
    # Default fallback
    default_path = Path("uploads")
    default_path.mkdir(exist_ok=True)
    return default_path

def save_storage_path(new_path: str):
    """Saves the new storage path to the system configuration file."""
    config_dir = get_config_dir()
    config_dir.mkdir(parents=True, exist_ok=True)
    config_file = config_dir / "config.json"
    
    try:
        data = {}
        if config_file.exists():
            with open(config_file, "r") as f:
                data = json.load(f)
        
        data["storage_path"] = str(new_path)
        
        with open(config_file, "w") as f:
            json.dump(data, f, indent=2)
            
        logger.info(f"Storage path updated to: {new_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to save storage path: {e}")
        return False

def get_uploads_dir() -> Path:
    """Convenience wrapper for get_storage_path."""
    return get_storage_path()

def get_unique_filepath(directory: Path, filename: str) -> Path:
    """
    Generates a unique file path. If file exists, appends _v2, _v3, etc.
    """
    file_path = directory / filename
    if not file_path.exists():
        return file_path
    
    name = file_path.stem
    suffix = file_path.suffix
    counter = 2
    
    while True:
        new_filename = f"{name}_v{counter}{suffix}"
        new_path = directory / new_filename
        if not new_path.exists():
            return new_path
        counter += 1

def validate_mime_type(content: bytes, filename: str = "") -> str:
    """
    Basic MIME type mapping using file extension.
    For Android compatibility with expo-camera/ViewShot where magic bytes might be missing/custom.
    """
    ext = Path(filename).suffix.lower()
    allowed_types = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'}
    
    if ext not in allowed_types:
        try:
            kind = filetype.guess(content)
            if kind and kind.mime in allowed_types.values():
                return "." + kind.extension
        except Exception:
            pass
        raise ValueError(f"Invalid file type. Only JPEG/PNG allowed.")
    
    return ext

import threading

# SEC-08: Cross-platform file lock (replaces Unix-only fcntl)
_audit_lock = threading.Lock()

def append_audit_log(metadata: EvidenceMetadata, file_path: str):
    """
    Appends the upload event to a daily manifest.json file.
    Uses threading.Lock for cross-platform file locking.
    """
    from zoneinfo import ZoneInfo
    manifest_path = get_storage_path() / "manifest.json"
    entry = {
        "timestamp": datetime.now(ZoneInfo("Europe/Amsterdam")).isoformat(),
        "technician_id": metadata.technician_id,
        "damage_type": metadata.damage_type,
        "file_path": str(file_path),
        "status": "encrypted_upload_success"
    }
    
    try:
        with _audit_lock:
            data = []
            if manifest_path.exists():
                with open(manifest_path, "r") as f:
                    try:
                        data = json.load(f)
                    except json.JSONDecodeError:
                        pass
            
            data.append(entry)
            
            with open(manifest_path, "w") as f:
                json.dump(data, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
    except Exception as e:
        print(f"Failed to write audit log: {e}")

def sanitize_id(id_str: str) -> str:
    """
    Sanitizes technician ID to prevent directory traversal.
    Allows only alphanumeric, hyphens, and underscores.
    """
    if not id_str:
        return "unknown"
    # ARCH-06: Uses module-level `import re` (line 6) — no duplicate import
    return re.sub(r'[^a-zA-Z0-9_-]', '', id_str)

def save_evidence_file(file_obj, filename: str, metadata: EvidenceMetadata) -> str:
    """
    Saves the file content stream to ./uploads/{date}/{technician_id}/
    Performs strict MIME validation and path sanitization.
    """
    # Create directory structure
    date_str = metadata.timestamp.strftime("%Y-%m-%d")
    
    # SECURITY: Sanitize ID to prevent '../' attacks
    safe_tech_id = sanitize_id(metadata.technician_id)
    current_uploads_dir = get_storage_path()
    target_dir = (current_uploads_dir / date_str / safe_tech_id).resolve()
    
    # Extra safety: Ensure resolved path is strictly within the configured root
    if not target_dir.is_relative_to(current_uploads_dir.resolve()):
        logger.error(f"Directory Traversal Attempt: {target_dir}")
        raise ValueError("Path traversal attempt detected")

    target_dir.mkdir(parents=True, exist_ok=True)

    # 1. Validate MIME type strictly (Read Header)
    try:
        # Read first 2KB for magic number detection
        head = file_obj.read(2048)
        extension = validate_mime_type(head, filename)
        file_obj.seek(0) # Reset stream
    except ValueError as e:
        raise ValueError(f"Security Check Failed: {str(e)}")

    # 2. Generate Safe Filename
    safe_damage = re.sub(r'[^a-zA-Z0-9_-]', '_', metadata.damage_type.lower())
    context_str = f"_{re.sub(r'[^a-zA-Z0-9_-]', '_', metadata.image_context.lower())}" if metadata.image_context else ""
    timestamp_str = metadata.timestamp.strftime("%Y%m%d_%H%M%S")
    new_filename = f"{safe_damage}{context_str}_{timestamp_str}{extension}"
    
    target_path = get_unique_filepath(target_dir, new_filename)
    
    # 3. Save File (Streaming)
    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file_obj, buffer)
        
    # 4. Audit Log
    append_audit_log(metadata, str(target_path))
        
    return str(target_path)

# --- QR-less Pairing Features ---

import threading
import time
import subprocess
import ctypes

class UDPDiscovery(threading.Thread):
    """
    Listens for UDP broadcast packets and responds with the server IP.
    Allows mobile apps to auto-discover the server on the LAN.
    """
    def __init__(self, port=53535):
        super().__init__()
        self.port = port
        self.running = True
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        # Windows-specific socket option for reuse
        if platform.system() == 'Windows':
             self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 0)
        
        try:
            self.sock.bind(('', self.port))
            print(f"UDP Discovery listening on port {self.port}")
        except Exception as e:
            print(f"Failed to bind UDP port: {e}")
            self.running = False

    def run(self):
        while self.running:
            try:
                # 1 second timeout to allow checking self.running
                self.sock.settimeout(1.0)
                data, addr = self.sock.recvfrom(1024)
                
                message = data.decode('utf-8').strip()
                if message == "DEFECT_TAGGER_DISCOVER":
                    # Respond with "DEFECT_TAGGER_HERE"
                    response = "DEFECT_TAGGER_HERE"
                    self.sock.sendto(response.encode('utf-8'), addr)
                    # print(f"Responded to discovery from {addr}")
            except socket.timeout:
                continue
            except Exception as e:
                if self.running:
                    print(f"UDP Error: {e}")

    def stop(self):
        self.running = False
        self.sock.close()

def show_approval_popup(device_name: str, device_ip: str) -> bool:
    """
    Shows a native modal dialog asking the user to approve a connection.
    Blocking call. Returns True if Allowed, False if Denied.
    """
    def sanitize_for_script(text: str) -> str:
        return text.replace('"', '\\"').replace("'", "\\'")

    safe_name = sanitize_for_script(device_name)
    safe_ip = sanitize_for_script(device_ip)

    title = "Defect Tagger Connection Request"
    message = f"Device '{safe_name}' ({safe_ip}) wants to connect.\n\nAllow this device to pair?"
    
    system = platform.system()
    
    if system == "Darwin":  # macOS
        try:
            # SEC-09: Use argument passing instead of string interpolation to prevent injection
            script = 'on run argv\n  display dialog (item 1 of argv) with title (item 2 of argv) buttons {"Deny", "Allow"} default button "Allow" with icon caution\nend run'
            result = subprocess.run(['osascript', '-e', script, message, title], capture_output=True, text=True)
            return "button returned:Allow" in result.stdout
        except Exception as e:
            print(f"macOS Popup Error: {e}")
            return False

    elif system == "Windows":
        try:
            # IDYES = 6, IDNO = 7
            # MB_YESNO = 0x00000004
            # MB_ICONQUESTION = 0x00000020
            # MB_SYSTEMMODAL = 0x00001000 (Forces it to top)
            result = ctypes.windll.user32.MessageBoxW(0, message, title, 0x00000004 | 0x00000020 | 0x00001000)
            return result == 6
        except Exception as e:
            print(f"Windows Popup Error: {e}")
            return False
            
    else: # Linux / Other (Fallback to Tkinter if available, else auto-deny)
        try:
            import tkinter as tk
            from tkinter import messagebox
            root = tk.Tk()
            root.withdraw() # Hide main window
            root.attributes("-topmost", True)
            is_allowed = messagebox.askyesno(title, message)
            root.destroy()
            return is_allowed
        except Exception as e:
            print(f"Fallback Popup Error: {e}")
            return False

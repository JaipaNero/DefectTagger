"""
Verification script for the Security Refactor.
Tests: Handshake -> JWT Auth -> Raw Upload -> MIME Validation -> Audit Log.
"""
import os, json
from main import app, SETUP_TOKEN
from fastapi.testclient import TestClient
from services import UPLOADS_DIR

client = TestClient(app)

def test_full_flow():
    tech_id = "test_tech_01"
    
    # 1. Handshake: Exchange setup token for JWT
    resp = client.post(f"/auth/handshake?token={SETUP_TOKEN}&technician_id={tech_id}")
    assert resp.status_code == 200, f"Handshake failed: {resp.text}"
    
    data = resp.json()
    jwt_token = data["access_token"]
    print(f"TEST: Handshake successful. Got JWT.")
    
    # 2. Upload raw JPEG with JWT auth
    # Create a minimal valid JPEG (starts with FF D8 FF magic bytes)
    jpeg_header = bytes([
        0xFF, 0xD8, 0xFF, 0xE0,  # SOI + APP0 marker
        0x00, 0x10,               # Length
        0x4A, 0x46, 0x49, 0x46, 0x00,  # "JFIF\0"
        0x01, 0x01,               # Version
        0x00,                     # Units
        0x00, 0x01, 0x00, 0x01,   # Density
        0x00, 0x00,               # Thumbnail
        0xFF, 0xD9                # EOI
    ])
    
    metadata = {
        "technician_id": tech_id,
        "device_id": "test_device_001",
        "damage_type": "scratch",
        "timestamp": "2026-01-01T12:00:00",
        "gps_coords": "0,0"
    }
    
    files = {"file": ("test_evidence.jpg", jpeg_header, "image/jpeg")}
    
    resp = client.post(
        "/upload-evidence",
        files=files,
        data={"metadata": json.dumps(metadata)},
        headers={"Authorization": f"Bearer {jwt_token}"}
    )
    
    assert resp.status_code == 200, f"Upload failed: {resp.text}"
    print(f"TEST: Upload successful.")
    print(resp.json())
    
    # 3. Verify Audit Log
    manifest_path = UPLOADS_DIR / "manifest.json"
    assert manifest_path.exists(), f"Manifest not found at {manifest_path}"
    print(f"TEST: Manifest exists at {manifest_path}.")

if __name__ == "__main__":
    try:
        test_full_flow()
        print("VERIFICATION PASSED")
    except AssertionError as e:
        print(f"VERIFICATION FAILED: {e}")
    except Exception as e:
        print(f"VERIFICATION FAILED:\n{e}")

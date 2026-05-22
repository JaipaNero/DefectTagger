import requests
import socket
import threading
import time
import json
import uuid
from main import app, SETUP_TOKEN
import uvicorn

# We will run on a different port to avoid conflict with a possibly running server
TEST_PORT = 8002
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"

def run_server():
    uvicorn.run(app, host="127.0.0.1", port=TEST_PORT, log_level="error")

def test_endpoints():
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    time.sleep(3) # Wait for startup

    print(f"--- Verifying Defect Tagger Server at {BASE_URL} ---")
    errors = []
    
    # 1. Test Health Check
    try:
        response = requests.get(f"{BASE_URL}/")
        if response.status_code == 200:
            data = response.json()
            if data.get("version") == "v2.0":
                print("✅ [1/4] Health Check (v2.0): OK")
            else:
                errors.append(f"Version mismatch: {data.get('version')}")
        else:
            errors.append(f"Health check failed with status {response.status_code}")
    except Exception as e:
        errors.append(f"Health check error: {e}")

    # 2. Test Pairing Request
    request_id = None
    try:
        pair_data = {
            "device_name": "Test Device",
            "device_id": "test_id_123"
        }
        # Note: This will trigger a popup on the machine running this test!
        # For CI/Verification, we might need a way to auto-approve, but let's test the endpoint response.
        print("ℹ️  Triggering pairing request (Check for popup if running locally)...")
        response = requests.post(f"{BASE_URL}/auth/pair-request", json=pair_data)
        if response.status_code == 200:
            res_data = response.json()
            request_id = res_data.get("request_id")
            if request_id:
                print(f"✅ [2/4] Pairing Request: Created (ID: {request_id[:8]}...)")
            else:
                errors.append("Pairing request failed: No request_id returned")
        else:
            errors.append(f"Pairing request failed with status {response.status_code}")
    except Exception as e:
        errors.append(f"Pairing request error: {e}")

    # 3. Test Pair Status (should be pending)
    if request_id:
        try:
            response = requests.get(f"{BASE_URL}/auth/pair-status?request_id={request_id}")
            if response.status_code == 200:
                print(f"✅ [3/4] Pair Status (Pending): OK")
            else:
                 errors.append(f"Pair status failed with status {response.status_code}")
        except Exception as e:
            errors.append(f"Pair status error: {e}")

    # 4. Test Handshake with SETUP_TOKEN
    token = None
    try:
        handshake_data = {
            "token": SETUP_TOKEN,
            "technician_id": "test_tech_99"
        }
        response = requests.post(f"{BASE_URL}/auth/handshake", json=handshake_data)
        if response.status_code == 200:
            token = response.json().get("access_token")
            if token:
                print("✅ [4/5] Handshake & JWT Generation: OK")
            else:
                errors.append("Handshake failed: No token returned")
        else:
            errors.append(f"Handshake failed with status {response.status_code}: {response.text}")
    except Exception as e:
        errors.append(f"Handshake error: {e}")

    # 5. Test Clipboard Sync Endpoint
    if token:
        try:
            headers = {
                "Authorization": f"Bearer {token}"
            }
            clipboard_data = {
                "text": "TEST_IMEI_1234567890"
            }
            response = requests.post(f"{BASE_URL}/clipboard", json=clipboard_data, headers=headers)
            if response.status_code == 200:
                res_json = response.json()
                if res_json.get("status") == "success":
                    print("✅ [5/5] Clipboard Sync (via JWT): OK")
                else:
                    errors.append(f"Clipboard sync response status not success: {res_json}")
            else:
                errors.append(f"Clipboard sync failed with status {response.status_code}: {response.text}")
        except Exception as e:
            errors.append(f"Clipboard sync error: {e}")

    if errors:
        print("\n--- ❌ VERIFICATION FAILED ---")
        for err in errors:
            print(f"  - {err}")
        exit(1)
    else:
        print("\n--- 🎉 ALL BACKEND ENDPOINTS VERIFIED! ---")
        exit(0)

if __name__ == "__main__":
    test_endpoints()

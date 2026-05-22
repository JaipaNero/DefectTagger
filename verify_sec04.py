import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path.cwd()))

try:
    from main import SecretManager
    sm = SecretManager()
    print(f"✅ SecretManager initialized successfully.")
    print(f"Setup Token loaded (first 5 chars): {sm.setup_token[:5]}...")
    if len(sm.secret_key) == 64:
        print("✅ Secret Key has correct length (64 hex chars).")
except Exception as e:
    print(f"❌ Failed to load SecretManager: {e}")
    sys.exit(1)

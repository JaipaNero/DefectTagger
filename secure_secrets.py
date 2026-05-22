import json
import os
from pathlib import Path
from cryptography.fernet import Fernet

# SEC-04: Encrypt secrets at rest
CONFIG_DIR = Path("config")
SECRETS_FILE = CONFIG_DIR / "secrets.env"
MASTER_KEY_FILE = CONFIG_DIR / "master.key"

def _get_or_create_key():
    """Retrieves the master encryption key or generates a new one if missing."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if not MASTER_KEY_FILE.exists():
        key = Fernet.generate_key()
        MASTER_KEY_FILE.write_bytes(key)
        # Ensure only the current user can read/write the key
        MASTER_KEY_FILE.chmod(0o600)
    return MASTER_KEY_FILE.read_bytes()

def encrypt_secrets(secrets_dict: dict):
    """Encrypts a dictionary of secrets and saves to secrets.env."""
    key = _get_or_create_key()
    fernet = Fernet(key)
    
    json_data = json.dumps(secrets_dict).encode()
    encrypted_data = fernet.encrypt(json_data)
    
    SECRETS_FILE.write_bytes(encrypted_data)
    # Ensure file is only readable by current user
    SECRETS_FILE.chmod(0o600)

def decrypt_secrets() -> dict:
    """Decrypts the secrets.env file and returns the dictionary."""
    if not SECRETS_FILE.exists():
        raise FileNotFoundError("Secrets file 'config/secrets.env' not found.")
    
    key = _get_or_create_key()
    fernet = Fernet(key)
    
    encrypted_data = SECRETS_FILE.read_bytes()
    try:
        # Check if it's already encrypted (starts with Fernet prefix 'gAAAA')
        # Simple heuristic, alternatively just try to decrypt
        decrypted_json = fernet.decrypt(encrypted_data)
        return json.loads(decrypted_json)
    except Exception:
        # Fallback: if decryption fails, check if it's plain text (legacy)
        try:
            return json.loads(encrypted_data.decode())
        except json.JSONDecodeError:
            raise ValueError("Failed to decrypt secrets and file is not valid JSON.")

if __name__ == "__main__":
    # If run directly, offer to encrypt the current plain text secrets.env
    try:
        data = decrypt_secrets()
        print("Decrypting/Verifying current secrets...")
        encrypt_secrets(data)
        print("✅ secrets.env is now encrypted at rest.")
    except Exception as e:
        print(f"Error: {e}")

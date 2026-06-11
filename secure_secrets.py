import json
import os
from pathlib import Path
from cryptography.fernet import Fernet

# SEC-04: Encrypt secrets at rest
CONFIG_DIR = Path("config")
SECRETS_FILE = CONFIG_DIR / "secrets.env"
# SEC-04: Master key stored outside config dir for defense in depth
_KEY_HOME = Path.home() / ".defecttagger"
MASTER_KEY_FILE = _KEY_HOME / "master.key"

def _get_or_create_key():
    """Retrieves the master encryption key or generates a new one if missing."""
    MASTER_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not MASTER_KEY_FILE.exists():
        key = Fernet.generate_key()
        # Write with restricted permissions atomically where possible
        fd = os.open(str(MASTER_KEY_FILE), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.write(fd, key)
        finally:
            os.close(fd)
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
    except Exception as e:
        raise ValueError(
            f"Failed to decrypt secrets.env — the master key may have been rotated "
            f"or the file is corrupted. Do NOT use plain-text fallback. Error: {e}"
        )

if __name__ == "__main__":
    # If run directly, offer to encrypt the current plain text secrets.env
    try:
        data = decrypt_secrets()
        print("Decrypting/Verifying current secrets...")
        encrypt_secrets(data)
        print("✅ secrets.env is now encrypted at rest.")
    except Exception as e:
        print(f"Error: {e}")

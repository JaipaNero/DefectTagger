import secrets
import sys
from secure_secrets import encrypt_secrets

def rotate_secrets():
    print("WARNING: This will invalidate all existing QR codes and active sessions.")
    confirm = input("Type 'ROTATE' to confirm: ")
    
    if confirm != "ROTATE":
        print("Aborted.")
        sys.exit(0)
        
    print("Rotating secrets...")
    
    # SEC-04: Generate and use encryption utility
    new_setup = secrets.token_urlsafe(32)
    new_key = secrets.token_hex(32)
    encrypt_secrets({"setup_token": new_setup, "secret_key": new_key})
    
    print("✅ Secrets rotated and encrypted successfully.")
    print(f"New Setup Token generated. Restart the server to apply changes.")

if __name__ == "__main__":
    rotate_secrets()

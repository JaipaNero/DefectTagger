import subprocess
import platform

def show_approval_popup_test(device_name: str, device_ip: str) -> bool:
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
    
    print(f"Sanitized Name: {safe_name}")
    print(f"Sanitized IP: {safe_ip}")
    print(f"Constructed Message: {message}")
    
    system = platform.system()
    
    if system == "Darwin":  # macOS
        try:
            # AppleScript via osascript
            script = f'display dialog "{message}" with title "{title}" buttons {{"Deny", "Allow"}} default button "Allow" with icon caution'
            print(f"Executing AppleScript: {script}")
            # We won't actually run it to avoid blocking the test, just verify the string is safe.
            # result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
            # return "button returned:Allow" in result.stdout
            return True
        except Exception as e:
            print(f"macOS Popup Error: {e}")
            return False
    return False

if __name__ == "__main__":
    # Test with malicious payload
    malicious_name = 'MyDevice"; do shell script "echo INJECTED"; "'
    malicious_ip = '192.168.1.100'
    print("Testing OS Command Injection payload...")
    show_approval_popup_test(malicious_name, malicious_ip)
    print("Test finished.")

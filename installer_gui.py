import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import os
import shutil
import sys
import subprocess
from pathlib import Path

import platform
import tempfile

# Installer Settings
APP_NAME = "Defect Tagger Server"
EXECUTABLE_NAME = "LocalSyncHub.exe" if platform.system() == "Windows" else "LocalSyncHub"

if platform.system() == "Windows":
    DEFAULT_INSTALL_DIR = os.path.join(os.environ["LOCALAPPDATA"], "Programs", "DefectTagger")
    CONFIG_DIR = os.path.join(os.environ["APPDATA"], "DefectTagger")
else:
    DEFAULT_INSTALL_DIR = os.path.join(str(Path.home()), "Applications", "DefectTagger")
    CONFIG_DIR = os.path.join(str(Path.home()), "Library", "Application Support", "DefectTagger")

def get_source_executable():
    """Locate the backend executable to copy."""
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle
        # Method 1: PyInstaller might unpack to _MEIPASS, but --onefile typically keeps 
        # the payload inside the exe or in a temp dir.
        # If we bundle it as --add-data, it will be in sys._MEIPASS.
        # Let's assume we use --add-data "dist/LocalSyncHub:."
        base_path = sys._MEIPASS
    else:
        # Running as script
        base_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
    
    exe_path = os.path.join(base_path, EXECUTABLE_NAME)
    return exe_path

def create_desktop_shortcut(target_path, link_name):
    """Create a symlink on the user's Desktop (macOS/Linux)."""
    desktop = os.path.join(str(Path.home()), "Desktop")
    
    if platform.system() == "Windows":
        link_name = link_name + ".lnk"
        link_path = os.path.join(desktop, link_name)
        return create_windows_shortcut(target_path, link_path)
    else:
        link_path = os.path.join(desktop, link_name)
        try:
            if os.path.exists(link_path):
                os.remove(link_path)
            os.symlink(target_path, link_path)
            return True, link_path
        except Exception as e:
            return False, str(e)

def create_windows_shortcut(target_path, link_path):
    """Create a Windows shortcut (.lnk) using VBScript to avoid dependencies."""
    vbs_script = f"""
    Set oWS = WScript.CreateObject("WScript.Shell")
    Set oLink = oWS.CreateShortcut("{link_path}")
    oLink.TargetPath = "{target_path}"
    oLink.WorkingDirectory = "{os.path.dirname(target_path)}"
    oLink.Save
    """
    try:
        vbs_path = os.path.join(tempfile.gettempdir(), "create_shortcut.vbs")
        with open(vbs_path, "w") as f:
            f.write(vbs_script)
        subprocess.run(["cscript", "//Nologo", vbs_path], check=True)
        os.remove(vbs_path)
        return True, link_path
    except Exception as e:
        return False, str(e)

def save_config(storage_path):
    """Save storage path to Application Support config.json."""
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        config_path = os.path.join(CONFIG_DIR, "config.json")
        import json
        with open(config_path, "w") as f:
            json.dump({"storage_path": storage_path}, f)
        return True, config_path
    except Exception as e:
        return False, str(e)

class InstallerApp:
    def __init__(self, root):
        self.root = root
        self.root.title(f"{APP_NAME} Installer")
        self.root.geometry("500x450")
        self.root.resizable(False, False)
        
        # Style
        style = ttk.Style()
        style.configure("TButton", font=("Helvetica", 12))
        style.configure("TLabel", font=("Helvetica", 11))
        
        # Header
        header_frame = tk.Frame(root, bg="#333", height=60)
        header_frame.pack(fill=tk.X)
        header_label = tk.Label(header_frame, text=f"Install {APP_NAME}", font=("Helvetica", 18, "bold"), fg="white", bg="#333")
        header_label.pack(pady=15)
        
        # Content
        content_frame = tk.Frame(root, padx=20, pady=20)
        content_frame.pack(fill=tk.BOTH, expand=True)
        
        # Install Location
        tk.Label(content_frame, text="Install Location:", font=("Helvetica", 12, "bold")).pack(anchor=tk.W, pady=(0, 5))
        
        path_frame = tk.Frame(content_frame)
        path_frame.pack(fill=tk.X, pady=(0, 20))
        
        self.install_path_var = tk.StringVar(value=DEFAULT_INSTALL_DIR)
        self.path_entry = ttk.Entry(path_frame, textvariable=self.install_path_var)
        self.path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))
        
        browse_btn = ttk.Button(path_frame, text="Browse...", command=self.browse_folder)
        browse_btn.pack(side=tk.RIGHT)
        
        # Storage Location
        tk.Label(content_frame, text="Storage Folder for Uploads:", font=("Helvetica", 12, "bold")).pack(anchor=tk.W, pady=(10, 5))
        
        storage_frame = tk.Frame(content_frame)
        storage_frame.pack(fill=tk.X, pady=(0, 20))
        
        # Default storage: ~/Documents/DefectTagger_Uploads
        # Default storage logic
        if platform.system() == "Windows":
             default_storage = os.path.join(str(Path.home()), "Documents", "DefectTagger_Uploads")
        else:
             default_storage = os.path.join(str(Path.home()), "Documents", "DefectTagger_Uploads")
             
        self.storage_path_var = tk.StringVar(value=default_storage)
        self.storage_entry = ttk.Entry(storage_frame, textvariable=self.storage_path_var)
        self.storage_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))
        
        browse_storage_btn = ttk.Button(storage_frame, text="Browse...", command=self.browse_storage_folder)
        browse_storage_btn.pack(side=tk.RIGHT)

        # Options
        self.shortcut_var = tk.BooleanVar(value=True)
        shortcut_check = ttk.Checkbutton(content_frame, text="Create Desktop Shortcut", variable=self.shortcut_var)
        shortcut_check.pack(anchor=tk.W, pady=(0, 20))
        
        # Actions
        self.install_btn = ttk.Button(content_frame, text="Install", command=self.install)
        self.install_btn.pack(pady=10)
        
        self.status_label = tk.Label(content_frame, text="", fg="gray")
        self.status_label.pack(pady=5)
        
    def browse_folder(self):
        folder = filedialog.askdirectory(initialdir=self.install_path_var.get())
        if folder:
            # If user picks a generic folder, append /DefectTagger
            if not folder.endswith("DefectTagger"):
                folder = os.path.join(folder, "DefectTagger")
            self.install_path_var.set(folder)

    def browse_storage_folder(self):
        folder = filedialog.askdirectory(initialdir=self.storage_path_var.get())
        if folder:
            self.storage_path_var.set(folder)

    def install(self):
        dest_dir = self.install_path_var.get()
        source_exe = get_source_executable()
        
        if not os.path.exists(source_exe):
            messagebox.showerror("Error", f"Source executable not found:\n{source_exe}\n\nPlease build the backend first.")
            return
            
        try:
            self.status_label.config(text="Creating directory...", fg="blue")
            self.root.update()
            
            # Create Install Dir
            os.makedirs(dest_dir, exist_ok=True)
            
            # Copy Executable
            self.status_label.config(text="Copying files...", fg="blue")
            self.root.update()
            dest_exe = os.path.join(dest_dir, EXECUTABLE_NAME)
            shutil.copy2(source_exe, dest_exe)
            
            # Make executable (just in case)
            os.chmod(dest_exe, 0o755)
            
            # Create Shortcut
            if self.shortcut_var.get():
                self.status_label.config(text="Creating shortcut...", fg="blue")
                self.root.update()
                success, msg = create_desktop_shortcut(dest_exe, APP_NAME)
                if not success:
                    print(f"Failed to create shortcut: {msg}") # Non-fatal
            
            # Save Config
            self.status_label.config(text="Saving configuration...", fg="blue")
            self.root.update()
            storage_path = self.storage_path_var.get()
            success, msg = save_config(storage_path)
            if not success:
                 messagebox.showwarning("Warning", f"Failed to save configuration:\n{msg}\nUsing default defaults.")

            self.status_label.config(text="Installation Complete!", fg="green")
            messagebox.showinfo("Success", f"{APP_NAME} installed successfully to:\n{dest_dir}")
            self.root.destroy()
            
        except Exception as e:
            self.status_label.config(text="Installation Failed", fg="red")
            messagebox.showerror("Error", f"Installation failed:\n{str(e)}")

if __name__ == "__main__":
    try:
        root = tk.Tk()
        app = InstallerApp(root)
        root.mainloop()
    except Exception as e:
        # Fallback if tkinter fails completely
        print(f"GUI Error: {e}")

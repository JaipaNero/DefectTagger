import tkinter as tk
from tkinter import ttk
import socket
import platform
import threading
import time
from pathlib import Path
from tkinter import filedialog, messagebox
import qrcode
from PIL import Image, ImageTk
import json
from services import get_storage_path, save_storage_path

class ServerDashboard:
    def __init__(self, root, ip_address, port=8000, setup_token=None):
        self.root = root
        self.ip_address = ip_address
        self.port = port
        self.setup_token = setup_token
        self.root.title("Defect Tagger Hub")
        self.root.geometry("500x550")
        self.root.configure(bg="#1C1C1E")
        self.root.resizable(False, False)

        self._setup_styles()
        self._create_widgets()
        
    def _setup_styles(self):
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("Status.TLabel", font=("Helvetica", 12), foreground="#4CAF50", background="#1C1C1E")
        style.configure("Info.TLabel", font=("Helvetica", 10), foreground="#888", background="#1C1C1E")
        style.configure("IP.TLabel", font=("Helvetica", 24, "bold"), foreground="white", background="#1C1C1E")
        style.configure("Log.TLabel", font=("Courier", 9), foreground="#AAA", background="#2C2C2E")

    def _create_widgets(self):
        # Header
        header = tk.Frame(self.root, bg="#2C2C2E", height=60)
        header.pack(fill=tk.X)
        
        tk.Label(header, text="DEFECT TAGGER HUB", font=("Helvetica", 16, "bold"), fg="white", bg="#2C2C2E").pack(pady=15)

        # Content
        content = tk.Frame(self.root, bg="#1C1C1E", padx=30, pady=20)
        content.pack(fill=tk.BOTH, expand=True)

        # Status
        status_frame = tk.Frame(content, bg="#1C1C1E")
        status_frame.pack(fill=tk.X, pady=(0, 20))
        
        tk.Label(status_frame, text="● SERVER ONLINE", font=("Helvetica", 10, "bold"), fg="#4CAF50", bg="#1C1C1E").pack(side=tk.LEFT)
        tk.Label(status_frame, text="Waiting for device...", font=("Helvetica", 10), fg="#888", bg="#1C1C1E").pack(side=tk.RIGHT)

        # IP Address Section
        ip_section = tk.Frame(content, bg="#1C1C1E")
        ip_section.pack(fill=tk.X, pady=10)
        
        tk.Label(ip_section, text="Auto-Connect is Active", font=("Helvetica", 10), fg="#888", bg="#1C1C1E").pack()
        tk.Label(ip_section, text=self.ip_address, font=("Helvetica", 32, "bold"), fg="white", bg="#1C1C1E").pack(pady=10)
        tk.Label(ip_section, text=f"Port: {self.port}", font=("Helvetica", 10), fg="#555", bg="#1C1C1E").pack()

        # Pairing Button
        self.qr_btn = tk.Button(ip_section, text="Show Pairing QR", command=self._show_qr_window, font=("Helvetica", 10, "bold"),
                                bg="#6366F1", fg="white", activebackground="#4F46E5", activeforeground="white",
                                relief=tk.FLAT, padx=20, pady=8, cursor="hand2")
        self.qr_btn.pack(pady=15)

        # Instructions
        tk.Label(content, text="Open mobile app to sync. No QR needed.", font=("Helvetica", 10, "italic"), fg="#6366F1", bg="#1C1C1E").pack(pady=10)

        # Storage Section (NEW: Requested GUI option)
        storage_frame = tk.Frame(content, bg="#1C1C1E")
        storage_frame.pack(fill=tk.X, pady=(10, 15))
        
        tk.Label(storage_frame, text="UPLOAD FOLDER", font=("Helvetica", 9, "bold"), fg="#555", bg="#1C1C1E").pack(side=tk.TOP, anchor=tk.W)
        
        path_row = tk.Frame(storage_frame, bg="#1C1C1E")
        path_row.pack(fill=tk.X, pady=(5, 0))
        
        self.path_var = tk.StringVar(value=str(get_storage_path()))
        # Truncate path if too long for display
        display_path = self.path_var.get()
        if len(display_path) > 45:
            display_path = "..." + display_path[-42:]
            
        self.path_label = tk.Label(path_row, text=display_path, font=("Courier", 9), fg="#AAA", bg="#2C2C2E", padx=8, pady=4, anchor=tk.W)
        self.path_label.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        change_btn = tk.Button(path_row, text="Change", command=self._change_storage_folder, font=("Helvetica", 8, "bold"), 
                               bg="#3A3A3C", fg="white", activebackground="#4A4A4C", activeforeground="white",
                               relief=tk.FLAT, padx=10, cursor="hand2")
        change_btn.pack(side=tk.RIGHT, padx=(8, 0))

        # Activity Log (Ticker)
        log_frame = tk.Frame(content, bg="#2C2C2E", bd=1, relief=tk.FLAT)
        log_frame.pack(fill=tk.BOTH, expand=True)
        
        self.log_text = tk.Text(log_frame, bg="#2C2C2E", fg="#AAA", font=("Courier", 9), bd=0, padx=10, pady=10, height=5)
        self.log_text.pack(fill=tk.BOTH, expand=True)
        self.log_text.insert(tk.END, "Server started. LAN discovery active.\n")
        self.log_text.config(state=tk.DISABLED)

    def _change_storage_folder(self):
        """Opens a folder picker and updates the storage configuration."""
        current_path = self.path_var.get()
        new_path = filedialog.askdirectory(initialdir=current_path, title="Select Upload Folder")
        
        if new_path and new_path != current_path:
            if save_storage_path(new_path):
                self.path_var.set(new_path)
                # Update display label with truncation
                display_path = new_path
                if len(display_path) > 45:
                     display_path = "..." + display_path[-42:]
                self.path_label.config(text=display_path)
                
                self.log(f"FOLDER CHANGED: {new_path}")
                messagebox.showinfo("Config Updated", f"Uploads will now be saved to:\n\n{new_path}\n\nNote: Ongoing sync tasks may require a restart.")
            else:
                messagebox.showerror("Error", "Could not save the new storage path configuration.")

    def _show_qr_window(self):
        """Generates and displays the pairing QR code in a new window."""
        if not self.setup_token:
            messagebox.showerror("Error", "No setup token available. Please restart the hub.")
            return

        qr_window = tk.Toplevel(self.root)
        qr_window.title("Pairing QR Code")
        qr_window.geometry("350x450")
        qr_window.configure(bg="#1C1C1E")
        qr_window.resizable(False, False)

        tk.Label(qr_window, text="Scan with Mobile App", font=("Helvetica", 14, "bold"), fg="white", bg="#1C1C1E", pady=20).pack()

        # Generate QR Data
        pairing_data = {
            "ip": self.ip_address,
            "port": self.port,
            "token": self.setup_token
        }
        qr_json = json.dumps(pairing_data)

        # Create QR Image
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(qr_json)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Convert to PhotoImage
        img = img.resize((250, 250), Image.NEAREST)
        self.qr_photo = ImageTk.PhotoImage(img) # Keep reference

        qr_label = tk.Label(qr_window, image=self.qr_photo, bg="white", padx=10, pady=10)
        qr_label.pack(pady=10)

        tk.Label(qr_window, text="This code contains your secure setup token.", font=("Helvetica", 9), fg="#888", bg="#1C1C1E", pady=10).pack()
        
        tk.Button(qr_window, text="Close", command=qr_window.destroy, bg="#333", fg="white", relief=tk.FLAT, padx=20).pack(pady=15)

    def log(self, message):
        self.log_text.config(state=tk.NORMAL)
        self.log_text.insert(tk.END, f"[{time.strftime('%H:%M:%S')}] {message}\n")
        self.log_text.see(tk.END)
        self.log_text.config(state=tk.DISABLED)

def start_dashboard(ip_address, log_queue=None, setup_token=None):
    root = tk.Tk()
    app = ServerDashboard(root, ip_address, setup_token=setup_token)
    
    # Simple IPC check for logs if needed
    def check_logs():
        if log_queue:
            while not log_queue.empty():
                msg = log_queue.get()
                app.log(msg)
        root.after(500, check_logs)
    
    if log_queue:
        check_logs()
        
    root.mainloop()

if __name__ == "__main__":
    # ARCH-02: Use canonical get_local_ip from services.py (DRY)
    from services import get_local_ip
    start_dashboard(get_local_ip())

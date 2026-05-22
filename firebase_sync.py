import os
import time
import json
import logging
from pathlib import Path
import firebase_admin
from firebase_admin import credentials, storage
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - FirebaseSync - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class FirebaseSyncManager:
    def __init__(self, service_account_path=None, bucket_name=None):
        # Default to a secure system-wide location outside the project directory
        default_home_path = Path.home() / ".defect_tagger" / "firebase-key.json"
        
        # Priority: 1. Manual ARG, 2. Home Dir, 3. Local Config Fallback
        self.service_account_path = service_account_path or str(default_home_path)
        if not os.path.exists(self.service_account_path) and not service_account_path:
            local_fallback = Path('config/firebase-service-account.json')
            if local_fallback.exists():
                self.service_account_path = str(local_fallback)

        self.bucket_name = bucket_name
        self.bucket = None
        self.sync_state_file = Path('config/sync_state.json')
        self.sync_state = self._load_state()
        self.is_initialized = False

    def _load_state(self):
        if self.sync_state_file.exists():
            try:
                return json.loads(self.sync_state_file.read_text())
            except:
                return {}
        return {}

    def _save_state(self):
        self.sync_state_file.parent.mkdir(exist_ok=True)
        self.sync_state_file.write_text(json.dumps(self.sync_state, indent=2))

    def initialize(self):
        if not os.path.exists(self.service_account_path):
            logger.error(f"Credentials missing: {self.service_account_path}. Sync disabled.")
            return False
        
        try:
            cred = credentials.Certificate(self.service_account_path)
            # Fetch bucket name from creds if not provided
            if not self.bucket_name:
                with open(self.service_account_path) as f:
                    data = json.load(f)
                    project_id = data.get("project_id")
                    # Use the specific bucket from user's screenshot
                    self.bucket_name = f"{project_id}.firebasestorage.app"
            
            firebase_admin.initialize_app(cred, {
                'storageBucket': self.bucket_name
            })
            self.bucket = storage.bucket()
            self.is_initialized = True
            logger.info(f"Firebase Sync initialized. Bucket: {self.bucket_name}")
            return True
        except Exception as e:
            logger.error(f"Firebase Init Error: {e}")
            return False

    def upload_file(self, local_path, metadata):
        """
        Uploads a single file to Firebase Storage under its damage_type folder.
        """
        if not self.is_initialized:
            return False
            
        local_path_obj = Path(local_path)
        if not local_path_obj.exists():
            return False
            
        # Check if already synced
        rel_path = str(local_path_obj)
        if rel_path in self.sync_state and self.sync_state[rel_path]['status'] == 'synced':
            return True

        try:
            damage_type = metadata.get('damage_type', 'Unclassified').replace(' ', '_').lower()
            filename = local_path_obj.name
            # Cloud Path: dataset/{damage_type}/{filename}
            blob_path = f"dataset/{damage_type}/{filename}"
            
            blob = self.bucket.blob(blob_path)
            blob.upload_from_filename(local_path)
            
            # Update state
            self.sync_state[rel_path] = {
                'status': 'synced',
                'timestamp': time.time(),
                'cloud_path': blob_path
            }
            self._save_state()
            logger.info(f"Synced to Cloud: {blob_path}")
            return True
        except Exception as e:
            logger.error(f"Upload failed for {local_path}: {e}")
            return False

    def sync_existing(self, uploads_dir='uploads'):
        """
        Walks the uploads directory and syncs missing files using manifest.json.
        """
        manifest_path = Path(uploads_dir) / "manifest.json"
        if not manifest_path.exists():
            return
            
        try:
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
                
            for entry in manifest:
                file_path = entry.get('file_path')
                if file_path and os.path.exists(file_path):
                    self.upload_file(file_path, entry)
        except Exception as e:
            logger.error(f"Batch sync error: {e}")

class NewFileHandler(FileSystemEventHandler):
    def __init__(self, sync_manager):
        self.sync_manager = sync_manager

    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith('.json'):
            # Potentially a manifest update or log. 
            # In our current architecture, the image is saved FIRST, then manifest.
            # We'll just trigger a small delay then scan.
            time.sleep(2)
            self.sync_manager.sync_existing()

def start_sync_service(uploads_dir='uploads'):
    sync_mgr = FirebaseSyncManager()
    if sync_mgr.initialize():
        # Preliminary sync
        sync_mgr.sync_existing(uploads_dir)
        
        # Start watching for new files
        observer = Observer()
        observer.schedule(NewFileHandler(sync_mgr), path=uploads_dir, recursive=True)
        observer.start()
        logger.info(f"Watching {uploads_dir} for new evidence...")
        try:
            while True:
                time.sleep(60) # Periodic check every minute
                sync_mgr.sync_existing(uploads_dir)
        except KeyboardInterrupt:
            observer.stop()
        observer.join()

if __name__ == "__main__":
    start_sync_service()

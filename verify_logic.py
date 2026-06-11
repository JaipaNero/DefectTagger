import shutil
import io
import os
from pathlib import Path
from datetime import datetime
import services
from services import save_evidence_file
from schemas import EvidenceMetadata

# Safety override: mock the storage path to a local test folder
TEST_UPLOADS_DIR = Path("test_uploads")
services.get_storage_path = lambda: TEST_UPLOADS_DIR

# Mock UploadFile class since we aren't running a full server request
class MockUploadFile:
    def __init__(self, filename, content):
        self.filename = filename
        self.file = io.BytesIO(content)

def cleanup():
    if TEST_UPLOADS_DIR.exists():
        shutil.rmtree(TEST_UPLOADS_DIR)
    print("Cleaned up uploads directory.")

def test_duplicate_handling():
    print("Testing duplicate file handling...")
    
    # Setup data
    tech_id = "tech_test"
    timestamp = datetime(2023, 10, 27, 10, 0, 0)
    metadata = EvidenceMetadata(
        technician_id=tech_id,
        device_id="test_device_001",
        damage_type="liquid_damage",
        timestamp=timestamp,
        notes="Test note"
    )
    
    filename = "test_image.jpg"
    content = b"fake image content"
    
    # 1. Upload first file
    file1 = MockUploadFile(filename, content)
    path1 = save_evidence_file(file1.file, file1.filename, metadata)
    print(f"Saved file 1: {path1}")
    
    # 2. Upload second file (same name)
    file2 = MockUploadFile(filename, content)
    path2 = save_evidence_file(file2.file, file2.filename, metadata)
    print(f"Saved file 2: {path2}")
    
    # Verify
    uploads_dir = services.get_storage_path()
    expected_dir = (uploads_dir / "2023-10-27" / tech_id).resolve()
    expected_path1 = expected_dir / f"liquid_damage_{timestamp.strftime('%Y%m%d_%H%M%S')}.jpg"
    expected_path2 = expected_dir / f"liquid_damage_{timestamp.strftime('%Y%m%d_%H%M%S')}_v2.jpg"
    
    if Path(path1).exists() and Path(path2).exists():
        if Path(path1) == expected_path1 and Path(path2) == expected_path2:
             print("SUCCESS: Duplicate handling worked correctly.")
             return True
        else:
             print(f"FAILURE: Paths do not match expected.\nExpected: {expected_path1}, {expected_path2}\nGot: {path1}, {path2}")
             return False
    else:
        print("FAILURE: Files were not created.")
        return False

if __name__ == "__main__":
    cleanup()
    try:
        success = test_duplicate_handling()
        if not success:
            exit(1)
    finally:
        # cleanup() # Optional: keep files to inspect if needed
        pass

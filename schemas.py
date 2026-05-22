from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class EvidenceMetadata(BaseModel):
    technician_id: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$", description="ID of the technician uploading the evidence")
    device_id: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$", description="ID of the device where evidence was captured")
    damage_type: str = Field(..., min_length=1, max_length=100, description="Type of damage (e.g., 'liquid_damage', 'dent')")
    image_context: Optional[str] = Field(None, description="Context of the image (Front, Back, Inner, Hinge)")
    timestamp: datetime = Field(..., description="ISO 8601 timestamp of when the evidence was captured")
    notes: Optional[str] = Field(None, max_length=1000, description="Optional notes about the evidence")

    class Config:
        json_schema_extra = {
            "example": {
                "technician_id": "tech_001",
                "device_id": "device_abc_123",
                "damage_type": "screen_cracked",
                "timestamp": "2023-10-27T10:00:00",
                "notes": "Crack found on surface"
            }
        }

class HandshakeRequest(BaseModel):
    token: str = Field(..., min_length=32, description="The secure setup token from the QR code")
    technician_id: str = Field(..., min_length=1, pattern=r"^[a-zA-Z0-9_-]+$", description="Unique ID of the technician")

class PairingRequest(BaseModel):
    device_name: str = Field(..., description="Friendly name of the device (e.g. Pixel 6)")
    device_id: str = Field(..., min_length=1, description="Unique ID of the device")
    public_key: Optional[str] = Field(None, description="Optional public key for future encryption")

class ClipboardRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000, description="The SN/IMEI barcode string to copy to the PC clipboard")


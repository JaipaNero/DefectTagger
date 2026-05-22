# 📋 Pilot Guide: Defect Tagger (Field Version)

Welcome to the pilot phase of **Defect Tagger**. This tool is essential for managing our **Out-Of-Warranty (OOW)** repair flow.

## 🚀 Mandatory Usage Scenarios

| Role | Trigger Event | Primary Goal |
| :--- | :--- | :--- |
| **Service Expert** | Every OOW Quote & Repair Intake | Document pre-existing condition |
| **Technician** | OOW Diagnosis | Provide visual evidence of damage |

## 1. Getting Started (One-Time Setup)

To connect your mobile device to the server:
1. Open the **Defect Tagger Hub** on your PC. It will show your **IP Address** and status.
2. On your mobile app, go to **Settings** (⚙️).
3. Tap **Auto-Connect via Wi-Fi**; your device will automatically scan the local network for the PC Hub.
4. **Approve the connection** on your PC Hub when the pairing request popup appears.
   - *Tip: Ensure both devices are on the same Wi-Fi network.*

## 2. Capturing Evidence

- **Photo Quality**: Ensure the defect is centered and well-lit.
- **Micro-interactions**: You will feel a subtle vibration (haptics) when a photo is successfully captured.
- **Sourcing**: Switch between front/back lenses as needed.

## 3. Adding Annotations (The "Rectangle")

1. Tap the **Annotate** button after taking a photo.
2. Draw a **rectangle** around the defect.
3. **Undo/Redo**: Correct marks if needed.
4. **Save**: Use the quick-save buttons at the bottom.

## 4. Syncing Data

Defect Tagger is **Offline-First**.
- If you lose connection, data is automatically stored in the **Persistent SQLite Database**.
- Tap the **Queue Status** (e.g., "5 Cached") button on the camera screen to view and batch-upload pending items.
- The **PC Hub** will log the upload in real-time.

## 5. Reporting Issues

If the app crashes or the connection fails:
- Take a screenshot of the error.
- Note your device model (e.g., Samsung S23).
- Contact the **Hub Supervisor** immediately.

---
*Defect Tagger v2.0 Pilot - Built for Field Technicians*

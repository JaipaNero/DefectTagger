# LocalSyncHub Build Log

Date: 2026-05-26

## Goal
Create a working Windows executable for the LocalSyncHub backend.

## Process
1. Confirmed the project entry point is [main.py](main.py) and that the installer expects a Windows binary named `LocalSyncHub.exe`.
2. Installed the Python dependencies from [requirements.txt](requirements.txt) into the configured virtual environment.
3. Installed PyInstaller into the same environment.
4. Built the executable with:

   `pyinstaller --noconfirm --clean --onefile --name LocalSyncHub main.py`

## Result
- Build completed successfully.
- Output executable: `dist/LocalSyncHub.exe`
- PyInstaller also generated the supporting build artifacts and spec file.

## Notes
- The build reported several dependency warnings for system DLLs and optional modules, but it still completed and produced the executable.
- Next validation should be a user run of `dist/LocalSyncHub.exe` on the target Windows machine.

## 2026-05-26 Update (Version 2.2.0)
- Added one-command release script: [build_localsynchub.ps1](build_localsynchub.ps1)
- Script now creates both:
   - `dist/LocalSyncHub.exe`
   - `dist/LocalSyncHub-v2.2.0.exe` (versioned copy)
- Script supports optional APK trigger with `-BuildApk`, which runs:
   - `npm install`
   - `npx eas build -p android --profile preview`
- Mobile metadata was aligned to version `2.2.0`:
   - [mobile/app.json](mobile/app.json)
   - [mobile/package.json](mobile/package.json)
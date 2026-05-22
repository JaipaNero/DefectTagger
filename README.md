# Defect Tagger

A high-performance defect capture and annotation application designed for field technicians. Defect Tagger streamlines the process of capturing evidence, marking defects with intuitive rectangles, and syncing results directly to a local PC hub.

## 🚀 Technology Stack

### Mobile Application
- **Framework**: React Native (Expo)
- **Key Modules**:
    - `expo-camera`: For lightning-fast evidence capture.
    - `react-native-view-shot`: For high-fidelity canvas capture.
    - `expo-sharing`: For saving results to device or sharing across platforms.
    - `expo-haptics`: For premium tactile feedback during interactions.
    - `expo-sqlite`: High-performance SQLite database for offline-first data reliability.
    - `expo-secure-store`: Secure encryption key management for session tokens.

### Backend Hub & Installer
- **Core**: Python (FastAPI)
- **GUI**: Tkinter (Cross-Platform)
- **Packaging**: PyInstaller (Single-file executables)
- **Features**:
    - **Secure Configuration**: Stores user preferences in `Application Support` (macOS) or `AppData` (Windows).
    - **Smart Installer**: Auto-detects OS and creates native shortcuts (`.app` / `.lnk`).
    - **Hardened Security**: Multi-layer path traversal protection using `.resolve()` and `is_relative_to()` validation.
    - **Structured Storage**: Organizes uploads via `uploads/{date}/{technician_id}/`.

## 📦 Installation & Setup

### macOS
1. **Download/Build**: Locate the `Defect TaggerSetup.app` bundle.
2. **Run Installer**: Double-click to launch.
3. **Configure**:
   - Select your preferred **Installation Folder** (Default: `~/Applications/Defect Tagger`).
   - Select your **Storage Folder** for uploads (Default: `~/Documents/Defect Tagger_Uploads`).
4. **Launch**: Open `Defect Tagger Server` from your Applications or Spotlight.

### Windows
1. **Download/Build**: Obtain the `Defect TaggerSetup.exe`.
2. **Run Installer**: Launch the executable.
3. **Configure**:
   - The installer automatically targets `AppData/Local/Programs` for a non-admin install.
   - Choose your **Storage Folder** via the GUI picker.
4. **Launch**: Find the **Defect Tagger Server** shortcut on your Desktop.

## ⚙️ Configuration
The application stores your preferences (like the storage path) in a secure, OS-standard location. You do not need to edit config files manually; simply re-run the **Defect Tagger Setup** tool to change settings.

- **macOS Config**: `~/Library/Application Support/Defect Tagger/config.json`
- **Windows Config**: `%APPDATA%\Defect Tagger\config.json`

## 🛠 Functionality

- **Express Annotations**: Intuitive rectangle drawing tool for marking damage in seconds.
- **Relational Offline-First**: A robust SQLite architecture that ensures zero data loss, even during app crashes or OS reboots.
- **Auto-Connect Setup**: Zero-configuration pairing; technicians simply tap 'Auto-Connect' to discover and securely pair with the PC hub.
- **Samsung One UI Aesthetic**: A professional, native look and feel designed for clarity and one-handed operation.

## 🎨 Design Philosophy

### Samsung One UI Aesthetic (2026 Revision)
The app features a "Stealth Monochrome" protocol inspired by Samsung's One UI and modern Android design languages:
- **Solid Surfaces**: Replaced legacy "frosted glass" effects with solid, high-contrast grays (`#252525`, `#1C1C1E`) to prioritize readability in variable lighting environments.
- **"Squircle" Geometry**: A consistent `26px` corner radius applied across modules, buttons, and panels.
- **Thumb-Friendly Ergonomics**: Critical interactions—including damage selection and sync triggers—are strategically positioned at the bottom of the screen to facilitate one-handed usage.
- **Premium Micro-interactions**: Custom `ScaleButton` components provide integrated scale-down animations and haptic feedback on every interaction.

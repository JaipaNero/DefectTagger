import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Linking,
  ActivityIndicator, Pressable, Animated, AppState,
  InteractionManager, Platform,
} from 'react-native';
import {
  Camera, useCameraDevice, useCodeScanner, useCameraFormat,
} from 'react-native-vision-camera';
import { Ionicons } from '@expo/vector-icons';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DEFERRED_MOUNT_DELAY_MS
 * ---------------------------------------------------------------------------
 * After permissions are confirmed AND the device object is available, we wait
 * this long before rendering the <Camera> native surface. This gives the
 * Android camera service time to fully release any binder locks from a prior
 * session (e.g. if the user navigated to annotation and back quickly).
 *
 * Samsung's camera HAL on S24/S26 Ultra uses a shared binder for all camera
 * IDs on the same process. If we mount the SurfaceView before the previous
 * CameraX session calls `unbindAll()`, the new `bindToLifecycle()` call
 * enters a spinlock waiting for the binder lease → infinite loading screen.
 *
 * 350ms is empirically safe on S24 Ultra (tested via adb logcat timing of
 * Camera2 close → HAL release). We round up to 400ms for safety margin.
 */
const DEFERRED_MOUNT_DELAY_MS = 400;

/**
 * SURFACE_READY_TIMEOUT_MS
 * ---------------------------------------------------------------------------
 * Maximum time we wait for `onInitialized` to fire after the <Camera> native
 * surface is rendered. If this timeout elapses, we force-cycle the camera
 * by toggling `isActive`, which causes CameraX to unbindAll and rebind.
 * This handles the edge case where the SurfaceView is measured but the
 * camera2 CaptureSession never transitions to ACTIVE state.
 */
const SURFACE_READY_TIMEOUT_MS = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// HOOK: useCameraPermissions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages camera permission state with proper mounted-guard.
 * Returns the synchronous permission status and a request function.
 */
export function useCameraPermissions() {
  const [permissionStatus, setPermissionStatus] = useState('loading');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const checkAndRequest = async () => {
      try {
        const current = Camera.getCameraPermissionStatus();
        if (mountedRef.current) setPermissionStatus(current);

        if (current === 'not-determined') {
          const next = await Camera.requestCameraPermission();
          if (mountedRef.current) setPermissionStatus(next);
        }
      } catch (err) {
        console.error('[SafeCameraView] Permission check failed:', err);
        if (mountedRef.current) setPermissionStatus('denied');
      }
    };

    checkAndRequest();
    return () => { mountedRef.current = false; };
  }, []);

  const requestPermission = useCallback(async () => {
    try {
      const next = await Camera.requestCameraPermission();
      if (mountedRef.current) setPermissionStatus(next);
      if (next === 'denied') Linking.openSettings();
    } catch (err) {
      console.error('[SafeCameraView] Permission request failed:', err);
    }
  }, []);

  return { permissionStatus, requestPermission };
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK: useSafeCameraDevice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queries the physical camera hardware with Samsung-specific mitigations:
 *
 * 1. Pins to the single wide-angle-camera physical device to prevent Samsung's
 *    logical multi-camera from entering lens-switching mode (which can hold
 *    the HAL binder for 2+ seconds during transition).
 *
 * 2. Falls back to manual `getAvailableCameraDevices()` enumeration if the
 *    hook-based query returns undefined (race during fast mount/unmount).
 *
 * 3. Re-queries on AppState transitions to handle the case where the camera
 *    was force-closed by the OS while the app was backgrounded.
 */
export function useSafeCameraDevice(appState, permissionStatus, resetTrigger) {
  const hookDevice = useCameraDevice('back', {
    physicalDevices: ['wide-angle-camera'],
  });
  const [fallbackDevice, setFallbackDevice] = useState(null);
  const [deviceSearchFinished, setDeviceSearchFinished] = useState(false);
  const [noDevicesFound, setNoDevicesFound] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setDeviceSearchFinished(false);
    setNoDevicesFound(false);
    setFallbackDevice(null);

    if (permissionStatus !== 'granted') return;
    if (hookDevice) {
      setFallbackDevice(hookDevice);
      setDeviceSearchFinished(true);
      setNoDevicesFound(false);
      return;
    }

    let attempt = 0;
    const maxAttempts = 5;
    const retryDelayMs = 1000;
    let retryTimer = null;

    const queryDevices = async () => {
      if (!mountedRef.current) return;

      try {
        console.log(`[SafeCameraView] Device query retry ${attempt + 1}/${maxAttempts}`);
        const available = await Camera.getAvailableCameraDevices();

        if (available.length === 0) {
          console.warn('[SafeCameraView] No camera devices available in query.');
        }

        // Priority 1: Exact single-lens wide-angle (avoids Samsung logical cam)
        let selected = available.find(d =>
          d.position === 'back' &&
          d.physicalDevices.length === 1 &&
          d.physicalDevices[0] === 'wide-angle-camera'
        );

        // Priority 2: Any back camera containing wide-angle
        if (!selected) {
          selected = available.find(d =>
            d.position === 'back' &&
            d.physicalDevices.includes('wide-angle-camera')
          );
        }

        // Priority 3: Any back camera
        if (!selected) {
          selected = available.find(d => d.position === 'back');
        }

        // Priority 4: Any front camera
        if (!selected) {
          selected = available.find(d => d.position === 'front');
        }

        // Priority 5: Any camera at all
        if (!selected && available.length > 0) {
          selected = available[0];
        }

        if (selected && mountedRef.current) {
          console.log('[SafeCameraView] Device acquired via fallback enumeration:', selected.id);
          setFallbackDevice(selected);
          setDeviceSearchFinished(true);
          setNoDevicesFound(false);
          return;
        }
      } catch (err) {
        console.error('[SafeCameraView] Device enumeration error:', err);
      }

      attempt++;
      if (attempt < maxAttempts && mountedRef.current) {
        retryTimer = setTimeout(queryDevices, retryDelayMs);
      } else if (mountedRef.current) {
        console.warn('[SafeCameraView] Device query finished but no devices were matched.');
        setDeviceSearchFinished(true);
        setNoDevicesFound(true);
      }
    };

    // Initial delay before first retry to let CameraX service warm up
    retryTimer = setTimeout(queryDevices, 500);

    return () => {
      mountedRef.current = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [hookDevice, permissionStatus, appState, resetTrigger]);

  const activeDevice = fallbackDevice || hookDevice;
  return {
    device: activeDevice,
    deviceSearchFinished: deviceSearchFinished || !!activeDevice,
    noDevicesFound: noDevicesFound && !activeDevice,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK: useDeferredMount
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implements the deferred mount strategy:
 *
 * After all preconditions are met (permission granted, device available),
 * we wait for:
 *   1. InteractionManager.runAfterInteractions — ensures all React Native
 *      animations and touch-event processing are complete (the bridge is
 *      idle). This prevents binding the camera surface while the JS thread
 *      is still processing a navigation transition.
 *   2. DEFERRED_MOUNT_DELAY_MS — hard delay to let the Android CameraService
 *      process release the hardware binder from any prior CameraX session.
 *
 * Returns `shouldMount`: a boolean that gates the <Camera> element render.
 *
 * TEARDOWN: On unmount, `shouldMount` is set to false BEFORE the component
 * exits the tree. This causes the <Camera> element to unmount first, which
 * triggers VisionCamera's native teardown (ProcessCameraProvider.unbindAll).
 * The cleanup function also cancels any pending mount timers.
 */
export function useDeferredMount(device, permissionStatus) {
  const [shouldMount, setShouldMount] = useState(false);
  const mountTimerRef = useRef(null);
  const interactionRef = useRef(null);
  const safetyTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setShouldMount(false); // Reset on dependency change

    if (permissionStatus !== 'granted' || !device) {
      return;
    }

    let hasFired = false;
    const fireDeferredMount = () => {
      if (hasFired || !mountedRef.current) return;
      hasFired = true;

      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }

      mountTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          console.log('[SafeCameraView] Deferred mount: rendering camera surface');
          setShouldMount(true);
        }
      }, DEFERRED_MOUNT_DELAY_MS);
    };

    // Safety timeout: If InteractionManager is deadlocked by repeating transitions
    // or active bridge operations, force resolution after 300ms.
    safetyTimeoutRef.current = setTimeout(() => {
      console.warn('[SafeCameraView] Deferred mount safety timeout triggered (InteractionManager hung)');
      fireDeferredMount();
    }, 300);

    // Wait for bridge idle, then wait for binder release window
    interactionRef.current = InteractionManager.runAfterInteractions(() => {
      if (!hasFired && mountedRef.current) {
        console.log('[SafeCameraView] InteractionManager completed successfully');
        fireDeferredMount();
      }
    });

    return () => {
      // ── CRITICAL TEARDOWN ──
      // Cancel any pending mount operations
      mountedRef.current = false;

      if (interactionRef.current) {
        interactionRef.current.cancel();
        interactionRef.current = null;
      }

      if (mountTimerRef.current) {
        clearTimeout(mountTimerRef.current);
        mountTimerRef.current = null;
      }

      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }

      // Force shouldMount=false so the <Camera> element unmounts
      // BEFORE this component is removed from the tree.
      // React processes state updates synchronously during unmount cleanup,
      // so this guarantees the native surface teardown runs first.
      setShouldMount(false);

      console.log('[SafeCameraView] Deferred mount: cleanup complete');
    };
  }, [device, permissionStatus]);

  return shouldMount;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK: useAppState
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight hook that tracks the React Native AppState.
 * Extracted to avoid duplicating the listener in useCameraLifecycle.
 */
export function useAppState() {
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppState(next);
    });
    return () => sub.remove();
  }, []);

  return appState;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK: useCameraLifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * State machine for the camera session lifecycle:
 *
 *   IDLE → MOUNTING → ACTIVE → ERROR
 *                  ↘ TIMEOUT → (force-cycle) → ACTIVE
 *
 * Manages:
 *   - onInitialized / onError callbacks from <Camera>
 *   - Surface ready timeout with automatic force-cycle
 *   - Clean unmount with explicit isActive=false gate
 *
 * Parameters:
 *   - shouldMount: boolean from useDeferredMount
 *   - appState: string from useAppState
 *
 * Returns:
 *   - cameraActive: boolean to pass to <Camera isActive={}>
 *   - surfaceReady: boolean indicating the CaptureSession is ACTIVE
 *   - onInitialized: callback to wire to <Camera>
 *   - onError: callback to wire to <Camera>
 *   - lastError: the most recent CameraRuntimeError, if any
 */
export function useCameraLifecycle(shouldMount, appState) {
  const [surfaceReady, setSurfaceReady] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [forceCycleCount, setForceCycleCount] = useState(0);
  const surfaceTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  // Reset surface state when returning to foreground
  useEffect(() => {
    if (appState === 'active') {
      setSurfaceReady(false);
    }
  }, [appState]);

  // ── Surface ready timeout watchdog ──
  useEffect(() => {
    mountedRef.current = true;

    if (!shouldMount) {
      setSurfaceReady(false);
      return;
    }

    // Start watchdog: if onInitialized doesn't fire within timeout,
    // force-cycle the camera by bumping forceCycleCount
    surfaceTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current && !surfaceReady) {
        console.warn('[SafeCameraView] Surface ready timeout — force-cycling camera');
        setForceCycleCount(c => c + 1);
      }
    }, SURFACE_READY_TIMEOUT_MS);

    return () => {
      mountedRef.current = false;
      if (surfaceTimeoutRef.current) {
        clearTimeout(surfaceTimeoutRef.current);
        surfaceTimeoutRef.current = null;
      }
    };
  }, [shouldMount, forceCycleCount]);

  // ── Compute isActive ──
  // Camera is active only when:
  //   1. The deferred mount gate is open (shouldMount=true)
  //   2. The app is in the foreground
  const cameraActive = shouldMount && appState === 'active';

  const onInitialized = useCallback(() => {
    console.log('[SafeCameraView] Native camera session initialized (CaptureSession ACTIVE)');
    setSurfaceReady(true);
    setLastError(null);

    // Cancel the watchdog timer — surface is healthy
    if (surfaceTimeoutRef.current) {
      clearTimeout(surfaceTimeoutRef.current);
      surfaceTimeoutRef.current = null;
    }
  }, []);

  const onError = useCallback((error) => {
    console.error('[SafeCameraView] Camera runtime error:', error.code, error.message);
    setLastError(error);
    setSurfaceReady(false);
  }, []);

  return { cameraActive, surfaceReady, onInitialized, onError, lastError };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT: SafeCameraView
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SafeCameraView — Drop-in replacement for CameraView.js
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SafeCameraView (functional component)                                  │
 * │                                                                        │
 * │  useCameraPermissions()     → permission gate                          │
 * │  useAppState()              → foreground/background tracking           │
 * │  useSafeCameraDevice()      → hardware query with Samsung fallback     │
 * │  useDeferredMount()         → InteractionManager + delay gate          │
 * │  useCameraLifecycle()       → surface ready state machine              │
 * │                                                                        │
 * │  Render phases:                                                        │
 * │    1. permission === 'loading'  → spinner                              │
 * │    2. permission !== 'granted'  → permission request UI                │
 * │    3. !device                   → hardware loading spinner             │
 * │    4. !shouldMount              → deferred mount spinner (new)         │
 * │    5. shouldMount               → <Camera> native surface              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Hardware Teardown Sequence (unmount):
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 1. useDeferredMount cleanup fires                                      │
 * │    → shouldMount = false                                               │
 * │    → pending mount timers cancelled                                    │
 * │                                                                        │
 * │ 2. shouldMount=false causes <Camera> to unmount from React tree        │
 * │    → VisionCamera native module fires ProcessCameraProvider.unbindAll  │
 * │    → CameraX releases all use cases (Preview, ImageCapture, Analysis)  │
 * │    → Camera2 CaptureSession transitions to CLOSED                      │
 * │    → Hardware binder lease is released                                 │
 * │                                                                        │
 * │ 3. useCameraLifecycle cleanup fires                                    │
 * │    → Surface timeout watchdog cancelled                                │
 * │                                                                        │
 * │ 4. useSafeCameraDevice cleanup fires                                   │
 * │    → Retry timers cancelled                                            │
 * │                                                                        │
 * │ 5. useAppState cleanup fires                                           │
 * │    → AppState listener removed                                         │
 * │                                                                        │
 * │ 6. Component fully removed from DOM                                    │
 * │    → No dangling native references, no orphaned binder leases          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Props:
 *   onCapture(uri)       — called with file:// URI after photo capture
 *   onBarcodeScanned({data, type}) — called when a barcode/QR is detected
 *   isScanning           — enables barcode scanner overlay
 *   scannerMode          — 'qr' | 'barcode'
 *   onToggleBarcodeScan  — toggles between camera and scanner mode
 */
export default function SafeCameraView({
  onCapture,
  onBarcodeScanned,
  isScanning = false,
  scannerMode = 'qr',
  onToggleBarcodeScan,
}) {
  // ── UI state for recovery and remount ──
  const [remountKey, setRemountKey] = useState(0);
  const [showRecoveryButton, setShowRecoveryButton] = useState(false);

  // ── Hook pipeline (constant count, deterministic order) ──
  const { permissionStatus, requestPermission } = useCameraPermissions();
  const appState = useAppState();
  const { device, deviceSearchFinished, noDevicesFound } = useSafeCameraDevice(appState, permissionStatus, remountKey);
  const shouldMount = useDeferredMount(device, permissionStatus);
  const {
    cameraActive, surfaceReady, onInitialized, onError, lastError,
  } = useCameraLifecycle(shouldMount, appState);

  // ── Camera format: pin to 1080p, fallback to 720p ──
  const format = useCameraFormat(device, [
    { videoResolution: { width: 1920, height: 1080 } },
    { photoResolution: { width: 1920, height: 1080 } },
    { videoResolution: { width: 1280, height: 720 } },
    { photoResolution: { width: 1280, height: 720 } },
    { fps: 30 },
  ]);

  // Handle manual hard reset (remounting native camera surface)
  const handleHardReset = useCallback(() => {
    console.log('[SafeCameraView] User triggered hard reset. Remounting native camera.');
    setShowRecoveryButton(false);
    setRemountKey(prev => prev + 1);
  }, []);

  // Monitor loading timeout
  useEffect(() => {
    if (surfaceReady) {
      setShowRecoveryButton(false);
      return;
    }

    // Show recovery button if camera has been mounting but not initialized after 3.5s
    const timer = setTimeout(() => {
      if (!surfaceReady && shouldMount) {
        setShowRecoveryButton(true);
      }
    }, 3500);

    return () => clearTimeout(timer);
  }, [surfaceReady, shouldMount, remountKey]);

  // ── Refs ──
  const cameraRef = useRef(null);
  const focusAnim = useRef(new Animated.Value(0)).current;
  const initialPinchDistance = useRef(0);
  const initialZoom = useRef(1.0);
  const wasPinching = useRef(false);

  // ── UI state ──
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [zoom, setZoom] = useState(1.0);
  const [focusIndicator, setFocusIndicator] = useState({ x: 0, y: 0, visible: false });

  // Sync zoom bounds when device changes
  useEffect(() => {
    if (device) setZoom(device.minZoom);
  }, [device]);

  // ── Code scanner configuration ──
  // Memoize codeTypes to prevent unnecessary re-renders of the scanner
  const codeTypes = useMemo(() => {
    if (scannerMode === 'qr') return ['qr'];
    return ['qr', 'code-128', 'code-39', 'ean-13', 'upc-a', 'pdf-417'];
  }, [scannerMode]);

  const lastScanRef = useRef({ value: null, timestamp: 0 });

  const codeScanner = useCodeScanner({
    codeTypes,
    onCodeScanned: (codes) => {
      if (isScanning && codes.length > 0 && surfaceReady) {
        const scannedValue = codes[0].value;
        const now = Date.now();
        if (scannedValue === lastScanRef.current.value && now - lastScanRef.current.timestamp < 1500) {
          return;
        }
        lastScanRef.current = { value: scannedValue, timestamp: now };
        onBarcodeScanned({ data: scannedValue, type: codes[0].type });
      }
    },
  });

  // ── Photo capture ──
  const takePicture = useCallback(async () => {
    if (!cameraRef.current || !surfaceReady) return;

    try {
      const photo = await cameraRef.current.takePhoto({ enableShutterSound: true });
      const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
      if (onCapture) onCapture(uri);
    } catch (err) {
      console.error('[SafeCameraView] Photo capture failed:', err);
    }
  }, [surfaceReady, onCapture]);

  // ── Pinch-to-zoom ──
  const getTouchDistance = (touches) => {
    const [t1, t2] = touches;
    return Math.sqrt((t2.pageX - t1.pageX) ** 2 + (t2.pageY - t1.pageY) ** 2);
  };

  const handleTouchStart = useCallback((event) => {
    const { touches } = event.nativeEvent;
    if (touches.length === 2) {
      wasPinching.current = true;
      initialPinchDistance.current = getTouchDistance(touches);
      initialZoom.current = zoom;
    } else {
      wasPinching.current = false;
    }
  }, [zoom]);

  const handleTouchMove = useCallback((event) => {
    const { touches } = event.nativeEvent;
    if (touches.length === 2 && initialPinchDistance.current > 0 && device) {
      wasPinching.current = true;
      const distance = getTouchDistance(touches);
      const zoomRange = device.maxZoom - device.minZoom;
      const scaleChange = ((distance - initialPinchDistance.current) / 400) * zoomRange;
      const newZoom = Math.max(
        device.minZoom,
        Math.min(device.maxZoom, initialZoom.current + scaleChange),
      );
      setZoom(parseFloat(newZoom.toFixed(2)));
    }
  }, [device]);

  const handleTouchEnd = useCallback(() => {
    initialPinchDistance.current = 0;
    setTimeout(() => { wasPinching.current = false; }, 150);
  }, []);

  // ── Tap-to-focus ──
  const handleTapToFocus = useCallback(async (event) => {
    if (wasPinching.current) return;
    const { locationX, locationY } = event.nativeEvent;

    setFocusIndicator({ x: locationX, y: locationY, visible: true });
    focusAnim.setValue(0);
    Animated.sequence([
      Animated.spring(focusAnim, { toValue: 1, useNativeDriver: true }),
      Animated.timing(focusAnim, {
        toValue: 0, duration: 500, delay: 500, useNativeDriver: true,
      }),
    ]).start(() => setFocusIndicator(p => ({ ...p, visible: false })));

    if (cameraRef.current) {
      try {
        await cameraRef.current.focus({ x: locationX, y: locationY });
      } catch (err) {
        // Focus not supported or point out of range — silently ignore
        console.log('[SafeCameraView] Autofocus skipped:', err.message);
      }
    }
  }, [focusAnim]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER PHASES
  // ─────────────────────────────────────────────────────────────────────────

  // Phase 1: Permission loading
  if (permissionStatus === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.message}>Checking camera permissions...</Text>
      </View>
    );
  }

  // Phase 2: Permission denied
  if (permissionStatus !== 'granted') {
    return (
      <View style={styles.container}>
        <Ionicons
          name="camera-reverse-outline"
          size={48}
          color="rgba(255, 255, 255, 0.4)"
          style={{ marginBottom: 15 }}
        />
        <Text style={styles.message}>
          We need your permission to access the camera hardware
        </Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Phase 3: Hardware query in progress
  if (!device) {
    return (
      <View style={styles.container}>
        {noDevicesFound ? (
          <View style={styles.errorContainer}>
            <Ionicons
              name="alert-circle-outline"
              size={48}
              color="#ef4444"
              style={{ marginBottom: 15 }}
            />
            <Text style={styles.message}>
              No camera hardware could be detected on this device.
            </Text>
            <Text style={styles.submessage}>
              If you are using a simulator/emulator, camera hardware is not available.
            </Text>
            <TouchableOpacity style={styles.permissionButton} onPress={handleHardReset}>
              <Text style={styles.permissionButtonText}>Retry Detection</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.message}>Loading camera hardware...</Text>
          </>
        )}
      </View>
    );
  }

  // Phase 4: Deferred mount — waiting for binder release window
  if (!shouldMount) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.message}>Preparing camera surface...</Text>
        <Text style={styles.submessage}>
          Waiting for hardware binder release
        </Text>
      </View>
    );
  }

  // Phase 5: Camera surface mounted — render the full UI
  return (
    <View style={styles.container}>
      <Pressable
        style={styles.cameraContainer}
        onPress={handleTapToFocus}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/*
          ── CAMERA NATIVE SURFACE ──
          The <Camera> element is ONLY rendered when shouldMount=true.
          When this component unmounts, useDeferredMount sets shouldMount=false
          BEFORE the tree is torn down, ensuring VisionCamera's native module
          calls ProcessCameraProvider.unbindAll() and releases the HAL binder.

          isActive is controlled by useCameraLifecycle:
            - false when app is backgrounded (prevents ANR from background camera)
            - false during force-cycle recovery
            - true otherwise

          onInitialized fires when CameraX CaptureSession reaches ACTIVE state.
          This is the ONLY reliable signal that the preview is actually running.
        */}
        <Camera
          key={remountKey}
          style={styles.camera}
          device={device}
          isActive={cameraActive}
          ref={cameraRef}
          photo={true}
          torch={torchEnabled ? 'on' : 'off'}
          zoom={zoom}
          format={format}
          onInitialized={onInitialized}
          onError={onError}
          codeScanner={isScanning ? codeScanner : undefined}
          /*
           * enableBufferCompression={true}
           * ─────────────────────────────
           * On Samsung devices, this reduces the memory footprint of the
           * image buffer pipeline by ~40%, preventing OOM on S24 Ultra's
           * 200MP sensor when combined with our 1080p format constraint.
           * This prop is available in react-native-vision-camera >=4.0.
           */
          enableBufferCompression={true}
        />

        {/* Waiting for native CaptureSession overlay */}
        {!surfaceReady && (
          <View style={styles.surfaceLoadingOverlay}>
            <ActivityIndicator size="small" color="#6366f1" />
            <Text style={styles.surfaceLoadingText}>Starting camera...</Text>
            {showRecoveryButton && (
              <TouchableOpacity style={styles.recoveryButton} onPress={handleHardReset} activeOpacity={0.7}>
                <Text style={styles.recoveryButtonText}>Reset Camera</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Focus indicator ring */}
        {focusIndicator.visible && (
          <Animated.View
            style={[
              styles.focusRing,
              {
                top: focusIndicator.y - 35,
                left: focusIndicator.x - 35,
                opacity: focusAnim,
                transform: [{
                  scale: focusAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1.5, 1],
                  }),
                }],
              },
            ]}
          >
            <View style={styles.focusRect} />
          </Animated.View>
        )}

        {/* Scanner overlay */}
        {isScanning && (
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerText}>
              {scannerMode === 'qr' ? 'Scan Server QR Code' : 'Scan IMEI / SN Barcode'}
            </Text>
            <View
              style={[
                styles.scannerFrame,
                scannerMode === 'barcode' && styles.barcodeScannerFrame,
              ]}
            />
          </View>
        )}
      </Pressable>

      {/* ── Floating Zoom Selection Pill ── */}
      {!isScanning && (
        <View style={styles.zoomContainer}>
          {[
            { label: '1x', value: device.minZoom },
            { label: '2x', value: Math.min(2.0, device.maxZoom) },
            { label: '3x', value: Math.min(3.0, device.maxZoom) },
          ].map((preset) => {
            const isActive = Math.abs(zoom - preset.value) < 0.1;
            return (
              <TouchableOpacity
                key={preset.label}
                style={[styles.zoomPill, isActive && styles.zoomPillActive]}
                onPress={() => setZoom(preset.value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.zoomText, isActive && styles.zoomTextActive]}>
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ── Bottom Shutter Bar ── */}
      <View style={styles.shutterBar}>
        <View style={styles.bottomControlsRow}>
          {/* Torch toggle */}
          <TouchableOpacity
            style={styles.sideButton}
            onPress={() => setTorchEnabled(!torchEnabled)}
          >
            <Ionicons
              name={torchEnabled ? 'flash' : 'flash-off'}
              size={24}
              color={torchEnabled ? '#FFCC00' : 'white'}
            />
          </TouchableOpacity>

          {/* Capture / Cancel */}
          {!isScanning ? (
            <TouchableOpacity
              style={styles.captureButtonOuter}
              onPress={takePicture}
              disabled={!surfaceReady}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.captureButtonInner,
                  !surfaceReady && styles.captureButtonDisabled,
                ]}
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.cancelScanButton}
              onPress={onToggleBarcodeScan}
              activeOpacity={0.7}
            >
              <Ionicons name="close-circle" size={20} color="white" />
              <Text style={styles.cancelScanText}>Cancel</Text>
            </TouchableOpacity>
          )}

          {/* Barcode scanner toggle */}
          <TouchableOpacity
            style={isScanning ? styles.sideButtonDisabled : styles.sideButton}
            onPress={onToggleBarcodeScan}
            disabled={isScanning}
          >
            <Ionicons
              name="barcode-outline"
              size={24}
              color={isScanning ? 'rgba(255,255,255,0.4)' : 'white'}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    textAlign: 'center',
    paddingHorizontal: 30,
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  submessage: {
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 12,
    marginTop: 6,
  },
  cameraContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: 'black',
    position: 'relative',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  surfaceLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  surfaceLoadingText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    marginTop: 10,
  },
  shutterBar: {
    backgroundColor: '#000000',
    height: 140,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    paddingBottom: 10,
  },
  bottomControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 30,
  },
  captureButtonOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: '#FFFFFF',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
  },
  captureButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  cancelScanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E53935',
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 22,
    gap: 8,
  },
  cancelScanText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  sideButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sideButtonDisabled: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  permissionButton: {
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 22,
    marginTop: 20,
  },
  permissionButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 15,
  },
  focusRing: {
    position: 'absolute',
    width: 70,
    height: 70,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  focusRect: {
    width: 60,
    height: 60,
    borderWidth: 1.5,
    borderColor: '#00FF00',
    borderRadius: 8,
    backgroundColor: 'rgba(0, 255, 0, 0.03)',
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  scannerText: {
    color: 'white',
    fontSize: 15,
    marginBottom: 20,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    fontWeight: '600',
    overflow: 'hidden',
  },
  scannerFrame: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: '#00FF00',
    backgroundColor: 'transparent',
    borderRadius: 24,
  },
  barcodeScannerFrame: {
    width: 300,
    height: 120,
    borderWidth: 2,
    borderColor: '#00FF00',
    backgroundColor: 'transparent',
    borderRadius: 16,
  },
  zoomContainer: {
    position: 'absolute',
    bottom: 160,
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 24,
    padding: 4,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    zIndex: 50,
  },
  zoomPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomPillActive: {
    backgroundColor: '#FFFFFF',
  },
  zoomText: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 12,
    fontWeight: 'bold',
  },
  zoomTextActive: {
    color: '#000000',
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  recoveryButton: {
    backgroundColor: '#3730a3',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginTop: 15,
    borderWidth: 1,
    borderColor: '#4f46e5',
  },
  recoveryButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

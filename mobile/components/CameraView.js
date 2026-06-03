import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Linking, ActivityIndicator, Pressable, Animated, AppState } from 'react-native';
import { Camera, useCameraDevice, useCodeScanner, useCameraFormat } from 'react-native-vision-camera';
import { Ionicons } from '@expo/vector-icons';

/**
 * 1. Self-Contained Custom Hook: useCameraPermissions
 * Handles querying, requesting, and updating the camera permission state cleanly.
 */
export function useCameraPermissions() {
    const [permissionStatus, setPermissionStatus] = useState('loading');

    useEffect(() => {
        let isMounted = true;
        const checkAndRequest = async () => {
            try {
                const currentStatus = Camera.getCameraPermissionStatus();
                if (isMounted) setPermissionStatus(currentStatus);

                if (currentStatus === 'not-determined') {
                    const nextStatus = await Camera.requestCameraPermission();
                    if (isMounted) setPermissionStatus(nextStatus);
                }
            } catch (error) {
                console.error("useCameraPermissions: Check failed:", error);
                if (isMounted) setPermissionStatus('denied');
            }
        };
        checkAndRequest();
        return () => { isMounted = false; };
    }, []);

    const requestPermission = async () => {
        try {
            const nextStatus = await Camera.requestCameraPermission();
            setPermissionStatus(nextStatus);
            if (nextStatus === 'denied') {
                Linking.openSettings();
            }
        } catch (error) {
            console.error("useCameraPermissions: Request failed:", error);
        }
    };

    return { permissionStatus, requestPermission };
}

/**
 * 2. Self-Contained Custom Hook: useCameraDeviceFallback
 * Manages the camera hardware query. If standard useCameraDevice returns undefined
 * (due to native lag, dynamic updates, or locked hardware), it falls back to
 * querying getAvailableCameraDevices in a robust retry loop.
 */
export function useCameraDeviceFallback(appState, permissionStatus) {
    // Query physical wide-angle camera specifically (avoids logical lens switching timeout/freeze on S24 Ultra)
    const hookDevice = useCameraDevice('back', {
        physicalDevices: ['wide-angle-camera']
    });
    const [fallbackDevice, setFallbackDevice] = useState(null);

    useEffect(() => {
        if (permissionStatus !== 'granted') {
            return;
        }

        if (hookDevice) {
            setFallbackDevice(hookDevice);
            return;
        }

        let isMounted = true;
        let attempt = 0;
        const maxAttempts = 5;
        const delay = 1000;

        const fetchDevices = async () => {
            if (!isMounted) return;
            try {
                console.log(`useCameraDeviceFallback: Retrying hardware selection (attempt ${attempt + 1}/${maxAttempts})...`);
                const availableDevices = await Camera.getAvailableCameraDevices();
                
                // 1. Prioritize a single physical wide-angle camera
                let backDevice = availableDevices.find(d => 
                    d.position === 'back' && 
                    d.physicalDevices.length === 1 && 
                    d.physicalDevices[0] === 'wide-angle-camera'
                );

                // 2. Fallback to any camera containing wide-angle physical lens
                if (!backDevice) {
                    backDevice = availableDevices.find(d => 
                        d.position === 'back' && 
                        d.physicalDevices.includes('wide-angle-camera')
                    );
                }

                // 3. Last fallback to generic back camera
                if (!backDevice) {
                    backDevice = availableDevices.find(d => d.position === 'back');
                }

                if (backDevice) {
                    console.log("useCameraDeviceFallback: Successfully established back device via manual query!");
                    if (isMounted) setFallbackDevice(backDevice);
                    return;
                }
            } catch (error) {
                console.error("useCameraDeviceFallback: Error retrieving available devices:", error);
            }

            attempt++;
            if (attempt < maxAttempts && isMounted) {
                setTimeout(fetchDevices, delay);
            }
        };

        const timer = setTimeout(fetchDevices, 500);

        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
    }, [hookDevice, permissionStatus, appState]);

    return fallbackDevice || hookDevice;
}

/**
 * 3. Main Modular CameraScreen Component
 * Ready for a beginner to run immediately, self-contained, and structurally organized.
 */
export default function CameraScreen({ onCapture, onBarcodeScanned, isScanning = false, scannerMode = 'qr', onToggleBarcodeScan }) {
    // Modular lifecycle & session hooks
    const { permissionStatus, requestPermission } = useCameraPermissions();
    const [appState, setAppState] = useState(AppState.currentState);
    const device = useCameraDeviceFallback(appState, permissionStatus);
    
    // Proactively limit format resolutions to standard 1080p to prevent S24 Ultra memory allocation freezes
    const format = useCameraFormat(device, [
        { videoResolution: { width: 1920, height: 1080 } },
        { photoResolution: { width: 1920, height: 1080 } },
        { fps: 30 }
    ]);
    
    const cameraRef = useRef(null);
    const [isReady, setIsReady] = useState(false);
    const [torchEnabled, setTorchEnabled] = useState(false);
    const [zoom, setZoom] = useState(1.0);
    const [focusIndicator, setFocusIndicator] = useState({ x: 0, y: 0, visible: false });
    const focusAnim = useRef(new Animated.Value(0)).current;

    const initialPinchDistance = useRef(0);
    const initialZoom = useRef(1.0);
    const wasPinching = useRef(false);

    // Sync AppState (Foreground vs. Background transitions)
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextAppState) => {
            setAppState(nextAppState);
        });
        return () => subscription.remove();
    }, []);

    // Sync zoom boundaries when camera device hardware is verified
    useEffect(() => {
        if (device) {
            setZoom(device.minZoom);
            setIsReady(true);
        }
    }, [device]);

    // QR & Barcode Scanner setup
    const codeScanner = useCodeScanner({
        codeTypes: scannerMode === 'qr' ? ['qr'] : ['qr', 'code-128', 'code-39', 'ean-13', 'upc-a', 'pdf-417'],
        onCodeScanned: (codes) => {
            if (isScanning && codes.length > 0 && isReady) {
                onBarcodeScanned({ data: codes[0].value, type: codes[0].type });
            }
        }
    });

    // Capture photo helper
    const takePicture = async () => {
        if (cameraRef.current && isReady) {
            try {
                const photo = await cameraRef.current.takePhoto({ enableShutterSound: true });
                const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
                if (onCapture) onCapture(uri);
            } catch (error) {
                console.error("CameraView: capture failed", error);
            }
        }
    };

    // Pinch-to-zoom calculations
    const getTouchDistance = (touches) => {
        const [t1, t2] = touches;
        return Math.sqrt(Math.pow(t2.pageX - t1.pageX, 2) + Math.pow(t2.pageY - t1.pageY, 2));
    };

    const handleTouchStart = (event) => {
        const { touches } = event.nativeEvent;
        if (touches.length === 2) {
            wasPinching.current = true;
            initialPinchDistance.current = getTouchDistance(touches);
            initialZoom.current = zoom;
        } else {
            wasPinching.current = false;
        }
    };

    const handleTouchMove = (event) => {
        const { touches } = event.nativeEvent;
        if (touches.length === 2 && initialPinchDistance.current > 0 && device) {
            wasPinching.current = true;
            const distance = getTouchDistance(touches);
            const zoomRange = device.maxZoom - device.minZoom;
            const scaleChange = ((distance - initialPinchDistance.current) / 400) * zoomRange;
            let newZoom = Math.max(device.minZoom, Math.min(device.maxZoom, initialZoom.current + scaleChange));
            setZoom(parseFloat(newZoom.toFixed(2)));
        }
    };

    const handleTouchEnd = () => {
        initialPinchDistance.current = 0;
        setTimeout(() => { wasPinching.current = false; }, 150);
    };

    // Tap-to-focus helper
    const handleTapToFocus = async (event) => {
        if (wasPinching.current) return;
        const { locationX, locationY } = event.nativeEvent;

        setFocusIndicator({ x: locationX, y: locationY, visible: true });
        focusAnim.setValue(0);
        Animated.sequence([
            Animated.spring(focusAnim, { toValue: 1, useNativeDriver: true }),
            Animated.timing(focusAnim, { toValue: 0, duration: 500, delay: 500, useNativeDriver: true })
        ]).start(() => setFocusIndicator(p => ({ ...p, visible: false })));

        if (cameraRef.current) {
            try {
                await cameraRef.current.focus({ x: locationX, y: locationY });
            } catch (error) {
                console.log("CameraView: Autofocus attempt skipped/failed", error);
            }
        }
    };

    // UI Rendering Logic based on Permission Status
    if (permissionStatus === 'loading') {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color="#6366f1" />
                <Text style={styles.message}>Checking camera permissions...</Text>
            </View>
        );
    }

    if (permissionStatus !== 'granted') {
        return (
            <View style={styles.container}>
                <Ionicons name="camera-reverse-outline" size={48} color="rgba(255, 255, 255, 0.4)" style={{ marginBottom: 15 }} />
                <Text style={styles.message}>We need your permission to access the camera hardware</Text>
                <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                    <Text style={styles.permissionButtonText}>Grant Permission</Text>
                </TouchableOpacity>
            </View>
        );
    }

    if (!device) {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color="#6366f1" />
                <Text style={styles.message}>Loading camera hardware...</Text>
            </View>
        );
    }

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
                <Camera
                    style={styles.camera}
                    device={device}
                    isActive={appState === 'active'}
                    ref={cameraRef}
                    photo={true}
                    torch={torchEnabled ? 'on' : 'off'}
                    zoom={zoom}
                    format={format}
                    codeScanner={isScanning ? codeScanner : undefined}
                />
                
                {focusIndicator.visible && (
                    <Animated.View 
                        style={[
                            styles.focusRing,
                            {
                                top: focusIndicator.y - 35,
                                left: focusIndicator.x - 35,
                                opacity: focusAnim,
                                transform: [{ scale: focusAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [1.5, 1]
                                }) }]
                            }
                        ]}
                    >
                        <View style={styles.focusRect} />
                    </Animated.View>
                )}

                {isScanning && (
                    <View style={styles.scannerOverlay}>
                        <Text style={styles.scannerText}>
                            {scannerMode === 'qr' ? 'Scan Server QR Code' : 'Scan IMEI / SN Barcode'}
                        </Text>
                        <View style={[styles.scannerFrame, scannerMode === 'barcode' && styles.barcodeScannerFrame]} />
                    </View>
                )}
            </Pressable>

            {/* Floating Zoom Selection Pill */}
            {!isScanning && (
                <View style={styles.zoomContainer}>
                    {[
                        { label: '1x', value: device.minZoom },
                        { label: '2x', value: Math.min(2.0, device.maxZoom) },
                        { label: '3x', value: Math.min(3.0, device.maxZoom) }
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

            {/* Solid Bottom Shutter Action Bar */}
            <View style={styles.shutterBar}>
                <View style={styles.bottomControlsRow}>
                    <TouchableOpacity style={styles.sideButton} onPress={() => setTorchEnabled(!torchEnabled)}>
                        <Ionicons name={torchEnabled ? "flash" : "flash-off"} size={24} color={torchEnabled ? "#FFCC00" : "white"} />
                    </TouchableOpacity>

                    {!isScanning ? (
                        <TouchableOpacity style={styles.captureButtonOuter} onPress={takePicture} disabled={!isReady} activeOpacity={0.8}>
                            <View style={styles.captureButtonInner} />
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity style={styles.cancelScanButton} onPress={onToggleBarcodeScan} activeOpacity={0.7}>
                            <Ionicons name="close-circle" size={20} color="white" />
                            <Text style={styles.cancelScanText}>Cancel</Text>
                        </TouchableOpacity>
                    )}

                    <TouchableOpacity style={isScanning ? styles.sideButtonDisabled : styles.sideButton} onPress={onToggleBarcodeScan} disabled={isScanning}>
                        <Ionicons name="barcode-outline" size={24} color={isScanning ? "rgba(255,255,255,0.4)" : "white"} />
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}

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
    cameraContainer: {
        flex: 1,
        width: '100%',
        backgroundColor: 'black',
        position: 'relative',
    },
    camera: {
        ...StyleSheet.absoluteFillObject,
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
    }
});

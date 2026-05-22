import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Dimensions, Linking, ActivityIndicator, Pressable, Animated } from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import { Ionicons } from '@expo/vector-icons';

/**
 * CameraView Component
 * Handles camera permissions, image capture, zoom presets, pinch-to-zoom, and QR/barcode scanning.
 */
export default function CameraScreen({ onCapture, onBarcodeScanned, isScanning = false, scannerMode = 'qr', onToggleBarcodeScan }) {
    const [permissionStatus, setPermissionStatus] = useState('loading');
    const cameraRef = useRef(null);
    const [isReady, setIsReady] = useState(false);
    const [torchEnabled, setTorchEnabled] = useState(false);
    const [zoom, setZoom] = useState(1.0);
    const [focusIndicator, setFocusIndicator] = useState({ x: 0, y: 0, visible: false });
    const focusAnim = useRef(new Animated.Value(0)).current;

    const initialPinchDistance = useRef(0);
    const initialZoom = useRef(1.0);
    const wasPinching = useRef(false);

    // 1. Permission Handling
    useEffect(() => {
        const checkPermission = async () => {
            try {
                const status = Camera.getCameraPermissionStatus();
                setPermissionStatus(status);
                
                if (status === 'not-determined') {
                    const requested = await Camera.requestCameraPermission();
                    setPermissionStatus(requested);
                }
            } catch (error) {
                console.error("CameraView: Permission check failed", error);
                setPermissionStatus('denied');
            }
        };
        checkPermission();
    }, []);

    const handleRequestPermission = async () => {
        console.log("CameraView: Requesting camera permission");
        try {
            const status = await Camera.requestCameraPermission();
            setPermissionStatus(status);
            if (status === 'denied') {
                Linking.openSettings();
            }
        } catch (error) {
            console.error("CameraView: Permission request failed", error);
        }
    };

    // 2. Camera Device Selection
    const device = useCameraDevice('back');

    useEffect(() => {
        if (device) {
            setZoom(device.minZoom);
            setIsReady(true);
        }
    }, [device]);

    // 3. QR/Barcode Scanner
    const codeScanner = useCodeScanner({
        codeTypes: scannerMode === 'qr' ? ['qr'] : ['qr', 'code-128', 'code-39', 'ean-13', 'upc-a', 'pdf-417'],
        onCodeScanned: (codes) => {
            if (isScanning && codes.length > 0 && isReady) {
                const code = codes[0];
                console.log("CameraView: Barcode detected:", code.value);
                // Standardize callback payload to match expo-camera format
                onBarcodeScanned({ data: code.value, type: code.type });
            }
        }
    });

    if (permissionStatus === 'loading') {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color="#0000ff" />
                <Text style={styles.message}>Requesting camera permissions...</Text>
            </View>
        );
    }

    if (permissionStatus !== 'granted') {
        return (
            <View style={styles.container}>
                <Text style={styles.message}>We need your permission to show the camera</Text>
                <TouchableOpacity
                    style={styles.permissionButton}
                    onPress={handleRequestPermission}
                >
                    <Text style={styles.permissionButtonText}>Grant Permission</Text>
                </TouchableOpacity>
            </View>
        );
    }

    if (!device) {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color="#0000ff" />
                <Text style={styles.message}>Loading camera hardware...</Text>
            </View>
        );
    }

    // 4. Capture photo
    const takePicture = async () => {
        if (cameraRef.current && isReady) {
            try {
                const photo = await cameraRef.current.takePhoto({
                    enableShutterSound: true,
                });
                const uri = photo.path.startsWith('file://') ? photo.path : `file://${photo.path}`;
                console.log("CameraView: Photo captured", uri);
                onCapture(uri);
            } catch (error) {
                console.error("CameraView: Capture failed", error);
            }
        }
    };

    // 5. Touch and Zoom Helpers
    const getTouchDistance = (touches) => {
        const [t1, t2] = touches;
        const dx = t2.pageX - t1.pageX;
        const dy = t2.pageY - t1.pageY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = (event) => {
        const { touches } = event.nativeEvent;
        if (touches.length === 1) {
            wasPinching.current = false;
        } else if (touches.length === 2) {
            wasPinching.current = true;
            const distance = getTouchDistance(touches);
            initialPinchDistance.current = distance;
            initialZoom.current = zoom;
        }
    };

    const handleTouchMove = (event) => {
        const { touches } = event.nativeEvent;
        if (touches.length === 2 && initialPinchDistance.current > 0 && device) {
            wasPinching.current = true;
            const distance = getTouchDistance(touches);
            const minZoom = device.minZoom;
            const maxZoom = device.maxZoom;
            const zoomRange = maxZoom - minZoom;
            // 400 pixels of finger spread corresponds to sweeping across the full hardware range
            const scaleChange = ((distance - initialPinchDistance.current) / 400) * zoomRange;
            let newZoom = initialZoom.current + scaleChange;
            newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));
            setZoom(parseFloat(newZoom.toFixed(2)));
        }
    };

    const handleTouchEnd = () => {
        initialPinchDistance.current = 0;
        setTimeout(() => {
            wasPinching.current = false;
        }, 150);
    };

    const handleTapToFocus = async (event) => {
        if (wasPinching.current) {
            return;
        }
        const { locationX, locationY } = event.nativeEvent;
        
        // Show visual indicator
        setFocusIndicator({ x: locationX, y: locationY, visible: true });
        focusAnim.setValue(0);
        Animated.sequence([
            Animated.spring(focusAnim, { toValue: 1, useNativeDriver: true }),
            Animated.timing(focusAnim, { toValue: 0, duration: 500, delay: 500, useNativeDriver: true })
        ]).start(() => {
            setFocusIndicator(prev => ({ ...prev, visible: false }));
        });

        if (cameraRef.current) {
            try {
                // native focus using physical focus pixels
                await cameraRef.current.focus({ x: locationX, y: locationY });
            } catch (error) {
                console.log("CameraView: Autofocus attempt skipped/failed", error);
            }
        }
    };

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
                    isActive={true}
                    ref={cameraRef}
                    photo={true}
                    torch={torchEnabled ? 'on' : 'off'}
                    zoom={zoom}
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

                {/* Barcode scanner box */}
                {isScanning && (
                    <View style={styles.scannerOverlay}>
                        <Text style={styles.scannerText}>
                            {scannerMode === 'qr' ? 'Scan Server QR Code' : 'Scan IMEI / SN Barcode'}
                        </Text>
                        <View style={[
                            styles.scannerFrame,
                            scannerMode === 'barcode' && styles.barcodeScannerFrame
                        ]} />
                    </View>
                )}
            </Pressable>

            {/* Floating zoom presets - bound to device's hardware limits */}
            {!isScanning && device && (
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
                                style={[
                                    styles.zoomPill,
                                    isActive && styles.zoomPillActive
                                ]}
                                onPress={() => {
                                    console.log("CameraView: Zoom preset selected:", preset.label, "value:", preset.value);
                                    setZoom(preset.value);
                                }}
                                activeOpacity={0.7}
                            >
                                <Text style={[
                                    styles.zoomText,
                                    isActive && styles.zoomTextActive
                                ]}>
                                    {preset.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            )}

            {/* Solid Shutter Bar at the bottom containing all controls */}
            <View style={styles.shutterBar}>
                {!isScanning ? (
                    <View style={styles.bottomControlsRow}>
                        {/* Flashlight/Torch Toggle Button */}
                        <TouchableOpacity 
                            style={styles.sideButton} 
                            onPress={() => setTorchEnabled(!torchEnabled)}
                            activeOpacity={0.7}
                        >
                            <Ionicons 
                                name={torchEnabled ? "flash" : "flash-off"} 
                                size={24} 
                                color={torchEnabled ? "#FFCC00" : "white"} 
                            />
                        </TouchableOpacity>

                        {/* Capture Button (Outer Ring + Solid Circle) */}
                        <TouchableOpacity 
                            style={styles.captureButtonOuter} 
                            onPress={takePicture} 
                            disabled={!isReady}
                            activeOpacity={0.8}
                        >
                            <View style={styles.captureButtonInner} />
                        </TouchableOpacity>

                        {/* Scan Barcode Toggle Button */}
                        <TouchableOpacity 
                            style={styles.sideButton} 
                            onPress={onToggleBarcodeScan}
                            activeOpacity={0.7}
                        >
                            <Ionicons 
                                name="barcode-outline" 
                                size={24} 
                                color="white" 
                            />
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={styles.bottomControlsRow}>
                        {/* Flashlight/Torch Toggle Button */}
                        <TouchableOpacity 
                            style={styles.sideButton} 
                            onPress={() => setTorchEnabled(!torchEnabled)}
                            activeOpacity={0.7}
                        >
                            <Ionicons 
                                name={torchEnabled ? "flash" : "flash-off"} 
                                size={24} 
                                color={torchEnabled ? "#FFCC00" : "white"} 
                            />
                        </TouchableOpacity>

                        {/* Cancel Scan Button */}
                        <TouchableOpacity 
                            style={styles.cancelScanButton} 
                            onPress={onToggleBarcodeScan}
                            activeOpacity={0.7}
                        >
                            <Ionicons 
                                name="close-circle" 
                                size={20} 
                                color="white" 
                            />
                            <Text style={styles.cancelScanText}>Cancel</Text>
                        </TouchableOpacity>

                        {/* Scanner Mode Indicator */}
                        <View style={styles.sideButtonDisabled}>
                            <Ionicons 
                                name={scannerMode === 'qr' ? "qr-code-outline" : "barcode-outline"} 
                                size={24} 
                                color="rgba(255, 255, 255, 0.4)" 
                            />
                        </View>
                    </View>
                )}
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
    },
    message: {
        textAlign: 'center',
        paddingBottom: 10,
        color: '#ffffff',
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
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
    },
    cancelScanText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: 'bold',
    },
    scannerOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
    },
    scannerText: {
        color: 'white',
        fontSize: 16,
        marginBottom: 20,
        backgroundColor: 'rgba(0,0,0,0.65)',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 26,
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
    permissionButton: {
        backgroundColor: '#6366f1',
        padding: 15,
        borderRadius: 26,
        marginTop: 20,
        marginHorizontal: 40,
    },
    permissionButtonText: {
        color: 'white',
        fontWeight: 'bold',
        textAlign: 'center',
        fontSize: 16,
    },
    cameraContainer: {
        flex: 1,
        backgroundColor: 'black',
        position: 'relative',
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
    bottomControlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        width: '100%',
        paddingHorizontal: 30,
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
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 5,
        elevation: 6,
        zIndex: 50,
    },
    zoomPill: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    zoomPillActive: {
        backgroundColor: '#FFFFFF',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 3,
        elevation: 3,
    },
    zoomText: {
        color: 'rgba(255, 255, 255, 0.85)',
        fontSize: 12,
        fontWeight: 'bold',
    },
    zoomTextActive: {
        color: '#000000',
        fontWeight: 'bold',
    }
});

import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Dimensions, Linking, ActivityIndicator, Pressable, Animated } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';

/**
 * CameraView Component
 * Handles camera permissions and image capture.
 * 
 * @param {function} onCapture - Callback function receiving the captured image URI.
 */
export default function CameraScreen({ onCapture, onBarcodeScanned, isScanning = false, scannerMode = 'qr', onToggleBarcodeScan }) {
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef(null);
    const [isReady, setIsReady] = useState(false);
    const [autoFocus, setAutoFocus] = useState('on');
    const [torchEnabled, setTorchEnabled] = useState(false);
    const [zoom, setZoom] = useState(0.0);
    const [focusIndicator, setFocusIndicator] = useState({ x: 0, y: 0, visible: false });
    const focusAnim = useRef(new Animated.Value(0)).current;

    const initialPinchDistance = useRef(0);
    const initialZoom = useRef(0);
    const wasPinching = useRef(false);

    useEffect(() => {
        // Request permission on mount if not already handled
        if (!permission) {
            requestPermission();
        }
    }, [permission]);

    if (!permission) {
        // Camera permissions are still loading.
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color="#0000ff" />
                <Text style={styles.message}>Requesting camera permissions...</Text>
            </View>
        );
    }

    if (!permission.granted) {
        // Camera permissions are not granted yet.
        return (
            <View style={styles.container}>
                <Text style={styles.message}>We need your permission to show the camera</Text>
                <TouchableOpacity
                    style={styles.permissionButton}
                    onPress={() => {
                        console.log("Permission button pressed");
                        if (permission.canAskAgain) {
                            requestPermission();
                        } else {
                            Linking.openSettings();
                        }
                    }}
                >
                    <Text style={styles.permissionButtonText}>Grant Permission</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const takePicture = async () => {
        if (cameraRef.current) {
            try {
                const photo = await cameraRef.current.takePictureAsync({
                    quality: 0.8,
                });
                console.log("CameraView: Photo captured", photo.uri);
                onCapture(photo.uri);
            } catch (error) {
                console.error("CameraView: Capture failed", error);
            }
        }
    };

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
        if (touches.length === 2 && initialPinchDistance.current > 0) {
            wasPinching.current = true;
            const distance = getTouchDistance(touches);
            // 400 pixels of finger spread corresponds to zooming from 0.0 to 1.0
            const scaleChange = (distance - initialPinchDistance.current) / 400;
            let newZoom = initialZoom.current + scaleChange;
            newZoom = Math.max(0.0, Math.min(1.0, newZoom));
            setZoom(parseFloat(newZoom.toFixed(3)));
        }
    };

    const handleTouchEnd = () => {
        initialPinchDistance.current = 0;
        setTimeout(() => {
            wasPinching.current = false;
        }, 150);
    };

    const handleTapToFocus = (event) => {
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

        // Force re-focus by toggling autoFocus prop
        // Note: Modern expo-camera handles point-of-interest internally via native tap-to-focus on many platforms,
        // but toggling autoFocus forces a re-trigger.
        setAutoFocus('off');
        setTimeout(() => {
            setAutoFocus('on');
        }, 50);
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
                <CameraView
                    style={styles.camera}
                    facing="back"
                    ref={cameraRef}
                    autoFocus={autoFocus}
                    autofocus={autoFocus}
                    enableTorch={torchEnabled}
                    zoom={zoom}
                    onCameraReady={() => setIsReady(true)}
                    onBarcodeScanned={(event) => {
                        if (isScanning && isReady) {
                            console.log("CameraView: Barcode detected:", event.data);
                            onBarcodeScanned(event);
                        }
                    }}
                    barcodeScannerSettings={{
                        barcodeTypes: scannerMode === 'qr' ? ["qr"] : ["qr", "code128", "code39", "ean13", "upc_a", "pdf417"],
                    }}
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

                {/* Floating zoom presets inside the viewfinder area, bottom-aligned at a safe distance */}
                {!isScanning && (
                    <View style={styles.zoomContainer}>
                        {[
                            { label: '1x', value: 0.0 },
                            { label: '2x', value: 0.08 },
                            { label: '3x', value: 0.18 }
                        ].map((preset) => {
                            const isActive = Math.abs(zoom - preset.value) < 0.02;
                            return (
                                <TouchableOpacity
                                    key={preset.label}
                                    style={[
                                        styles.zoomPill,
                                        isActive && styles.zoomPillActive
                                    ]}
                                    onPress={() => setZoom(preset.value)}
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

                {/* Barcode scanner box is now directly inside the viewfinder area, centered! */}
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

                        {/* Capture Button (Samsung Camera Style: Outer Ring + Solid Circle) */}
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
                        {/* Flashlight/Torch Toggle Button (Crucial for scanner in dark rooms) */}
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
        paddingBottom: 10, // Accounts for bottom home indicator/safe area on modern devices
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
        backgroundColor: '#E53935', // Premium dark red cancel button
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
        borderColor: '#00FF00', // Neon green target box
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
        backgroundColor: 'rgba(255, 255, 255, 0.1)', // Premium translucent white circle
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
        bottom: 20, // Clean floating position above the shutter bar
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
        backgroundColor: '#FFFFFF', // Solid white active selection
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
        color: '#000000', // High-contrast text on white circle
        fontWeight: 'bold',
    }
});

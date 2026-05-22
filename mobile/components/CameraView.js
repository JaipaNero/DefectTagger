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
    const [focusIndicator, setFocusIndicator] = useState({ x: 0, y: 0, visible: false });
    const focusAnim = useRef(new Animated.Value(0)).current;

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

    const handleTapToFocus = (event) => {
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
            <Pressable style={styles.cameraContainer} onPress={handleTapToFocus}>
                <CameraView
                    style={styles.camera}
                    facing="back"
                    ref={cameraRef}
                    autoFocus={autoFocus}
                    autofocus={autoFocus}
                    enableTorch={torchEnabled}
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
            </Pressable>
            <View style={styles.buttonContainer}>
                {!isScanning && (
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

                        {/* Capture Button */}
                        <TouchableOpacity style={styles.captureButton} onPress={takePicture} disabled={!isReady}>
                            <View style={styles.innerCircle} />
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
                )}
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
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        width: '100%',
        height: '100%',
    },
    message: {
        textAlign: 'center',
        paddingBottom: 10,
    },
    camera: {
        ...StyleSheet.absoluteFillObject,
    },
    buttonContainer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 40,
    },
    captureButton: {
        width: 70,
        height: 70,
        borderRadius: 35,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        justifyContent: 'center',
        alignItems: 'center',
        borderColor: 'white',
    },
    scannerOverlay: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 100,
    },
    scannerText: {
        color: 'white',
        fontSize: 18,
        marginBottom: 20,
        backgroundColor: 'rgba(0,0,0,0.5)',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 26,
    },
    scannerFrame: {
        width: 250,
        height: 250,
        borderWidth: 2,
        borderColor: '#00FF00', // Green frame
        backgroundColor: 'transparent',
        borderRadius: 26,
    },
    innerCircle: {
        width: 54,
        height: 54,
        borderRadius: 27,
        backgroundColor: 'white',
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
        borderWidth: 1,
        borderColor: '#00FF00',
        borderRadius: 4,
        backgroundColor: 'rgba(0, 255, 0, 0.05)',
    },
    bottomControlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        width: '100%',
        paddingHorizontal: 30,
    },
    sideButton: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.25)',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 3,
        elevation: 4,
    },
    barcodeScannerFrame: {
        width: 300,
        height: 120,
        borderWidth: 2,
        borderColor: '#00FF00',
        backgroundColor: 'transparent',
        borderRadius: 16,
    }
});

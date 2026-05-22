import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, ImageBackground, Dimensions, Text, Alert, Image, Modal, TouchableWithoutFeedback, ScrollView, Animated, Easing } from 'react-native';

import ScaleButton from './ScaleButton';
import Svg, { Circle, Rect as SvgRect, Text as SvgText } from 'react-native-svg';
import ViewShot from "react-native-view-shot";
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

/**
 * AnnotationCanvas Component
 * Displays the captured image and allows the user to tap to add red circle annotations.
 * 
 * @param {string} imageUri - URI of the image to annotate.
 * @param {function} onSave - Callback when user confirms annotations. Returns (imageUri, metadata).
 * @param {function} onCancel - Callback to cancel annotation.
 */
export default function AnnotationCanvas({ imageUri, onSave, onCancel, showAlert }) {
    // ARCH-04: Unified alert utility — eliminates 7x duplicated if/else blocks
    const notify = (title, message, type = 'warning') => {
        showAlert ? showAlert(title, message, type) : Alert.alert(title, message);
    };
    const [selectedDamage, setSelectedDamage] = useState(null);
    const [shapeType] = useState('rect'); // Fixed to 'rect' based on user preference
    const [imageContext, setImageContext] = useState('Front'); // 'Front', 'Back', 'Inner', 'Hinge'
    const [annotations, setAnnotations] = useState([]);
    const [currentAnnotation, setCurrentAnnotation] = useState(null); // The one being drawn
    const [imageLayout, setImageLayout] = useState(null); // { width, height }
    const [showDropdown, setShowDropdown] = useState(false);

    // Pulse Animation for empty state
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!selectedDamage) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.05,
                        duration: 800,
                        useNativeDriver: true,
                        easing: Easing.inOut(Easing.ease),
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                        easing: Easing.inOut(Easing.ease),
                    }),
                ])
            ).start();
        } else {
            pulseAnim.stopAnimation();
            pulseAnim.setValue(1);
        }

        // Cleanup function ensures no memory leak on unmount
        return () => pulseAnim.stopAnimation();
    }, [selectedDamage]);

    const { width, height } = Dimensions.get('window');
    const viewShotRef = useRef();
    const damageOptions = [
        'Clean / No Damage',
        'Liquid Damage',
        'Corrosion',
        'Dent / Dings',
        'Deep Scratch',
        'Micro Scratch',
        'Shattered Glass',
        'Single Hairline Crack',
        'Impact / Chip',
        'Dead Pixel',
        'Black Spot',
        'Display Line',
        'Burn-in / Ghosting',
        'Peeling / Pitting',
        '3rd Party Repair',
        'Missing Part/Screw',
        'Unknown Material'
    ];

    useEffect(() => {
        Image.getSize(imageUri, (imgW, imgH) => {
            const screenRatio = width / height;
            const imgRatio = imgW / imgH;

            let finalWidth, finalHeight;

            if (imgRatio > screenRatio) {
                finalWidth = width;
                finalHeight = width / imgRatio;
            } else {
                finalHeight = height;
                finalWidth = height * imgRatio;
            }

            setImageLayout({ width: finalWidth, height: finalHeight });
        }, (err) => {
            console.error("Failed to load image size", err);
            // Fallback: use screen dimensions
            setImageLayout({ width: width, height: height * 0.7 });
            notify("Image Error", "Could not determine image size. Using default layout.", "warning");
        });
    }, [imageUri, width, height]);

    const handleTouchStart = (event) => {
        if (!selectedDamage) {
            notify("Select Damage Type", "Please select a damage type before drawing.", "warning");
            return;
        }

        const { locationX, locationY } = event.nativeEvent;
        const newAnno = {
            id: Date.now(),
            type: shapeType,
            label: selectedDamage,
            startX: locationX,
            startY: locationY,
            x: locationX, // Current end/drag position
            y: locationY,
        };
        setCurrentAnnotation(newAnno);
    };

    const handleTouchMove = (event) => {
        if (!currentAnnotation) return;
        const { locationX, locationY } = event.nativeEvent;
        setCurrentAnnotation({
            ...currentAnnotation,
            x: locationX,
            y: locationY,
        });
    };

    const handleTouchEnd = () => {
        if (currentAnnotation) {
            // Calculate final dimensions to ensure we don't save 0-size
            const dist = Math.hypot(currentAnnotation.x - currentAnnotation.startX, currentAnnotation.y - currentAnnotation.startY);
            if (dist > 5) { // Minimal threshold
                setAnnotations([...annotations, currentAnnotation]);
            }
            setCurrentAnnotation(null);
        }
    };

    const undoLast = () => {
        setAnnotations(annotations.slice(0, -1));
    };

    const handleSave = async () => {
        if (annotations.length === 0) {
            notify("No Annotations", "Please mark at least one area.", "warning");
            return;
        }

        try {
            const capturedUri = await viewShotRef.current.capture();

            // Metadata construction
            const metadata = {
                timestamp: new Date().toISOString(),
                annotations: annotations.map(a => ({
                    type: a.type,
                    label: a.label,
                    startX: a.startX,
                    startY: a.startY,
                    endX: a.x,
                    endY: a.y
                })),
                device_width: width,
                device_height: height,
                damage_type: selectedDamage, // Primary/Last selected
                image_context: imageContext,
            };
            onSave(capturedUri, metadata);
        } catch (error) {
            console.error("Failed to capture view:", error);
            notify("Error", "Failed to save annotated image.", "error");
        }
    };

    const handleSaveToGallery = async () => {
        try {
            const capturedUri = await viewShotRef.current.capture();

            // Check/Request Media Library permissions
            const { status } = await MediaLibrary.requestPermissionsAsync();

            if (status === 'granted') {
                // Save directly to the device's gallery
                await MediaLibrary.createAssetAsync(capturedUri);
                notify("Success", "Annotated image saved to gallery.", "success");
            } else {
                notify("Permission Error", "Need gallery access to save directly.", "error");
            }
        } catch (error) {
            console.error("Failed to save to gallery:", error);
            notify("Error", "An error occurred while saving to gallery.", "error");
        }
    };

    const handleShare = async () => {
        try {
            const capturedUri = await viewShotRef.current.capture();
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(capturedUri, {
                    dialogTitle: 'Share Annotation',
                    mimeType: 'image/jpeg',
                    UTI: 'public.jpeg'
                });
            } else {
                if (showAlert) {
                    showAlert("Error", "Sharing is not available on this device", "error");
                }
            }
        } catch (error) {
            console.error("Failed to share:", error);
            if (showAlert) {
                showAlert("Error", "Failed to share image.", "error");
            }
        }
    };

    const renderAnnotation = (anno) => {
        if (anno.label === 'Clean / No Damage') {
            return null; // Skip rendering shape entirely!
        }

        let shape;
        let cx, cy;
        // Text positioning logic moved to View layer

        if (anno.type === 'circle') {
            // Radius is distance between start and current/end
            const r = Math.hypot(anno.x - anno.startX, anno.y - anno.startY);
            cx = anno.startX;
            cy = anno.startY;
            shape = (
                <Circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    stroke="red"
                    strokeWidth="5"
                    fill="transparent"
                />
            );
        } else {
            // Rect
            const w = anno.x - anno.startX;
            const h = anno.y - anno.startY;
            const x = w < 0 ? anno.x : anno.startX;
            const y = h < 0 ? anno.y : anno.startY;

            shape = (
                <SvgRect
                    x={x}
                    y={y}
                    width={Math.abs(w)}
                    height={Math.abs(h)}
                    stroke="red"
                    strokeWidth="5"
                    fill="transparent"
                />
            );
        }

        return (
            <React.Fragment key={anno.id}>
                {shape}
            </React.Fragment>
        );
    };

    // Helper for Rect import since 'Rect' collides with React sometimes if not careful, 
    // but here we used Circle from react-native-svg. We need Rect too.
    // See imports below.

    if (!imageLayout) {
        return <View style={styles.container} />; // Loading state
    }

    return (
        <View style={styles.container}>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ViewShot
                    ref={viewShotRef}
                    options={{ format: "jpg", quality: 0.9 }}
                    style={{ width: imageLayout.width, height: imageLayout.height }}
                >
                    <View
                        style={{ flex: 1 }}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                    >
                        <ImageBackground
                            source={{ uri: imageUri }}
                            style={{ flex: 1 }}
                            resizeMode="cover"
                            onError={(e) => {
                                console.error("ImageBackground load error:", e.nativeEvent.error);
                                if (showAlert) {
                                    showAlert("Load Error", "The captured image could not be displayed.", "error");
                                }
                            }}
                        >
                            <Svg height="100%" width="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
                                {annotations.map(renderAnnotation)}
                                {currentAnnotation && renderAnnotation(currentAnnotation)}
                            </Svg>
                            {/* Render Text Labels as Absolute Views for better readability */}
                            {annotations.map((anno) => (
                                <View
                                    key={`label-${anno.id}`}
                                    pointerEvents="none"
                                    style={[
                                        styles.labelContainer,
                                        anno.label === 'Clean / No Damage' ? styles.cleanLabelContainer : styles.damageLabelContainer,
                                        {
                                            position: 'absolute',
                                            left: anno.label === 'Clean / No Damage' 
                                                ? anno.startX - 30
                                                : (anno.type === 'circle' ? anno.startX : (anno.x < anno.startX ? anno.x : anno.startX)),
                                            top: anno.label === 'Clean / No Damage'
                                                ? anno.startY - 15
                                                : (anno.type === 'circle'
                                                    ? anno.startY + Math.hypot(anno.x - anno.startX, anno.y - anno.startY) + 10
                                                    : (anno.y < anno.startY ? anno.y : anno.startY) + Math.abs(anno.y - anno.startY) + 10),
                                        }
                                    ]}
                                >
                                    <Text style={[
                                        styles.labelText,
                                        anno.label === 'Clean / No Damage' ? styles.cleanLabelText : styles.damageLabelText
                                    ]}>{anno.label}</Text>
                                </View>
                            ))}
                            {currentAnnotation && currentAnnotation.label && (
                                <View
                                    pointerEvents="none"
                                    style={[
                                        styles.labelContainer,
                                        currentAnnotation.label === 'Clean / No Damage' ? styles.cleanLabelContainer : styles.damageLabelContainer,
                                        {
                                            position: 'absolute',
                                            left: currentAnnotation.label === 'Clean / No Damage'
                                                ? currentAnnotation.startX - 30
                                                : (currentAnnotation.type === 'circle' ? currentAnnotation.startX : (currentAnnotation.x < currentAnnotation.startX ? currentAnnotation.x : currentAnnotation.startX)),
                                            top: currentAnnotation.label === 'Clean / No Damage'
                                                ? currentAnnotation.startY - 15
                                                : (currentAnnotation.type === 'circle'
                                                    ? currentAnnotation.startY + Math.hypot(currentAnnotation.x - currentAnnotation.startX, currentAnnotation.y - currentAnnotation.startY) + 10
                                                    : (currentAnnotation.y < currentAnnotation.startY ? currentAnnotation.y : currentAnnotation.startY) + Math.abs(currentAnnotation.y - currentAnnotation.startY) + 10),
                                        }
                                    ]}
                                >
                                    <Text style={[
                                        styles.labelText,
                                        currentAnnotation.label === 'Clean / No Damage' ? styles.cleanLabelText : styles.damageLabelText
                                    ]}>{currentAnnotation.label}</Text>
                                </View>
                            )}
                        </ImageBackground>
                    </View>
                </ViewShot>
            </View>

            {/* Top Controls: Context Toggle */}
            <View style={styles.topContextWrapper}>
                <View style={styles.contextContainer}>
                    {['Front', 'Back', 'Inner', 'Hinge'].map((ctx) => (
                        <ScaleButton
                            key={ctx}
                            style={[
                                styles.contextButton,
                                imageContext === ctx && styles.contextButtonSelected
                            ]}
                            onPress={() => setImageContext(ctx)}
                        >
                            <Text style={[
                                styles.contextText,
                                imageContext === ctx && styles.contextTextSelected
                            ]}>
                                {ctx === 'Inner Screen' ? 'Inner' : ctx}
                            </Text>
                        </ScaleButton>
                    ))}
                </View>
            </View>

            {/* Top Controls: Damage Dropdown Only */}
            <View style={styles.topControls}>
                {/* Damage Dropdown Trigger */}


                <Modal
                    visible={showDropdown}
                    transparent={true}
                    animationType="slide"
                    onRequestClose={() => setShowDropdown(false)}
                >
                    <TouchableWithoutFeedback onPress={() => setShowDropdown(false)}>
                        <View style={styles.modalOverlay}>
                            <TouchableWithoutFeedback>
                                <View style={styles.bottomSheet}>
                                    <View style={styles.bottomSheetHeader}>
                                        <Text style={styles.bottomSheetTitle}>Select Damage Type</Text>
                                    </View>
                                    <View style={{ height: height * 0.58 }}>
                                        <ScrollView contentContainerStyle={styles.bottomSheetContent}>
                                            {damageOptions.map((option) => (
                                                <ScaleButton
                                                    key={option}
                                                    style={[
                                                        styles.bottomSheetItem,
                                                        selectedDamage === option && styles.bottomSheetItemSelected
                                                    ]}
                                                    onPress={() => {
                                                        setSelectedDamage(option);
                                                        setShowDropdown(false);
                                                    }}
                                                >
                                                    <Text style={[
                                                        styles.bottomSheetItemText,
                                                        selectedDamage === option && styles.bottomSheetItemTextSelected
                                                    ]}>
                                                        {option}
                                                    </Text>
                                                    {selectedDamage === option && <Text style={styles.checkMark}>{'✓'}</Text>}
                                                </ScaleButton>
                                            ))}
                                        </ScrollView>
                                    </View>
                                    <ScaleButton
                                        style={styles.cancelSheetButton}
                                        onPress={() => setShowDropdown(false)}
                                    >
                                        <Text style={styles.cancelSheetText}>Cancel</Text>
                                    </ScaleButton>
                                </View>
                            </TouchableWithoutFeedback>
                        </View>
                    </TouchableWithoutFeedback>
                </Modal>

            </View>

            {/* Bottom Controls Container */}
            <View style={styles.bottomContainer}>
                {/* Damage Selector Trigger (Thumb-friendly) */}
                <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%', alignItems: 'center' }}>
                    <ScaleButton
                        style={styles.bottomTriggerContainer}
                        onPress={() => setShowDropdown(true)}
                    >
                        <View style={styles.bottomTrigger}>
                            <Text style={styles.bottomTriggerText}>
                                {selectedDamage || "Select Damage Type"}
                            </Text>
                        </View>
                    </ScaleButton>
                </Animated.View>

                <View style={styles.controls}>
                    <ScaleButton onPress={onCancel} style={styles.actionButtonContainer}>
                        <View style={[styles.actionButtonBlur, styles.cancelButton]}>
                            <Text style={styles.buttonText}>Retake</Text>
                        </View>
                    </ScaleButton>

                    <ScaleButton onPress={undoLast} style={styles.actionButtonContainer}>
                        <View style={[styles.actionButtonBlur, styles.undoButton]}>
                            <Text style={styles.buttonText}>Undo</Text>
                        </View>
                    </ScaleButton>

                    {/* Share Button */}
                    <ScaleButton onPress={handleShare} style={styles.actionButtonContainer}>
                        <View style={[styles.actionButtonBlur, styles.shareButton]}>
                            <Text style={styles.buttonText}>Share</Text>
                        </View>
                    </ScaleButton>

                    {/* Save to Device Button */}
                    <ScaleButton onPress={handleSaveToGallery} style={styles.actionButtonContainer}>
                        <View style={[styles.actionButtonBlur, styles.galleryButton]}>
                            <Text style={styles.buttonText}>Save</Text>
                        </View>
                    </ScaleButton>

                    <ScaleButton onPress={handleSave} style={styles.actionButtonContainer}>
                        <View style={[styles.actionButtonBlur, styles.saveButton]}>
                            <Text style={styles.buttonText}>Send</Text>
                        </View>
                    </ScaleButton>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {

        flex: 1,
        backgroundColor: 'black',
    },
    image: {
        flex: 1,
        width: '100%',
        height: '100%',
    },
    labelContainer: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 26,
        alignSelf: 'flex-start',
        borderWidth: 1.5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 4,
    },
    labelText: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    cleanLabelContainer: {
        backgroundColor: 'rgba(34, 197, 94, 0.25)', // Green glassmorphism
        borderColor: '#22c55e',
    },
    cleanLabelText: {
        color: '#4ade80', // Vibrant green
    },
    damageLabelContainer: {
        backgroundColor: 'rgba(239, 68, 68, 0.25)', // Red glassmorphism
        borderColor: '#ef4444',
    },
    damageLabelText: {
        color: '#f87171', // Vibrant red
    },
    topControls: {
        position: 'absolute',
        top: 50,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 10, // Ensure dropdown is on top
    },
    dropdownButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    bottomContainer: {
        position: 'absolute',
        bottom: 30,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    bottomTriggerContainer: {
        marginBottom: 20,
        borderRadius: 26, // One UI Squircle
        overflow: 'hidden',
        width: '60%',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
        elevation: 6,
        backgroundColor: '#252525', // Solid Surface
    },
    bottomTrigger: {
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#252525', // Solid Surface
    },
    bottomTriggerText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    chevron: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 12,
        marginTop: 4,
    },
    controls: {
        flexDirection: 'row',
        justifyContent: 'center',
        width: '100%',
        alignItems: 'center',
        paddingHorizontal: 10,
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    bottomSheet: {
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        overflow: 'hidden',
        padding: 20,
        paddingBottom: 40,
        backgroundColor: '#1C1C1E', // One UI Dark Background
    },
    bottomSheetHeader: {
        alignItems: 'flex-start', // Left align for One UI
        marginBottom: 20,
        paddingBottom: 15,
        borderBottomWidth: 0,
    },
    bottomSheetContent: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        paddingBottom: 20,
    },
    bottomSheetItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 12,
        borderRadius: 18,
        marginBottom: 10,
        backgroundColor: '#2C2C2E',
        width: '48%',
        minHeight: 60,
    },
    bottomSheetItemSelected: {
        backgroundColor: 'rgba(99, 102, 241, 0.25)',
        borderWidth: 1.5,
        borderColor: 'rgba(99, 102, 241, 0.5)',
    },
    bottomSheetItemText: {
        color: '#ccc',
        fontSize: 13,
        fontWeight: '600',
        flex: 1,
    },
    bottomSheetItemTextSelected: {
        color: 'white',
        fontWeight: 'bold',
    },
    checkMark: {
        color: '#6366f1',
        fontSize: 18,
        fontWeight: 'bold',
    },
    cancelSheetButton: {
        marginTop: 10,
        paddingVertical: 15,
        alignItems: 'center',
        backgroundColor: '#2C2C2E', // Solid
        borderRadius: 26,
    },
    cancelSheetText: {
        color: '#ff3b30',
        fontSize: 16,
        fontWeight: 'bold',
    },
    topContextWrapper: {
        position: 'absolute',
        top: 60, // Below potential header or notch area
        width: '100%',
        alignItems: 'center',
        zIndex: 20,
    },
    contextContainer: {
        flexDirection: 'row', // Horizontal
        backgroundColor: '#252525',
        borderRadius: 20,
        paddingVertical: 6,
        paddingHorizontal: 10,
        gap: 8,
        alignItems: 'center',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
        elevation: 6,
    },
    contextButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 16,
        backgroundColor: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
        minWidth: 60,
    },
    contextButtonSelected: {
        backgroundColor: '#6366f1',
    },
    contextText: {
        color: '#888',
        fontWeight: '600',
        fontSize: 12,
    },
    contextTextSelected: {
        color: 'white',
        fontWeight: 'bold',
    },

    actionButtonContainer: {
        flex: 1,
        flexShrink: 1,
        minWidth: 60,
        maxWidth: 100,
        borderRadius: 26,
        overflow: 'hidden',
        marginHorizontal: 4,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 6,
    },
    actionButtonBlur: {
        paddingVertical: 12,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButton: {
        backgroundColor: '#3E3E3E',
    },
    undoButton: {
        backgroundColor: '#3E3E3E',
    },
    galleryButton: {
        backgroundColor: '#10b981', // Emerald – local save
    },
    shareButton: {
        backgroundColor: '#f59e0b', // Amber - share
    },
    saveButton: {
        backgroundColor: '#6366f1', // Indigo
    },
    buttonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 13,
    },
});

import React, { useState } from 'react';
import { StyleSheet, Text, View, Modal, Image, Dimensions } from 'react-native';
import ScaleButton from './ScaleButton';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const OnboardingModal = ({ visible, onComplete, onDismiss }) => {
    const [step, setStep] = useState(0);

    const steps = [
        {
            title: "Welcome to Defect Tagger",
            description: "High-precision damage capture and secure syncing. Let's get you connected to your PC hub.",
            icon: "camera-iris",
            button: "Next"
        },
        {
            title: "Same Wi-Fi Required",
            description: "Ensure your mobile device and PC are on the same local network for secure syncing.",
            icon: "wifi",
            button: "Got it"
        },
        {
            title: "PC Hub Ready?",
            description: "Open 'Defect Tagger Hub' on your PC. It will show your IP address and wait for connection.",
            icon: "monitor-dashboard",
            button: "I'm Ready"
        },
        {
            title: "One-Tap Connect",
            description: "Tap 'Auto-Connect' in settings. You'll need to approve the request on your PC to finish pairing.",
            icon: "cellphone-link",
            button: "Start Using App"
        }
    ];

    const handleNext = () => {
        if (step < steps.length - 1) {
            setStep(step + 1);
        } else {
            onComplete();
        }
    };

    const current = steps[step];

    return (
        <Modal visible={visible} animationType="slide" transparent>
            <View style={styles.overlay}>
                <View style={styles.container}>
                    {/* Progress Indicator */}
                    <View style={styles.progressRow}>
                        {steps.map((_, i) => (
                            <View 
                                key={i} 
                                style={[styles.dot, step === i && styles.activeDot]} 
                            />
                        ))}
                    </View>

                    <View style={styles.iconContainer}>
                        <MaterialCommunityIcons name={current.icon} size={80} color="#6366F1" />
                    </View>

                    <Text style={styles.title}>{current.title}</Text>
                    <Text style={styles.description}>{current.description}</Text>

                    <View style={styles.footer}>
                        <ScaleButton onPress={handleNext} style={styles.nextButton}>
                            <View style={styles.buttonInner}>
                                <Text style={styles.buttonText}>{current.button}</Text>
                            </View>
                        </ScaleButton>
                        
                        <ScaleButton onPress={onDismiss} style={styles.skipButton}>
                            <Text style={styles.skipText}>Skip Onboarding</Text>
                        </ScaleButton>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.85)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    container: {
        width: width * 0.85,
        backgroundColor: '#1C1C1E',
        borderRadius: 32,
        padding: 30,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    progressRow: {
        flexDirection: 'row',
        marginBottom: 30,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#444',
        marginHorizontal: 5,
    },
    activeDot: {
        backgroundColor: '#6366F1',
        width: 20,
    },
    iconContainer: {
        marginBottom: 20,
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        padding: 20,
        borderRadius: 40,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: 'white',
        textAlign: 'center',
        marginBottom: 15,
    },
    description: {
        fontSize: 16,
        color: '#AAA',
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 30,
    },
    footer: {
        width: '100%',
        alignItems: 'center',
    },
    nextButton: {
        width: '100%',
        borderRadius: 20,
        overflow: 'hidden',
        marginBottom: 15,
    },
    buttonInner: {
        backgroundColor: '#6366F1',
        paddingVertical: 16,
        alignItems: 'center',
    },
    buttonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 18,
    },
    skipButton: {
        padding: 10,
    },
    skipText: {
        color: '#666',
        fontSize: 14,
    }
});

export default OnboardingModal;

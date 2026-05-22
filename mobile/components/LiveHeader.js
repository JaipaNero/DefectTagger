import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Animated, Easing, Dimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

const { width } = Dimensions.get('window');

/**
 * LiveHeader Component
 * Displays a non-blocking status notification at the top of the screen.
 * 
 * @param {string} status - 'idle' | 'uploading' | 'success' | 'error'
 * @param {string} message - Optional custom message
 */
export default function LiveHeader({ status, message }) {
    const translateY = useRef(new Animated.Value(-100)).current;

    useEffect(() => {
        if (status !== 'idle') {
            // Slide Down
            Animated.timing(translateY, {
                toValue: 0,
                duration: 400,
                useNativeDriver: true,
                easing: Easing.out(Easing.back(1.5)),
            }).start();
        } else {
            // Slide Up
            Animated.timing(translateY, {
                toValue: -150,
                duration: 300,
                useNativeDriver: true,
                easing: Easing.in(Easing.cubic),
            }).start();
        }
    }, [status]);

    const getStatusConfig = () => {
        switch (status) {
            case 'uploading':
                return { icon: 'cloud-upload-outline', color: '#6366f1', text: 'Syncing to Secure Hub...' };
            case 'success':
                return { icon: 'check-circle-outline', color: '#10b981', text: 'Secure Upload Complete' };
            case 'error':
                return { icon: 'alert-circle-outline', color: '#ef4444', text: message || 'Upload Failed' };
            default:
                return { icon: 'information-outline', color: '#888', text: '' };
        }
    };

    const config = getStatusConfig();

    return (
        <Animated.View style={[styles.container, { transform: [{ translateY }] }]}>
            <BlurView intensity={80} tint="dark" style={styles.blurContainer}>
                <View style={[styles.iconContainer, { backgroundColor: config.color + '20' }]}>
                    <MaterialCommunityIcons name={config.icon} size={20} color={config.color} />
                </View>
                <Text style={styles.text}>{config.text}</Text>
                {status === 'success' && (
                    <MaterialCommunityIcons name="check" size={16} color="#10b981" style={{ marginLeft: 'auto' }} />
                )}
            </BlurView>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 50, // Below notch/island
        left: 20,
        right: 20,
        zIndex: 1000,
        borderRadius: 20, // One UI Squircle-ish
        overflow: 'hidden',
        // Shadow
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.30,
        shadowRadius: 4.65,
        elevation: 8,
    },
    blurContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: 'rgba(30, 30, 30, 0.7)',
    },
    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    text: {
        color: 'white',
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: 0.5,
    }
});

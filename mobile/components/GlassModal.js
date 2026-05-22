import React from 'react';
import { Modal, Text, View, StyleSheet, TouchableWithoutFeedback } from 'react-native';

import ScaleButton from './ScaleButton';

const GlassModal = ({ visible, title, message, onDismiss, type = 'info', actions = [] }) => {
    // Determine icon and color based on type
    const getIcon = () => {
        switch (type) {
            case 'success': return '✓';
            case 'error': return '!';
            case 'warning': return '⚠';
            default: return 'i';
        }
    };

    const getColor = () => {
        switch (type) {
            case 'success': return '#28a745';
            case 'error': return '#ff3b30';
            case 'warning': return '#ffcc00';
            default: return '#6366f1';
        }
    };

    const color = getColor();

    return (
        <Modal
            transparent
            visible={visible}
            animationType="fade"
            onRequestClose={onDismiss}
        >
            <View style={styles.overlay}>
                <View style={styles.container}>
                    <View style={styles.content}>
                        <View style={[styles.iconContainer, { borderColor: color, backgroundColor: color + '20' }]}>
                            <Text style={[styles.icon, { color }]}>{getIcon()}</Text>
                        </View>

                        <Text style={styles.title}>{title}</Text>
                        {message ? <Text style={styles.message}>{message}</Text> : null}

                        <View style={styles.actions}>
                            {actions.length > 0 ? (
                                actions.map((action, index) => (
                                    <ScaleButton
                                        key={index}
                                        style={[styles.button, action.style, { backgroundColor: index === 0 ? '#6366f1' : '#3E3E3E' }]}
                                        onPress={action.onPress}
                                    >
                                        <Text style={[styles.buttonText, action.textStyle]}>{action.text}</Text>
                                    </ScaleButton>
                                ))
                            ) : (
                                <ScaleButton style={[styles.button, { backgroundColor: '#3E3E3E' }]} onPress={onDismiss}>
                                    <Text style={styles.buttonText}>OK</Text>
                                </ScaleButton>
                            )}
                        </View>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    container: {
        width: '85%',
        borderRadius: 26, // One UI Squircle
        overflow: 'hidden',
        borderWidth: 0,
        backgroundColor: '#1C1C1E', // Solid Background
        elevation: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.5,
        shadowRadius: 15,
    },
    content: {
        padding: 25,
        alignItems: 'flex-start', // Left align for One UI
        backgroundColor: '#1C1C1E',
    },
    iconContainer: {
        width: 50,
        height: 50,
        borderRadius: 25,
        borderWidth: 0,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 15,
    },
    icon: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    title: {
        color: 'white',
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 10,
        textAlign: 'left', // One UI style
    },
    message: {
        color: '#ccc',
        fontSize: 16,
        textAlign: 'left', // One UI style
        marginBottom: 20,
        lineHeight: 22,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end', // Align buttons to right usually, or center for simple alerts
        justifyContent: 'center',
        width: '100%',
    },
    button: {
        backgroundColor: '#3E3E3E', // Solid default handling
        paddingVertical: 14,
        paddingHorizontal: 25,
        borderRadius: 26,
        minWidth: 100,
        alignItems: 'center',
        marginHorizontal: 5,
    },
    buttonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default GlassModal;

import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const TroubleshooterModal = ({ visible, onClose }) => {
    return (
        <Modal
            animationType="slide"
            transparent={true}
            visible={visible}
            onRequestClose={onClose}
        >
            <View style={styles.centeredView}>
                <View style={styles.modalView}>
                    <View style={styles.header}>
                        <Text style={styles.modalTitle}>Connection Troubleshooter</Text>
                        <TouchableOpacity onPress={onClose}>
                            <Ionicons name="close" size={24} color="#666" />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.content}>
                        <View style={styles.step}>
                            <Text style={styles.stepNumber}>1</Text>
                            <View style={styles.stepTextContainer}>
                                <Text style={styles.stepTitle}>Check Network Profile</Text>
                                <Text style={styles.stepDescription}>
                                    On your PC, ensure your Wi-Fi is set to "Private" rather than "Public". 
                                    Go to Settings &gt; Network &amp; Internet &gt; Properties.
                                </Text>
                            </View>
                        </View>

                        <View style={styles.step}>
                            <Text style={styles.stepNumber}>2</Text>
                            <View style={styles.stepTextContainer}>
                                <Text style={styles.stepTitle}>Windows Firewall</Text>
                                <Text style={styles.stepDescription}>
                                    When starting the Hub, ensure you click "Allow Access" for both Private and Public networks. 
                                    If unsure, try restarting the Hub.
                                </Text>
                            </View>
                        </View>

                        <View style={styles.step}>
                            <Text style={styles.stepNumber}>3</Text>
                            <View style={styles.stepTextContainer}>
                                <Text style={styles.stepTitle}>Same Wi-Fi Network</Text>
                                <Text style={styles.stepDescription}>
                                    Ensure your Phone is on the same Wi-Fi as your PC. Check for "AP Isolation" 
                                    settings on store routers which may block local device communication.
                                </Text>
                            </View>
                        </View>

                        <View style={styles.step}>
                            <Text style={styles.stepNumber}>4</Text>
                            <View style={styles.stepTextContainer}>
                                <Text style={styles.stepTitle}>Manual IP Address</Text>
                                <Text style={styles.stepDescription}>
                                    If auto-discovery still fails, enter the IP shown on the Hub dashboard manually 
                                    into the field on the settings screen.
                                </Text>
                            </View>
                        </View>
                    </ScrollView>

                    <TouchableOpacity
                        style={styles.buttonClose}
                        onPress={onClose}
                    >
                        <Text style={styles.textStyle}>Got it</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    centeredView: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalView: {
        width: '90%',
        maxHeight: '80%',
        backgroundColor: 'white',
        borderRadius: 20,
        padding: 20,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        marginBottom: 20,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#333',
    },
    content: {
        width: '100%',
    },
    step: {
        flexDirection: 'row',
        marginBottom: 20,
        alignItems: 'flex-start',
    },
    stepNumber: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: '#007AFF',
        color: 'white',
        textAlign: 'center',
        lineHeight: 30,
        fontWeight: 'bold',
        marginRight: 15,
    },
    stepTextContainer: {
        flex: 1,
    },
    stepTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111',
        marginBottom: 4,
    },
    stepDescription: {
        fontSize: 14,
        color: '#666',
        lineHeight: 20,
    },
    buttonClose: {
        backgroundColor: '#007AFF',
        borderRadius: 12,
        padding: 15,
        width: '100%',
        marginTop: 10,
    },
    textStyle: {
        color: 'white',
        fontWeight: 'bold',
        textAlign: 'center',
        fontSize: 16,
    },
});

export default TroubleshooterModal;

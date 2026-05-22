import React, { useState } from 'react';
import { StyleSheet, Text, View, Modal, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import ScaleButton from './components/ScaleButton';
import CameraView from './components/CameraView';
import AnnotationCanvas from './components/AnnotationCanvas';
import GlassModal from './components/GlassModal';
import LiveHeader from './components/LiveHeader';
import OnboardingModal from './components/OnboardingModal';
import TroubleshooterModal from './components/TroubleshooterModal';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { useSyncStore } from './utils/useSyncStore';
import { requestPairing, pollPairingStatus, handshake, clearQueue, sendToClipboard } from './utils/api';
import * as Haptics from 'expo-haptics';


const ONBOARDING_COMPLETE_KEY = 'defect_tagger_onboarding_v1';
export default function App() {
    const { 
        ipAddress, technicianId, status, message, queueLength, isDiscovering, discoveryProgress,
        saveSettings, startDiscovery, performUpload, processFullQueue, refreshQueue,
        setIpAddress, setTechnicianId 
    } = useSyncStore();

    const [view, setView] = useState('camera'); // 'camera', 'annotation', 'scanner'
    const [imageUri, setImageUri] = useState(null);
    const [isSettingsVisible, setSettingsVisible] = useState(false);
    const [isOnboardingVisible, setOnboardingVisible] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [modalConfig, setModalConfig] = useState({ title: '', message: '', type: 'info' });
    const [sessionHistory, setSessionHistory] = useState([]);
    const [foundServers, setFoundServers] = useState([]);
    const [isServerPickerVisible, setServerPickerVisible] = useState(false);
    const [isTroubleshooterVisible, setTroubleshooterVisible] = useState(false);

    const showAlert = (title, message, type = 'info', actions = []) => {
        setModalConfig({ title, message, type, actions });
        setModalVisible(true);
    };

    const handleAutoConnect = async () => {
        if (!technicianId) {
            showAlert("Required", "Please enter a Technician ID first.", "warning");
            setSettingsVisible(true);
            return;
        }

        const servers = await startDiscovery();

        if (servers.length === 0) {
            showAlert(
                "Not Found", 
                "Defect Tagger Server not found on Wi-Fi.", 
                "error",
                [
                    { text: "Troubleshoot", onPress: () => { setModalVisible(false); setTroubleshooterVisible(true); } },
                    { text: "OK", onPress: () => setModalVisible(false) }
                ]
            );
            return;
        }

        if (servers.length === 1) {
            connectToServer(servers[0].ip, servers[0].name);
        } else {
            setFoundServers(servers);
            setServerPickerVisible(true);
        }
    };

    const connectToServer = async (targetIp, serverName) => {
        setServerPickerVisible(false);
        setModalConfig({ title: "Connecting", message: `Waiting for approval on ${serverName}...`, type: 'info' });
        setModalVisible(true);

        const reqResult = await requestPairing(targetIp);
        if (reqResult.error) {
            setModalVisible(false);
            showAlert("Pairing Error", reqResult.error, "error");
            return;
        }

        const pollInterval = setInterval(async () => {
            const statusRes = await pollPairingStatus(targetIp, reqResult.request_id);

            if (statusRes.error) {
                clearInterval(pollInterval);
                setModalVisible(false);
                showAlert("Error", statusRes.error, "error");
                return;
            }

            if (statusRes.status === 'denied') {
                clearInterval(pollInterval);
                setModalVisible(false);
                showAlert("Denied", "Connection request was denied by PC.", "error");
                return;
            }

            if (statusRes.status === 'approved') {
                clearInterval(pollInterval);
                setModalVisible(false);

                if (statusRes.setup_token) {
                    const hs = await handshake(targetIp, statusRes.setup_token, technicianId);
                    if (hs.success) {
                        await saveSettings(targetIp, technicianId);
                        setSettingsVisible(false); 
                        showAlert("Connected", `Successfully paired with ${serverName}!`, "success");
                    } else {
                        showAlert("Handshake Failed", hs.error, "error");
                    }
                }
            }
        }, 2000);

        setTimeout(() => clearInterval(pollInterval), 60000);
    };

    const handleCapture = (uri) => {
        setImageUri(uri);
        setView('annotation');
    };

    const handleAnnotationSaveInternal = async (uri, metadata) => {
        if (!ipAddress || !technicianId) {
            showAlert("Configuration Missing", "Please set Technician ID and IP Address.", "warning");
            setSettingsVisible(true);
            return;
        }

        setView('camera');
        setImageUri(null);

        // Sanitize device metadata
        const finalMetadata = {
            technician_id: technicianId,
            device_id: (Device.modelName + "_" + (Application.androidId || "unknown")).replace(/[^a-zA-Z0-9_-]/g, '_'),
            damage_type: metadata.damage_type || 'manual_capture',
            timestamp: new Date().toISOString(),
        };

        const newItem = {
            id: Date.now().toString(),
            timestamp: new Date().toLocaleTimeString(),
            damageType: finalMetadata.damage_type,
            status: 'pending'
        };
        setSessionHistory(prev => [newItem, ...prev]);

        await performUpload(uri, finalMetadata);
        setSessionHistory(prev => prev.map(item => item.id === newItem.id ? { ...item, status: status === 'error' ? 'error' : 'success' } : item));
    };

    const handleCancelAnnotation = () => {
        setImageUri(null);
        setView('camera');
    };

    const handleSaveConfig = async () => {
        await saveSettings(ipAddress, technicianId);
        setSettingsVisible(false);
    };

    const handleBarcodeScanned = async ({ data }) => {
        if (view !== 'scanner') return;
        
        // Haptic feedback for scan
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        
        setView('camera'); 
        
        try {
            const parsed = JSON.parse(data);
            if (parsed.ip && parsed.token) {
                if (!technicianId) {
                    showAlert("Required", "Please enter a Technician ID before pairing.", "warning");
                    setSettingsVisible(true);
                    return;
                }

                setModalConfig({ title: "Connecting", message: `Found server at ${parsed.ip}. Handshaking...`, type: 'info' });
                setModalVisible(true);
                
                const hs = await handshake(parsed.ip, parsed.token, technicianId);
                if (hs.success) {
                    await saveSettings(parsed.ip, technicianId);
                    setSettingsVisible(false);
                    setModalVisible(false);
                    showAlert("Connected", "Successfully paired via QR!", "success");
                } else {
                    setModalVisible(false);
                    showAlert("Handshake Failed", hs.error, "error");
                }
            } else {
                showAlert("Invalid QR", "This QR code is not a valid Defect Tagger pairing code.", "warning");
            }
        } catch (e) {
            showAlert("Error", "Could not read QR code data format.", "error");
        }
    };

    const handleImeiScanned = async ({ data }) => {
        if (view !== 'barcode') return;
        
        // Haptic feedback for scan
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        
        setView('camera'); 
        
        if (!ipAddress) {
            showAlert("Not Connected", "Please pair with a PC first to sync clipboard.", "warning");
            return;
        }
        
        showAlert("Sending", `Sending SN/IMEI to PC clipboard:\n${data}`, "info");
        
        const res = await sendToClipboard(data, ipAddress);
        if (res.success) {
            showAlert("Clipboard Synced", `Successfully sent to PC Clipboard:\n${data}`, "success");
        } else {
            showAlert("Failed to Sync", `Could not send to PC Clipboard: ${res.error}`, "error");
        }
    };



    return (
        <SafeAreaProvider>
            <SafeAreaView style={styles.container}>
                <LiveHeader status={status} message={message} />

                  {(view === 'camera' || view === 'scanner' || view === 'barcode') && (
                    <View style={{ flex: 1 }}>
                        <CameraView
                            onCapture={handleCapture}
                            onBarcodeScanned={view === 'scanner' ? handleBarcodeScanned : handleImeiScanned}
                            isScanning={view === 'scanner' || view === 'barcode'}
                            scannerMode={view === 'scanner' ? 'qr' : (view === 'barcode' ? 'barcode' : null)}
                            onToggleBarcodeScan={() => setView(view === 'barcode' ? 'camera' : 'barcode')}
                        />

                        {(view === 'camera' || view === 'scanner' || view === 'barcode') && (
                            <>
                                <ScaleButton style={styles.settingsButtonContainer} onPress={() => {
                                    if (view === 'scanner' || view === 'barcode') setView('camera');
                                    else setSettingsVisible(true);
                                }}>
                                    <View style={styles.settingsBlur}>
                                        <MaterialCommunityIcons 
                                            name={(view === 'scanner' || view === 'barcode') ? 'close' : 'cog'} 
                                            size={22} 
                                            color="white" 
                                        />
                                    </View>
                                </ScaleButton>

                                {queueLength > 0 && (
                                    <ScaleButton style={styles.queueButtonContainer} onPress={() => {
                                        showAlert("Offline Queue", `You have ${queueLength} cached upload(s).`, "info", [
                                            { text: "Cancel" },
                                            { text: "Clear All", onPress: async () => { await clearQueue(); refreshQueue(); } },
                                            { text: "Upload All", onPress: processFullQueue }
                                        ]);
                                    }}>
                                        <View style={styles.queueBlur}>
                                            <MaterialCommunityIcons 
                                                name="cloud-sync" 
                                                size={18} 
                                                color="#ffa500" 
                                                style={{ marginRight: 6 }} 
                                            />
                                            <Text style={styles.queueText}>
                                                {queueLength} Cached
                                            </Text>
                                        </View>
                                    </ScaleButton>
                                )}
                            </>
                        )}
                    </View>
                )}



                {view === 'annotation' && imageUri && (
                    <AnnotationCanvas
                        imageUri={imageUri}
                        onSave={handleAnnotationSaveInternal}
                        onCancel={handleCancelAnnotation}
                        showAlert={showAlert}
                    />
                )}

                {/* Settings Modal */}
                <Modal visible={isSettingsVisible} animationType="fade" transparent>
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            <View style={styles.modalInnerContent}>
                                <Text style={styles.modalTitle}>Configure PC Connection</Text>

                                <Text style={styles.label}>Technician ID:</Text>
                                <TextInput
                                    style={styles.input}
                                    value={technicianId}
                                    onChangeText={setTechnicianId}
                                    placeholder="e.g. tech_01"
                                    placeholderTextColor="#888"
                                    autoCapitalize="none"
                                />

                                <View style={styles.pairingRow}>
                                    <ScaleButton onPress={handleAutoConnect} disabled={isDiscovering} style={styles.pairingBtn}>
                                        <View style={[styles.autoConnectButton, isDiscovering && styles.disabledButton, { paddingVertical: 12 }]}>
                                            <Text style={[styles.autoConnectText, { fontSize: 13 }]}>
                                                {isDiscovering ? 'Searching...' : 'Auto-Find'}
                                            </Text>

                                        </View>
                                    </ScaleButton>

                                    <ScaleButton onPress={() => { setSettingsVisible(false); setView('scanner'); }} style={styles.pairingBtn}>
                                        <View style={styles.qrScannerButton}>
                                            <Text style={[styles.autoConnectText, { fontSize: 13 }]}>Scan QR</Text>

                                        </View>
                                    </ScaleButton>
                                </View>

                                {isDiscovering && (
                                    <Text style={[styles.statusText, { marginBottom: 20 }]}>
                                        Scanning Network... {(discoveryProgress * 100).toFixed(0)}%
                                    </Text>
                                )}

                                <Text style={styles.label}>Or enter PC IP Address manually:</Text>
                                <TextInput
                                    style={styles.input}
                                    value={ipAddress}
                                    onChangeText={setIpAddress}
                                    placeholder="192.168.1.X"
                                    placeholderTextColor="#888"
                                    keyboardType="numeric"
                                />

                                <View style={styles.buttonRow}>
                                    <ScaleButton onPress={handleSaveConfig} style={styles.fullBtn}>
                                        <View style={[styles.modalButtonBlur, { backgroundColor: '#22c55e' }]}>
                                            <Text style={styles.saveButtonText}>Save Configuration</Text>
                                        </View>
                                    </ScaleButton>
                                </View>
                                <ScaleButton onPress={() => setSettingsVisible(false)} style={styles.fullBtn}>
                                    <View style={[styles.modalButtonBlur, { backgroundColor: '#333' }]}>
                                        <Text style={styles.saveButtonText}>Close</Text>
                                    </View>
                                </ScaleButton>

                                <TouchableOpacity onPress={() => setTroubleshooterVisible(true)} style={{ marginTop: 15 }}>
                                    <Text style={{ color: '#007AFF', textAlign: 'center', fontSize: 14 }}>
                                        Connection Problems? Open Troubleshooter
                                    </Text>
                                </TouchableOpacity>

                                <View style={styles.historyContainer}>
                                    <Text style={styles.historyTitle}>Session History</Text>
                                    <ScrollView style={styles.historyList}>
                                        {sessionHistory.map((item) => (
                                            <View key={item.id} style={styles.historyCard}>
                                                <MaterialCommunityIcons
                                                    name={item.status === 'success' ? 'check-circle' : item.status === 'pending' ? 'clock-outline' : 'alert-circle'}
                                                    size={20}
                                                    color={item.status === 'success' ? '#4CAF50' : item.status === 'pending' ? '#FFA500' : '#F44336'}
                                                />
                                                <View style={styles.cardInfo}>
                                                    <Text style={styles.cardTitle}>{item.damageType.toUpperCase()}</Text>
                                                    <Text style={styles.cardTime}>
                                                        {item.timestamp} • {item.status.toUpperCase()}
                                                        {item.totalTime ? ` • ${item.totalTime}ms` : ''}
                                                    </Text>
                                                </View>
                                            </View>
                                        ))}
                                        {sessionHistory.length === 0 && (
                                            <Text style={styles.emptyHistory}>No uploads in this session</Text>
                                        )}
                                    </ScrollView>
                                </View>
                            </View>
                        </View>
                    </View>
                </Modal>

                <GlassModal
                    visible={modalVisible}
                    title={modalConfig.title}
                    message={modalConfig.message}
                    type={modalConfig.type}
                    actions={modalConfig.actions}
                    onDismiss={() => setModalVisible(false)}
                />

                <OnboardingModal 
                    visible={isOnboardingVisible} 
                    onComplete={async () => {
                        await SecureStore.setItemAsync(ONBOARDING_COMPLETE_KEY, 'true');
                        setOnboardingVisible(false);
                        setSettingsVisible(true); // Guide them to settings after onboarding
                    }}
                    onDismiss={() => setOnboardingVisible(false)}
                />

                {/* Server Selection Modal */}
                <Modal visible={isServerPickerVisible} transparent animationType="slide">
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContent}>
                            <View style={styles.modalInnerContent}>
                                <Text style={styles.modalTitle}>Select Defect Hub PC</Text>
                                <ScrollView style={{ maxHeight: 300 }}>
                                    {foundServers.map((server, idx) => (
                                        <TouchableOpacity 
                                            key={idx} 
                                            style={styles.serverItem}
                                            onPress={() => connectToServer(server.ip, server.name)}
                                        >
                                            <MaterialCommunityIcons name="desktop-classic" size={24} color="#007AFF" />
                                            <View style={{ marginLeft: 15 }}>
                                                <Text style={{ color: 'white', fontWeight: '600' }}>{server.name}</Text>
                                                <Text style={{ color: '#888', fontSize: 12 }}>{server.ip}</Text>
                                            </View>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                                <ScaleButton onPress={() => setServerPickerVisible(false)} style={styles.fullBtn}>
                                    <View style={[styles.modalButtonBlur, { backgroundColor: '#333' }]}>
                                        <Text style={styles.saveButtonText}>Cancel</Text>
                                    </View>
                                </ScaleButton>
                            </View>
                        </View>
                    </View>
                </Modal>

                <TroubleshooterModal 
                    visible={isTroubleshooterVisible} 
                    onClose={() => setTroubleshooterVisible(false)} 
                />
            </SafeAreaView>
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    settingsButtonContainer: {
        position: 'absolute',
        top: 60,
        right: 25,
        width: 44,
        height: 44,
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.12)',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 3,
        elevation: 3,
    },
    settingsBlur: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    queueButtonContainer: {
        position: 'absolute',
        top: 60,
        left: 25,
        height: 44,
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255, 165, 0, 0.25)',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 3,
        elevation: 3,
    },
    queueBlur: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 16,
        height: '100%',
    },
    queueText: { 
        color: '#ffa500', 
        fontWeight: '700',
        fontSize: 13,
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    modalContent: {
        width: '85%',
        borderRadius: 26,
        backgroundColor: '#1C1C1E',
        overflow: 'hidden',
    },
    modalInnerContent: { padding: 25 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: 'white', marginBottom: 20 },
    label: { color: '#ccc', fontSize: 14, marginBottom: 8 },
    input: {
        backgroundColor: '#2C2C2E',
        borderWidth: 1,
        borderColor: '#444',
        borderRadius: 26,
        padding: 15,
        marginBottom: 20,
        color: 'white',
    },
    buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    flexBtn: { flex: 0.48, borderRadius: 26, overflow: 'hidden' },
    fullBtn: { width: '100%', borderRadius: 26, overflow: 'hidden', marginTop: 10 },
    modalButtonBlur: { paddingVertical: 14, alignItems: 'center' },
    saveButtonText: { color: 'white', fontWeight: 'bold' },
    historyContainer: {
        marginTop: 20,
        maxHeight: 250,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 26,
        padding: 15,
        overflow: 'hidden',
    },
    historyTitle: { color: '#FFF', fontSize: 18, fontWeight: '700', marginBottom: 12 },
    historyList: { flex: 1 },
    historyCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 20,
        padding: 12,
        marginBottom: 8
    },
    cardInfo: { marginLeft: 12 },
    cardTitle: { color: '#FFF', fontSize: 13, fontWeight: '600' },
    cardTime: { color: '#888', fontSize: 11 },
    emptyHistory: { color: '#555', textAlign: 'center', marginVertical: 20 },
    autoConnectButton: {
        backgroundColor: 'rgba(99, 102, 241, 0.9)',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)'
    },
    disabledButton: { backgroundColor: '#555' },
    autoConnectText: { color: 'white', fontWeight: 'bold' },
    pairingRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
    pairingBtn: { flex: 0.48 },
    qrScannerButton: {
        backgroundColor: 'rgba(99, 102, 241, 0.9)',
        paddingVertical: 12,
        paddingHorizontal: 15,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        alignItems: 'center'
    },
    statusText: { color: '#4CAF50', marginTop: 15, fontSize: 16, fontWeight: '600', textAlign: 'center', paddingHorizontal: 20, textShadowColor: 'black', textShadowRadius: 2 },
    serverItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 15,
        backgroundColor: '#2C2C2E',
        borderRadius: 15,
        marginBottom: 10,
    }
});

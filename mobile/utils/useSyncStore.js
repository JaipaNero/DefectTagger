import { useState, useCallback, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { 
    uploadEvidence as apiUpload, 
    discoverServer, 
    requestPairing, 
    pollPairingStatus, 
    handshake, 
    verifySession 
} from './api';
import * as db from './database';

const IP_KEY = 'defect_tagger_ip';
const TECH_ID_KEY = 'defect_tagger_tech_id';

/**
 * SyncViewModel: Separates Business Logic from UI[cite: 92, 226].
 * Manages server connection, pairing, and background uploads.
 */
export const useSyncStore = () => {
    const [ipAddress, setIpAddress] = useState('');
    const [technicianId, setTechnicianId] = useState('');
    const [status, setStatus] = useState('idle'); // idle, uploading, success, error
    const [message, setMessage] = useState('');
    const [queueLength, setQueueLength] = useState(0);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [discoveryProgress, setDiscoveryProgress] = useState(0);

    // Load initial settings
    useEffect(() => {
        db.initDatabase();
        const load = async () => {
            const ip = await SecureStore.getItemAsync(IP_KEY);
            const tech = await SecureStore.getItemAsync(TECH_ID_KEY);
            if (ip) setIpAddress(ip);
            if (tech) setTechnicianId(tech);
            refreshQueue();
        };
        load();
    }, []);

    const refreshQueue = useCallback(() => {
        const items = db.getQueueItems();
        setQueueLength(items.length);
    }, []);

    const saveSettings = async (newIp, newTech) => {
        setIpAddress(newIp);
        setTechnicianId(newTech);
        await SecureStore.setItemAsync(IP_KEY, newIp);
        await SecureStore.setItemAsync(TECH_ID_KEY, newTech);
    };

    const startDiscovery = async () => {
        setIsDiscovering(true);
        const servers = await discoverServer((p) => setDiscoveryProgress(p));
        setIsDiscovering(false);
        return servers;
    };

    const performUpload = async (uri, metadata) => {
        setStatus('uploading');
        try {
            const result = await apiUpload(uri, metadata, ipAddress, true);
            if (result.success) {
                setStatus('success');
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else {
                // Persistent Queue on failure[cite: 403]
                db.addToQueue(Date.now().toString(), uri, metadata);
                setStatus('error');
                setMessage('Queued for offline sync.');
                refreshQueue();
            }
        } catch (e) {
            setStatus('error');
            setMessage('Network error.');
        } finally {
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    const processFullQueue = async () => {
        const items = db.getQueueItems();
        if (items.length === 0) return;

        setStatus('uploading');
        setMessage(`Syncing ${items.length} items...`);

        let successCount = 0;
        for (const item of items) {
            const meta = JSON.parse(item.metadata);
            const res = await apiUpload(item.image_uri, meta, ipAddress, true);
            if (res.success) {
                db.removeFromQueue(item.id);
                successCount++;
            }
        }

        refreshQueue();
        setStatus('success');
        setMessage(`Synced ${successCount} items.`);
        setTimeout(() => setStatus('idle'), 3000);
    };

    return {
        ipAddress, technicianId, status, message, queueLength, isDiscovering, discoveryProgress,
        saveSettings, startDiscovery, performUpload, processFullQueue, refreshQueue,
        setIpAddress, setTechnicianId // For controlled components
    };
};

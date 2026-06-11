import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system';
import * as db from './database';  // ARCH-01: Single Source of Truth for offline queue

const AUTH_TOKEN_KEY = 'auth_token';

// Generic fetch wrapper with automatic HTTP fallback to bypass local self-signed SSL handshake failures
const robustFetch = async (url, options = {}) => {
    try {
        const response = await fetch(url, options);
        return response;
    } catch (e) {
        if (url.startsWith('https://')) {
            const httpUrl = url.replace('https://', 'http://');
            console.log(`robustFetch: HTTPS failed (${e.message}). Falling back to HTTP: ${httpUrl}`);
            try {
                return await fetch(httpUrl, options);
            } catch (httpError) {
                console.error(`robustFetch: HTTP fallback failed: ${httpError.message}`);
                throw httpError;
            }
        }
        throw e;
    }
};

/**
 * Performs the initial handshake with the backend.
 * Exchanges the QR setup token for a session JWT via JSON body.
 */
export const handshake = async (ipAddress, setupToken, technicianId) => {
    try {
        const response = await robustFetch(`https://${ipAddress}:8000/auth/handshake`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                token: setupToken,
                technician_id: technicianId
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: 'Handshake Failed' }));
            throw new Error(err.detail || "Handshake failed");
        }

        const data = await response.json();
        // Store the JWT for future authenticated requests
        await SecureStore.setItemAsync(AUTH_TOKEN_KEY, data.access_token);

        return { success: true };
    } catch (e) {
        console.error("Handshake Error:", e);
        return { success: false, error: e.message };
    }
};

/**
 * Checks if the stored JWT session is still valid.
 */
export const verifySession = async (ipAddress) => {
    try {
        const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
        if (!token) return { success: false, error: "No token." };

        const response = await robustFetch(`https://${ipAddress}:8000/auth/verify`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.ok) {
            return { success: true };
        } else {
            return { success: false, error: 'Session expired' };
        }
    } catch (e) {
        console.error("verifySession Error:", e);
        return { success: false, error: e.message };
    }
};

/**
 * Uploads evidence with JWT authentication.
 * File is sent as-is (raw image). Security is handled by:
 * - JWT auth (identity verification)
 * - Server-side MIME validation (file integrity)
 * - Audit logging (traceability)
 */
export const uploadEvidence = async (imageUri, metadata, ipAddress, skipQueue = false) => {
    if (!ipAddress) return { success: false, error: "Configuration Error: No IP Address." };

    try {
        // 1. Get JWT
        const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);

        if (!token) {
            return { success: false, error: "Authentication missing. Please rescan QR." };
        }

        // Normalize URI for React Native FormData
        const osUri = !imageUri.startsWith('file://') && !imageUri.startsWith('http') ? `file://${imageUri}` : imageUri;

        // 2. Build form data with raw image
        const apiUrl = `https://${ipAddress}:8000/upload-evidence`;
        const formData = new FormData();

        formData.append('file', {
            uri: osUri,
            name: 'evidence.jpg',
            type: 'image/jpeg',
        });

        formData.append('metadata', JSON.stringify(metadata));

        console.log(`SyncService: Uploading to ${apiUrl}...`);
        console.log(`SyncService: Image URI: ${osUri}`);
        console.log(`SyncService: Metadata: ${JSON.stringify(metadata)}`);

        const fetchPromise = robustFetch(apiUrl, {
            method: 'POST',
            body: formData,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
            }
        });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request Timeout')), 15000);
        });

        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (response.ok) {
            const data = await response.json();
            return {
                success: true,
                serverTime: data.processing_time_ms,
            };
        } else {
            const result = await response.json().catch(() => ({ detail: 'Unknown Error' }));
            console.warn("SyncService: Upload Failed", result);
            return { success: false, error: result.detail || `Server Error: ${response.status}` };
        }
    } catch (error) {
        console.error("SyncService: Network Error", error);
        // ARCH-01: Return shouldQueue flag — let the caller (useSyncStore)
        // persist to SQLite, the single source of truth.
        return {
            success: false,
            error: `Network Error: ${error.message}`,
            shouldQueue: !skipQueue,
        };
    }
};

// ARCH-01: SecureStore queue functions removed.
// The SQLite database (database.js) is now the single source of truth
// for all offline queuing. See useSyncStore.js for queue management.





export const clearQueue = () => {
    db.clearAllQueue();
};



// --- QR-less Discovery & Pairing ---

import * as Network from 'expo-network';
import * as Device from 'expo-device';

/**
 * Scans the local subnet for the Defect Tagger server (port 8000).
 * Returns the IP address if found, or null.
 * @param {function} onProgress - Callback(percentage)
 */
export const discoverServer = async (onProgress) => {
    try {
        const ip = await Network.getIpAddressAsync();
        if (!ip || ip === '0.0.0.0') return [];

        const subnet = ip.split('.').slice(0, 3).join('.');
        const port = 8000;
        let foundServers = [];

        // Create array of 254 promises (1..254)
        // We execute in batches of 20 to avoid overwhelming the network stack
        const batchSize = 20;
        const total = 254;

        for (let i = 1; i <= total; i += batchSize) {
            const batch = [];
            for (let j = 0; j < batchSize && (i + j) <= total; j++) {
                const targetIp = `${subnet}.${i + j}`;
                // Slightly longer timeout (1.5s) for legacy Windows discovery stability
                const check = (async () => {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 1500);
                    try {
                        const res = await robustFetch(`https://${targetIp}:${port}/`, {
                            method: 'GET',
                            signal: controller.signal
                        });
                        if (res.ok) {
                            const data = await res.json();
                            return { ip: targetIp, name: data.computer_name || targetIp };
                        }
                        return null;
                    } catch (e) {
                        return null;
                    } finally {
                        clearTimeout(timeoutId);
                    }
                })();
                batch.push(check);
            }

            const results = await Promise.all(batch);
            const batchFound = results.filter(r => r !== null);
            foundServers = [...foundServers, ...batchFound];

            if (onProgress) onProgress(Math.min((i + batchSize) / total, 1.0));
        }

        return foundServers;
    } catch (e) {
        console.warn("Discovery failed:", e);
        return [];
    }
};

/**
 * Requests pairing with the server.
 * Returns { request_id } or error.
 */
export const requestPairing = async (ipAddress) => {
    try {
        const deviceName = Device.modelName || `Phone-${Math.floor(Math.random() * 1000)}`;
        // Use a persistent random ID for this install
        let deviceId = await SecureStore.getItemAsync('device_uuid');
        if (!deviceId) {
            deviceId = Math.random().toString(36).substring(2) + Date.now().toString(36);
            await SecureStore.setItemAsync('device_uuid', deviceId);
        }

        const response = await robustFetch(`https://${ipAddress}:8000/auth/pair-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                device_name: deviceName,
                device_id: deviceId
            })
        });

        if (!response.ok) throw new Error("Request failed");
        return await response.json(); // { request_id, status }
    } catch (e) {
        return { error: e.message };
    }
};

/**
 * Polls the pairing status.
 * Returns { status: 'approved'|'pending', setup_token? }.
 */
export const pollPairingStatus = async (ipAddress, requestId) => {
    try {
        const response = await robustFetch(`https://${ipAddress}:8000/auth/pair-status?request_id=${requestId}`);
        if (!response.ok) {
            if (response.status === 403) return { status: 'denied' };
            throw new Error("Polling failed");
        }
        return await response.json();
    } catch (e) {
        return { error: e.message };
    }
};

/**
 * Sends a scanned barcode/IMEI text to the PC clipboard via JWT authentication.
 */
export const sendToClipboard = async (text, ipAddress) => {
    if (!ipAddress) return { success: false, error: "Configuration Error: No IP Address." };

    try {
        const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
        if (!token) {
            return { success: false, error: "Authentication missing. Please rescan QR or re-pair." };
        }

        const response = await robustFetch(`https://${ipAddress}:8000/clipboard`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ text })
        });

        if (response.ok) {
            return { success: true };
        } else {
            const err = await response.json().catch(() => ({ detail: 'Clipboard Sync Failed' }));
            return { success: false, error: err.detail || `Server Error: ${response.status}` };
        }
    } catch (e) {
        console.error("sendToClipboard Network Error:", e);
        return { success: false, error: e.message };
    }
};


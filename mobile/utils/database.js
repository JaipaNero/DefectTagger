import * as SQLite from 'expo-sqlite';

/**
 * Single Source of Truth for offline uploads and session metadata.
 * Implements modern Android architecture by separating local storage from API logic[cite: 403].
 */
const db = SQLite.openDatabaseSync('defect_tagger.db');

export const initDatabase = () => {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS upload_queue (
      id TEXT PRIMARY KEY,
      image_uri TEXT NOT NULL,
      metadata TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

export const addToQueue = (id, uri, metadata) => {
  db.runSync(
    'INSERT INTO upload_queue (id, image_uri, metadata) VALUES (?, ?, ?)',
    [id, uri, JSON.stringify(metadata)]
  );
};

export const getQueueItems = () => {
  return db.getAllSync('SELECT * FROM upload_queue WHERE status = "pending" ORDER BY created_at ASC');
};

export const updateQueueStatus = (id, status) => {
  db.runSync('UPDATE upload_queue SET status = ? WHERE id = ?', [status, id]);
};

export const removeFromQueue = (id) => {
  db.runSync('DELETE FROM upload_queue WHERE id = ?', [id]);
};

export const clearAllQueue = () => {
  db.runSync('DELETE FROM upload_queue');
};

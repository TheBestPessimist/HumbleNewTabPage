'use strict';

/**
 * IndexedDB-based bookmark cache for fast bookmark loading.
 * 
 * Database structure:
 * - Store: 'folders' with keyPath 'key'
 * - Records: 
 *   - 'folder:{id}' → { key, id, title, parentId, children: [...] }
 *   - 'meta:version' → { key, value: number }
 *   - 'meta:lastSync' → { key, value: timestamp }
 * 
 * This module is used by both:
 * - background.js (service worker) - writes to cache
 * - newtab.js - reads from cache only
 */

const BookmarkCache = {
    DB_NAME: 'BookmarkCache',
    DB_VERSION: 1,
    STORE_NAME: 'folders',
    CACHE_VERSION: 1,

    _db: null,
    _dbPromise: null, // Prevent concurrent openDB calls
    _allDataCache: null, // In-memory cache of all data for fast reads
    _allDataCacheTime: 0, // When the cache was populated

    /**
     * Open/create the IndexedDB database
     * @returns {Promise<IDBDatabase>}
     */
    async openDB() {
        if (this._db) return this._db;

        // Prevent concurrent openDB calls (race condition fix)
        if (this._dbPromise) return this._dbPromise;

        this._dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => {
                this._dbPromise = null;
                reject(new Error(`Failed to open IndexedDB: ${request.error}`));
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, { keyPath: 'key' });
                }
            };

            request.onsuccess = () => {
                this._db = request.result;
                this._dbPromise = null;
                resolve(this._db);
            };
        });

        return this._dbPromise;
    },

    /**
     * Load all data into memory cache for fast subsequent reads
     * This is much faster than multiple individual IndexedDB reads
     * @param {boolean} force - Force reload even if cache exists
     * @returns {Promise<Map<string, any>>}
     */
    async loadAllData(force = false) {
        // Return cached data if it exists (cache is valid for entire page session)
        // The cache is only invalidated on writes or explicit force reload
        if (!force && this._allDataCache) {
            console.log('[BookmarkCache] loadAllData: using existing cache');
            return this._allDataCache;
        }

        const start = performance.now();
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.getAll();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const cache = new Map();
                for (const record of request.result) {
                    cache.set(record.key, record);
                }
                this._allDataCache = cache;
                this._allDataCacheTime = Date.now();
                const duration = performance.now() - start;
                console.log(`[BookmarkCache] loadAllData: loaded ${cache.size} records in ${duration.toFixed(2)}ms`);
                resolve(cache);
            };
        });
    },

    /**
     * Invalidate the in-memory cache (call after writes)
     */
    invalidateCache() {
        console.log('[BookmarkCache] invalidateCache called');
        console.trace();
        this._allDataCache = null;
        this._allDataCacheTime = 0;
    },

    /**
     * Get a single record by key (uses in-memory cache if available)
     * @param {string} key - The record key (e.g., 'folder:1' or 'meta:version')
     * @returns {Promise<any>}
     */
    async get(key) {
        // Try in-memory cache first
        if (this._allDataCache) {
            return this._allDataCache.get(key);
        }

        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.get(key);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    },

    /**
     * Get multiple records by keys (uses in-memory cache if available)
     * @param {string[]} keys - Array of record keys
     * @returns {Promise<Map<string, any>>}
     */
    async getMany(keys) {
        // Try in-memory cache first
        if (this._allDataCache) {
            const start = performance.now();
            const results = new Map();
            for (const key of keys) {
                const value = this._allDataCache.get(key);
                if (value) results.set(key, value);
            }
            const duration = performance.now() - start;
            if (duration > 1) {
                console.log('[BookmarkCache] getMany: in-memory lookup took', duration.toFixed(2), 'ms for', keys.length, 'keys');
            }
            return results;
        }

        console.log('[BookmarkCache] getMany: cache miss, falling back to IndexedDB for', keys.length, 'keys');
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const results = new Map();
            let pending = keys.length;

            if (pending === 0) {
                resolve(results);
                return;
            }

            keys.forEach(key => {
                const request = store.get(key);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    if (request.result) {
                        results.set(key, request.result);
                    }
                    pending--;
                    if (pending === 0) resolve(results);
                };
            });
        });
    },

    /**
     * Get folder data by folder ID (uses in-memory cache if available)
     * @param {string} folderId - The bookmark folder ID
     * @returns {Promise<{id: string, title: string, parentId: string, children: Array}|null>}
     */
    async getFolder(folderId) {
        const record = await this.get(`folder:${folderId}`);
        return record || null;
    },

    /**
     * Get multiple folders by IDs (uses in-memory cache if available)
     * @param {string[]} folderIds - Array of folder IDs
     * @returns {Promise<Map<string, object>>}
     */
    async getFolders(folderIds) {
        const keys = folderIds.map(id => `folder:${id}`);
        const records = await this.getMany(keys);
        const result = new Map();
        records.forEach((value, key) => {
            const id = key.replace('folder:', '');
            result.set(id, value);
        });
        return result;
    },

    /**
     * Store a single record
     * @param {string} key - The record key
     * @param {any} value - The value to store (must include 'key' property)
     * @returns {Promise<void>}
     */
    async put(key, value) {
        const record = { ...value, key };
        // Update in-memory cache if it exists (don't invalidate)
        if (this._allDataCache) {
            this._allDataCache.set(key, record);
        }
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.put(record);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    },

    /**
     * Store multiple records in a single transaction (efficient bulk write)
     * @param {Array<{key: string, value: any}>} records - Array of {key, value} pairs
     * @returns {Promise<void>}
     */
    async putMany(records) {
        // Update in-memory cache if it exists (don't invalidate)
        if (this._allDataCache) {
            records.forEach(({ key, value }) => {
                this._allDataCache.set(key, { ...value, key });
            });
        }
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);

            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => resolve();

            records.forEach(({ key, value }) => {
                store.put({ ...value, key });
            });
        });
    },

    /**
     * Clear all data and store new records atomically
     * @param {Array<{key: string, value: any}>} records - Array of {key, value} pairs
     * @returns {Promise<void>}
     */
    async replaceAll(records) {
        // Rebuild in-memory cache with new data
        if (this._allDataCache) {
            this._allDataCache.clear();
            records.forEach(({ key, value }) => {
                this._allDataCache.set(key, { ...value, key });
            });
        }
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);

            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => resolve();

            // Clear all existing data first
            store.clear();

            // Then add all new records
            records.forEach(({ key, value }) => {
                store.put({ ...value, key });
            });
        });
    },

    /**
     * Check if cache exists and is valid
     * @returns {Promise<{valid: boolean, lastSync: number|null, version: number|null}>}
     */
    async getCacheStatus() {
        try {
            const [versionRecord, syncRecord] = await Promise.all([
                this.get('meta:version'),
                this.get('meta:lastSync')
            ]);

            const version = versionRecord?.value ?? null;
            const lastSync = syncRecord?.value ?? null;
            const valid = version === this.CACHE_VERSION && lastSync !== null;

            return { valid, lastSync, version };
        } catch (e) {
            return { valid: false, lastSync: null, version: null };
        }
    },

    /**
     * Get the last sync timestamp
     * @returns {Promise<number|null>}
     */
    async getLastSyncTime() {
        const record = await this.get('meta:lastSync');
        return record?.value ?? null;
    },

    /**
     * Clear all cached data
     * @returns {Promise<void>}
     */
    async clear() {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.clear();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    },

    /**
     * Close the database connection
     */
    close() {
        if (this._db) {
            this._db.close();
            this._db = null;
        }
    },

    // =========================================================================
    // SYNC HELPERS - Used by background.js to populate the cache
    // =========================================================================

    /**
     * Flatten a bookmark tree into folder records
     * @param {Array} tree - Result from chrome.bookmarks.getTree()
     * @returns {Array<{key: string, value: object}>} Records ready for putMany/replaceAll
     */
    flattenTree(tree) {
        const records = [];

        function processNode(node, parentId = null) {
            // Only process folders (nodes without url)
            if (!node.url) {
                const children = (node.children || []).map(child => ({
                    id: child.id,
                    title: child.title,
                    url: child.url,
                    // Mark as folder if no url
                    ...(child.url ? {} : { isFolder: true })
                }));

                records.push({
                    key: `folder:${node.id}`,
                    value: {
                        id: node.id,
                        title: node.title,
                        parentId: parentId,
                        children: children
                    }
                });

                // Recursively process child folders
                (node.children || []).forEach(child => {
                    if (!child.url) {
                        processNode(child, node.id);
                    }
                });
            }
        }

        // Process root nodes
        tree.forEach(node => processNode(node));

        return records;
    },

    /**
     * Perform a full sync from chrome.bookmarks.getTree()
     * This should only be called from the service worker
     * @returns {Promise<{folderCount: number, syncTime: number}>}
     */
    async fullSync() {
        const startTime = performance.now();

        // Get the full bookmark tree
        const tree = await chrome.bookmarks.getTree();

        // Flatten to records
        const folderRecords = this.flattenTree(tree);

        // Add metadata
        const now = Date.now();
        const allRecords = [
            ...folderRecords,
            { key: 'meta:version', value: { value: this.CACHE_VERSION } },
            { key: 'meta:lastSync', value: { value: now } }
        ];

        // Replace all data atomically
        await this.replaceAll(allRecords);

        const syncTime = performance.now() - startTime;
        return { folderCount: folderRecords.length, syncTime };
    }
};

// Export for both browser and Node.js (testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BookmarkCache;
}

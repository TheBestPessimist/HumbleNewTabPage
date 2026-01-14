/**
 * Favicon Cache Module
 * 
 * A self-contained IndexedDB-based cache for favicons.
 * Persists across browser restarts and provides near-instant favicon loading.
 * 
 * Usage:
 *   // Get a favicon (from cache or fetch if not cached)
 *   const dataUrl = await FaviconCache.get('https://example.com');
 *   img.src = dataUrl;
 * 
 *   // Prefetch favicons for multiple URLs
 *   await FaviconCache.prefetch(['https://a.com', 'https://b.com']);
 * 
 *   // Clear the cache
 *   await FaviconCache.clear();
 */

'use strict';

var FaviconCache = (function() {
    var DB_NAME = 'FaviconCache';
    var DB_VERSION = 1;
    var STORE_NAME = 'favicons';
    var CACHE_EXPIRY_DAYS = 30;
    
    var dbPromise = null;
    
    /**
     * Open or create the IndexedDB database
     */
    function openDatabase() {
        if (dbPromise) return dbPromise;
        
        dbPromise = new Promise(function(resolve, reject) {
            var request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = function() {
                console.error('FaviconCache: Failed to open database');
                reject(request.error);
            };
            
            request.onsuccess = function() {
                resolve(request.result);
            };
            
            request.onupgradeneeded = function(event) {
                var db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    var store = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
        
        return dbPromise;
    }
    
    /**
     * Generate the Chrome favicon URL for a page URL
     */
    function getFaviconUrl(pageUrl, size) {
        size = size || 16;
        return '/_favicon/?pageUrl=' + encodeURIComponent(pageUrl) + '&size=' + size;
    }
    
    /**
     * Fetch a favicon and convert to data URL
     */
    function fetchFavicon(pageUrl, size) {
        return new Promise(function(resolve, reject) {
            var faviconUrl = getFaviconUrl(pageUrl, size);
            
            fetch(faviconUrl)
                .then(function(response) {
                    if (!response.ok) {
                        throw new Error('Failed to fetch favicon');
                    }
                    return response.blob();
                })
                .then(function(blob) {
                    var reader = new FileReader();
                    reader.onloadend = function() {
                        resolve(reader.result);
                    };
                    reader.onerror = function() {
                        reject(new Error('Failed to read favicon blob'));
                    };
                    reader.readAsDataURL(blob);
                })
                .catch(reject);
        });
    }
    
    /**
     * Get a favicon from cache, or fetch and cache if not present
     */
    function get(pageUrl, size) {
        size = size || 16;
        var cacheKey = pageUrl + '|' + size;
        
        return openDatabase().then(function(db) {
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction([STORE_NAME], 'readonly');
                var store = transaction.objectStore(STORE_NAME);
                var request = store.get(cacheKey);
                
                request.onsuccess = function() {
                    var cached = request.result;
                    var now = Date.now();
                    var expiryMs = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
                    
                    if (cached && (now - cached.timestamp) < expiryMs) {
                        // Cache hit - return cached data URL
                        resolve(cached.dataUrl);
                    } else {
                        // Cache miss or expired - fetch and cache
                        fetchFavicon(pageUrl, size)
                            .then(function(dataUrl) {
                                // Store in cache (fire and forget)
                                set(cacheKey, dataUrl).catch(function() {});
                                resolve(dataUrl);
                            })
                            .catch(function() {
                                // On error, return the direct URL as fallback
                                resolve(getFaviconUrl(pageUrl, size));
                            });
                    }
                };
                
                request.onerror = function() {
                    // On DB error, fall back to direct URL
                    resolve(getFaviconUrl(pageUrl, size));
                };
            });
        }).catch(function() {
            // If DB fails to open, fall back to direct URL
            return getFaviconUrl(pageUrl, size);
        });
    }
    
    /**
     * Store a favicon in the cache
     */
    function set(cacheKey, dataUrl) {
        return openDatabase().then(function(db) {
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction([STORE_NAME], 'readwrite');
                var store = transaction.objectStore(STORE_NAME);

                var record = {
                    url: cacheKey,
                    dataUrl: dataUrl,
                    timestamp: Date.now()
                };

                var request = store.put(record);
                request.onsuccess = function() { resolve(); };
                request.onerror = function() { reject(request.error); };
            });
        });
    }

    /**
     * Prefetch and cache favicons for multiple URLs
     * Useful for warming the cache in the background
     */
    function prefetch(urls, size) {
        size = size || 16;
        var promises = urls.map(function(url) {
            return get(url, size).catch(function() {
                // Ignore individual failures
                return null;
            });
        });
        return Promise.all(promises);
    }

    /**
     * Clear all cached favicons
     */
    function clear() {
        return openDatabase().then(function(db) {
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction([STORE_NAME], 'readwrite');
                var store = transaction.objectStore(STORE_NAME);
                var request = store.clear();
                request.onsuccess = function() { resolve(); };
                request.onerror = function() { reject(request.error); };
            });
        });
    }

    /**
     * Get cache statistics
     */
    function getStats() {
        return openDatabase().then(function(db) {
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction([STORE_NAME], 'readonly');
                var store = transaction.objectStore(STORE_NAME);
                var countRequest = store.count();

                countRequest.onsuccess = function() {
                    resolve({
                        count: countRequest.result,
                        dbName: DB_NAME,
                        storeName: STORE_NAME,
                        expiryDays: CACHE_EXPIRY_DAYS
                    });
                };
                countRequest.onerror = function() { reject(countRequest.error); };
            });
        });
    }

    /**
     * Remove expired entries from the cache
     */
    function cleanup() {
        return openDatabase().then(function(db) {
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction([STORE_NAME], 'readwrite');
                var store = transaction.objectStore(STORE_NAME);
                var index = store.index('timestamp');
                var expiryMs = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
                var cutoff = Date.now() - expiryMs;
                var range = IDBKeyRange.upperBound(cutoff);

                var deleted = 0;
                var request = index.openCursor(range);

                request.onsuccess = function(event) {
                    var cursor = event.target.result;
                    if (cursor) {
                        cursor.delete();
                        deleted++;
                        cursor.continue();
                    } else {
                        resolve(deleted);
                    }
                };
                request.onerror = function() { reject(request.error); };
            });
        });
    }

    /**
     * Create an img element with cached favicon
     * Convenience method for direct use in DOM
     */
    function createIcon(pageUrl, size) {
        size = size || 16;
        var img = document.createElement('img');
        img.className = 'icon';
        img.alt = ' ';
        img.width = size;
        img.height = size;

        // Set a placeholder or empty initially
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

        // Load from cache asynchronously
        get(pageUrl, size).then(function(dataUrl) {
            img.src = dataUrl;
        });

        return img;
    }

    // Public API
    return {
        get: get,
        prefetch: prefetch,
        clear: clear,
        getStats: getStats,
        cleanup: cleanup,
        createIcon: createIcon,
        getFaviconUrl: getFaviconUrl
    };
})();

// Export for Node.js testing (if available)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FaviconCache;
}

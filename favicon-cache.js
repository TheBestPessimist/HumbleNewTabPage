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
    var MAX_CONCURRENT_FETCHES = 20; // Limit concurrent network requests

    var dbPromise = null;
    var activeFetches = 0;
    var fetchQueue = [];
    var pendingRequests = {}; // Dedup in-flight requests: domainKey -> Promise

    /**
     * Extract the origin (protocol + domain) from a URL for domain-based caching.
     * Favicons are typically the same for all pages on a domain.
     */
    function getDomainKey(pageUrl, size) {
        try {
            var url = new URL(pageUrl);
            return url.origin + '|' + size;
        } catch (e) {
            // If URL parsing fails, fall back to full URL
            return pageUrl + '|' + size;
        }
    }

    /**
     * Process the fetch queue
     */
    function processFetchQueue() {
        while (fetchQueue.length > 0 && activeFetches < MAX_CONCURRENT_FETCHES) {
            var item = fetchQueue.shift();
            activeFetches++;
            item.execute().finally(function() {
                activeFetches--;
                processFetchQueue();
            });
        }
    }

    /**
     * Queue a fetch operation
     */
    function queueFetch(executeFn) {
        return new Promise(function(resolve, reject) {
            fetchQueue.push({
                execute: function() {
                    return executeFn().then(resolve).catch(reject);
                }
            });
            processFetchQueue();
        });
    }

    /**
     * Open or create the IndexedDB database
     */
    function openDatabase() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise(function(resolve, reject) {
            var request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = function() {
                console.error('FaviconCache: Failed to open database');
                dbPromise = null; // Reset so we can retry
                reject(request.error);
            };

            request.onsuccess = function() {
                var db = request.result;
                // Handle database being closed unexpectedly
                db.onclose = function() {
                    dbPromise = null;
                };
                db.onerror = function() {
                    dbPromise = null;
                };
                resolve(db);
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
     * Get a favicon from cache, or fetch and cache if not present.
     * Uses domain-based caching - all URLs from the same domain share one favicon.
     */
    function get(pageUrl, size) {
        size = size || 16;
        // Use domain-based key for caching and deduplication
        var domainKey = getDomainKey(pageUrl, size);

        // Deduplicate in-flight requests for the same domain
        if (pendingRequests[domainKey]) {
            return pendingRequests[domainKey];
        }

        var promise = openDatabase().then(function(db) {
            return new Promise(function(resolve, reject) {
                var transaction;
                var store;
                var request;

                try {
                    transaction = db.transaction([STORE_NAME], 'readonly');
                    store = transaction.objectStore(STORE_NAME);
                    request = store.get(domainKey);
                } catch (e) {
                    // Transaction failed (e.g., database closed), fall back to direct URL
                    resolve(getFaviconUrl(pageUrl, size));
                    return;
                }

                request.onsuccess = function() {
                    var cached = request.result;
                    var now = Date.now();
                    var expiryMs = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

                    if (cached && (now - cached.timestamp) < expiryMs) {
                        // Cache hit - return cached data URL
                        resolve(cached.dataUrl);
                    } else {
                        // Cache miss or expired - queue fetch to limit concurrency
                        queueFetch(function() {
                            return fetchFavicon(pageUrl, size);
                        }).then(function(dataUrl) {
                            // Store in cache by domain (fire and forget)
                            set(domainKey, dataUrl).catch(function() {});
                            resolve(dataUrl);
                        }).catch(function() {
                            // On error, return the direct URL as fallback
                            resolve(getFaviconUrl(pageUrl, size));
                        });
                    }
                };

                request.onerror = function() {
                    // On DB error, fall back to direct URL
                    resolve(getFaviconUrl(pageUrl, size));
                };

                transaction.onerror = function() {
                    // Transaction error, fall back to direct URL
                    resolve(getFaviconUrl(pageUrl, size));
                };
            });
        }).catch(function() {
            // If DB fails to open, fall back to direct URL
            return getFaviconUrl(pageUrl, size);
        }).finally(function() {
            // Clean up pending request for this domain
            delete pendingRequests[domainKey];
        });

        pendingRequests[domainKey] = promise;
        return promise;
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
        }).catch(function() {
            // On error, fall back to direct favicon URL
            img.src = getFaviconUrl(pageUrl, size);
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

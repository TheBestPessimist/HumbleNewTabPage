/**
 * Favicon Cache Module - IndexedDB-based cache for favicons
 */

'use strict';

var FaviconCache = (function() {
    var DB_NAME = 'FaviconCache';
    var DB_VERSION = 1;
    var STORE_NAME = 'favicons';
    var CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

    var dbPromise = null;
    var pendingRequests = {}; // Dedup in-flight requests: domainKey -> Promise

    function getDomainKey(pageUrl, size) {
        try {
            return new URL(pageUrl).origin + '|' + size;
        } catch (e) {
            return pageUrl + '|' + size;
        }
    }

    function openDatabase() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise(function(resolve, reject) {
            var request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = function() {
                dbPromise = null;
                reject(request.error);
            };
            request.onsuccess = function() {
                var db = request.result;
                db.onclose = db.onerror = function() { dbPromise = null; };
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

    function getFaviconUrl(pageUrl, size) {
        return '/_favicon/?pageUrl=' + encodeURIComponent(pageUrl) + '&size=' + (size || 16);
    }

    function fetchFavicon(pageUrl, size) {
        return fetch(getFaviconUrl(pageUrl, size))
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to fetch');
                return response.blob();
            })
            .then(function(blob) {
                return new Promise(function(resolve, reject) {
                    var reader = new FileReader();
                    reader.onloadend = function() { resolve(reader.result); };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            });
    }

    function get(pageUrl, size) {
        size = size || 16;
        var domainKey = getDomainKey(pageUrl, size);

        if (pendingRequests[domainKey]) {
            return pendingRequests[domainKey];
        }

        var promise = openDatabase().then(function(db) {
            return new Promise(function(resolve) {
                try {
                    var request = db.transaction([STORE_NAME], 'readonly')
                        .objectStore(STORE_NAME).get(domainKey);

                    request.onsuccess = function() {
                        var cached = request.result;
                        if (cached && (Date.now() - cached.timestamp) < CACHE_EXPIRY_MS) {
                            resolve(cached.dataUrl);
                        } else {
                            fetchFavicon(pageUrl, size).then(function(dataUrl) {
                                set(domainKey, dataUrl).catch(function() {});
                                resolve(dataUrl);
                            }).catch(function() {
                                resolve(getFaviconUrl(pageUrl, size));
                            });
                        }
                    };
                    request.onerror = function() { resolve(getFaviconUrl(pageUrl, size)); };
                } catch (e) {
                    resolve(getFaviconUrl(pageUrl, size));
                }
            });
        }).catch(function() {
            return getFaviconUrl(pageUrl, size);
        }).finally(function() {
            delete pendingRequests[domainKey];
        });

        pendingRequests[domainKey] = promise;
        return promise;
    }

    function set(cacheKey, dataUrl) {
        return openDatabase().then(function(db) {
            return new Promise(function(resolve, reject) {
                var request = db.transaction([STORE_NAME], 'readwrite')
                    .objectStore(STORE_NAME)
                    .put({ url: cacheKey, dataUrl: dataUrl, timestamp: Date.now() });
                request.onsuccess = resolve;
                request.onerror = function() { reject(request.error); };
            });
        });
    }

    function prefetch(urls, size) {
        return Promise.all(urls.map(function(url) {
            return get(url, size || 16).catch(function() { return null; });
        }));
    }

    function clear() {
        return openDatabase().then(function(db) {
            return new Promise(function(resolve, reject) {
                var request = db.transaction([STORE_NAME], 'readwrite')
                    .objectStore(STORE_NAME).clear();
                request.onsuccess = resolve;
                request.onerror = function() { reject(request.error); };
            });
        });
    }

    function getStats() {
        return openDatabase().then(function(db) {
            return new Promise(function(resolve, reject) {
                var request = db.transaction([STORE_NAME], 'readonly')
                    .objectStore(STORE_NAME).count();
                request.onsuccess = function() {
                    resolve({ count: request.result, dbName: DB_NAME, expiryDays: 30 });
                };
                request.onerror = function() { reject(request.error); };
            });
        });
    }

    function cleanup() {
        return openDatabase().then(function(db) {
            return new Promise(function(resolve, reject) {
                var store = db.transaction([STORE_NAME], 'readwrite').objectStore(STORE_NAME);
                var range = IDBKeyRange.upperBound(Date.now() - CACHE_EXPIRY_MS);
                var deleted = 0;
                var request = store.index('timestamp').openCursor(range);

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

    function createIcon(pageUrl, size) {
        size = size || 16;
        var img = document.createElement('img');
        img.className = 'icon';
        img.alt = ' ';
        img.width = size;
        img.height = size;
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

        get(pageUrl, size).then(function(dataUrl) {
            img.src = dataUrl;
        }).catch(function() {
            img.src = getFaviconUrl(pageUrl, size);
        });

        return img;
    }

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

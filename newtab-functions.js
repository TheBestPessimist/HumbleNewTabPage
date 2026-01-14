/**
 * Extracted functions for testing
 * These are the core optimization functions that can be unit tested
 */

'use strict';

// Special folder IDs that are handled differently
const special = ['apps', 'top', 'recent', 'closed', 'devices'];
const specialFolderIds = ['top', 'recent', 'closed', 'devices'];

// Cache for prefetched bookmark data
var prefetchedData = {
    nodes: {},
    children: {}
};

// Promise wrappers for Chrome bookmark APIs
function getBookmarkChildren(id) {
    return new Promise(function(resolve) {
        chrome.bookmarks.getChildren(id, function(results) {
            resolve(results || []);
        });
    });
}

// Get all column root IDs from localStorage
function getColumnIds() {
    var columnIds = [];
    for (var x = 0; ; x++) {
        for (var y = 0; ; y++) {
            var id = localStorage.getItem('column.' + x + '.' + y);
            if (id) {
                columnIds.push(id);
            } else {
                break;
            }
        }
        if (y === 0) break;
    }
    return columnIds;
}

// Fetch special folder data
function fetchSpecialFolderData(id) {
    return new Promise(function(resolve) {
        switch (id) {
            case 'top':
                if (chrome.topSites) {
                    chrome.topSites.get(function(result) {
                        resolve((result || []).slice(0, getConfigValue('number_top', 10)));
                    });
                } else {
                    resolve([]);
                }
                break;
            case 'recent':
                chrome.bookmarks.getRecent(getConfigValue('number_recent', 10), function(result) {
                    resolve(result || []);
                });
                break;
            case 'closed':
            case 'devices':
                // These require more complex handling in the real code
                resolve([]);
                break;
            default:
                resolve([]);
        }
    });
}

// Get cached children or fetch on demand
// Marks folders (nodes without url) as expandable
function getCachedChildren(id, callback) {
    // Use cache if available
    if (prefetchedData.children.hasOwnProperty(id)) {
        callback(prefetchedData.children[id]);
        // Special folders: consume cache (delete after use) so next open fetches fresh
        if (specialFolderIds.indexOf(id) !== -1) {
            delete prefetchedData.children[id];
        }
        return;
    }

    // Fetch based on folder type
    if (specialFolderIds.indexOf(id) !== -1) {
        fetchSpecialFolderData(id).then(callback);
    } else {
        getBookmarkChildren(id).then(function(children) {
            // Mark folders (nodes without url) as having children
            for (var i = 0; i < children.length; i++) {
                if (!children[i].url) {
                    children[i].children = true;
                }
            }
            prefetchedData.children[id] = children;
            callback(children);
        });
    }
}

// Clear cache (for testing)
function clearPrefetchCache() {
    prefetchedData.nodes = {};
    prefetchedData.children = {};
}

// Helper to get config value during prefetch (before full config is loaded)
function getConfigValue(key, defaultValue) {
    var value = localStorage.getItem('options.' + key);
    return value !== null ? Number(value) : defaultValue;
}

// Prefetch special folder data if it's marked as open
// Returns a promise that resolves when prefetch is complete
function prefetchSpecialFolder(id, getTopSites, getRecentBookmarks, getClosedTabs, getDevices) {
    // Check if this special folder is marked as open
    if (!localStorage.getItem('open.' + id)) {
        return Promise.resolve();
    }

    switch (id) {
        case 'top':
            return getTopSites().then(function(result) {
                prefetchedData.children[id] = result.slice(0, getConfigValue('number_top', 10));
            });
        case 'recent':
            return getRecentBookmarks(getConfigValue('number_recent', 10)).then(function(result) {
                prefetchedData.children[id] = result;
            });
        case 'closed':
            return getClosedTabs(getConfigValue('number_closed', 10)).then(function(result) {
                prefetchedData.children[id] = result;
            });
        case 'devices':
            return getDevices(getConfigValue('number_closed', 10)).then(function(result) {
                prefetchedData.children[id] = result;
            });
        default:
            return Promise.resolve();
    }
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getColumnIds: getColumnIds,
        getCachedChildren: getCachedChildren,
        clearPrefetchCache: clearPrefetchCache,
        getPrefetchedData: function() { return prefetchedData; },
        prefetchSpecialFolder: prefetchSpecialFolder,
        getConfigValue: getConfigValue,
        special: special
    };
}

/**
 * Extracted functions for testing
 * These are the core optimization functions that can be unit tested
 */

'use strict';

// Special folder IDs that are handled differently
const special = ['apps', 'top', 'recent', 'closed', 'devices'];

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

// Get cached children or fetch on demand
// Marks folders (nodes without url) as expandable
function getCachedChildren(id, callback) {
    if (prefetchedData.children.hasOwnProperty(id)) {
        callback(prefetchedData.children[id]);
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

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getColumnIds: getColumnIds,
        getCachedChildren: getCachedChildren,
        clearPrefetchCache: clearPrefetchCache,
        getPrefetchedData: function() { return prefetchedData; },
        special: special
    };
}

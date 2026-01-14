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
function getBookmarkNodes(ids) {
    return new Promise(function(resolve) {
        if (!ids || ids.length === 0) {
            resolve([]);
            return;
        }
        chrome.bookmarks.get(ids, function(results) {
            resolve(results || []);
        });
    });
}

function getBookmarkChildren(id) {
    return new Promise(function(resolve) {
        chrome.bookmarks.getChildren(id, function(results) {
            resolve(results || []);
        });
    });
}

// Get all open folder IDs from localStorage
function getOpenFolderIds() {
    var openIds = [];
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('open.') === 0) {
            openIds.push(key.substring(5));
        }
    }
    return openIds;
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

// Prefetch all visible bookmark data in parallel
function prefetchVisibleBookmarks() {
    var columnIds = getColumnIds();
    var openIds = getOpenFolderIds();
    
    // Combine all IDs that need children fetched
    var allIds = columnIds.concat(openIds);
    
    // Remove duplicates and special IDs (handled separately)
    var uniqueIds = [];
    var seen = {};
    for (var i = 0; i < allIds.length; i++) {
        var id = allIds[i];
        if (!seen[id] && special.indexOf(id) === -1) {
            seen[id] = true;
            uniqueIds.push(id);
        }
    }
    
    // Fetch all children in parallel
    var childrenPromises = uniqueIds.map(function(id) {
        return getBookmarkChildren(id).then(function(children) {
            prefetchedData.children[id] = children;
            for (var j = 0; j < children.length; j++) {
                prefetchedData.nodes[children[j].id] = children[j];
            }
            return children;
        });
    });
    
    // Also fetch the root nodes themselves
    var nodePromises = uniqueIds.length > 0 ? 
        getBookmarkNodes(uniqueIds).then(function(nodes) {
            for (var j = 0; j < nodes.length; j++) {
                prefetchedData.nodes[nodes[j].id] = nodes[j];
            }
            return nodes;
        }) : Promise.resolve([]);
    
    return Promise.all([nodePromises].concat(childrenPromises));
}

// Clear cache (for testing)
function clearPrefetchCache() {
    prefetchedData.nodes = {};
    prefetchedData.children = {};
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getOpenFolderIds: getOpenFolderIds,
        getColumnIds: getColumnIds,
        prefetchVisibleBookmarks: prefetchVisibleBookmarks,
        clearPrefetchCache: clearPrefetchCache,
        getPrefetchedData: function() { return prefetchedData; },
        special: special
    };
}


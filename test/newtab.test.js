/**
 * Unit tests for newtab.js bookmark loading optimization
 * Run with: node test/newtab.test.js
 */

'use strict';

// Track API calls for verification
const apiCalls = {
    getSubTree: [],
    getChildren: [],
    get: [],
    getTree: []
};

// Mock localStorage
const mockStorage = {};
global.localStorage = {
    getItem: function(key) { return mockStorage[key] || null; },
    setItem: function(key, value) { mockStorage[key] = String(value); },
    removeItem: function(key) { delete mockStorage[key]; },
    key: function(i) { return Object.keys(mockStorage)[i] || null; },
    get length() { return Object.keys(mockStorage).length; },
    clear: function() { for (let k in mockStorage) delete mockStorage[k]; }
};

// Mock bookmark data
const mockBookmarks = {
    '1': { id: '1', title: 'Bookmarks Bar' },
    '2': { id: '2', title: 'Other Bookmarks' },
    '10': { id: '10', title: 'Folder A', url: null },
    '11': { id: '11', title: 'Site 1', url: 'https://example.com' },
    '12': { id: '12', title: 'Folder B', url: null },
    '20': { id: '20', title: 'Site 2', url: 'https://test.com' },
    '21': { id: '21', title: 'Site 3', url: 'https://demo.com' },
    '100': { id: '100', title: 'Nested 1', url: 'https://nested1.com' },
    '101': { id: '101', title: 'Nested 2', url: 'https://nested2.com' }
};

const mockChildren = {
    '1': [mockBookmarks['10'], mockBookmarks['11'], mockBookmarks['12']],
    '2': [mockBookmarks['20'], mockBookmarks['21']],
    '10': [mockBookmarks['100'], mockBookmarks['101']],
    '12': []
};

// Mock Chrome APIs
global.chrome = {
    bookmarks: {
        get: function(ids, callback) {
            apiCalls.get.push([...ids]);
            const results = ids.map(id => mockBookmarks[id]).filter(Boolean);
            setTimeout(() => callback(results), 5);
        },
        getChildren: function(id, callback) {
            apiCalls.getChildren.push(id);
            setTimeout(() => callback(mockChildren[id] || []), 5);
        },
        getSubTree: function(id, callback) {
            apiCalls.getSubTree.push(id);
            setTimeout(() => callback([mockBookmarks[id]]), 50);
        },
        getTree: function(callback) {
            apiCalls.getTree.push(true);
            setTimeout(() => callback([{ children: [mockBookmarks['1'], mockBookmarks['2']] }]), 5);
        },
        getRecent: function(count, callback) { callback([]); }
    },
    topSites: { get: function(callback) { callback([]); } },
    sessions: {
        getRecentlyClosed: function(opts, callback) { callback([]); },
        getDevices: function(opts, callback) { callback([]); }
    },
    tabs: { getCurrent: function(callback) { callback({ id: 1 }); } }
};

// Reset state between tests
function resetState() {
    global.localStorage.clear();
    apiCalls.getSubTree = [];
    apiCalls.getChildren = [];
    apiCalls.get = [];
    apiCalls.getTree = [];
    // Clear require cache to get fresh module state
    delete require.cache[require.resolve('../newtab-functions.js')];
}

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function runTest(name, testFn) {
    resetState();
    try {
        await testFn();
        console.log(`PASS: ${name}`);
        testsPassed++;
    } catch (error) {
        console.log(`FAIL: ${name}`);
        console.log(`  Error: ${error.message}`);
        testsFailed++;
    }
}

// =============================================================================
// TESTS
// =============================================================================

async function testGetOpenFolderIds() {
    global.localStorage.setItem('open.10', 'true');
    global.localStorage.setItem('open.12', 'true');
    global.localStorage.setItem('column.0.0', '1');

    const { getOpenFolderIds } = require('../newtab-functions.js');
    const openIds = getOpenFolderIds();

    assert(openIds.length === 2, `Expected 2 open folders, got ${openIds.length}`);
    assert(openIds.includes('10'), 'Should include folder 10');
    assert(openIds.includes('12'), 'Should include folder 12');
}

async function testGetColumnIds() {
    global.localStorage.setItem('column.0.0', '1');
    global.localStorage.setItem('column.0.1', '2');
    global.localStorage.setItem('column.1.0', 'top');

    const { getColumnIds } = require('../newtab-functions.js');
    const columnIds = getColumnIds();

    assert(columnIds.length === 3, `Expected 3 column IDs, got ${columnIds.length}`);
    assert(columnIds[0] === '1', 'First column ID should be 1');
    assert(columnIds[1] === '2', 'Second column ID should be 2');
    assert(columnIds[2] === 'top', 'Third column ID should be top');
}

async function testPrefetchUsesGetChildrenNotGetSubTree() {
    global.localStorage.setItem('column.0.0', '1');
    global.localStorage.setItem('column.0.1', '2');
    global.localStorage.setItem('open.10', 'true');

    const { prefetchVisibleBookmarks, clearPrefetchCache } = require('../newtab-functions.js');
    clearPrefetchCache();
    await prefetchVisibleBookmarks();

    assert(apiCalls.getSubTree.length === 0,
        `Should not call getSubTree, but called ${apiCalls.getSubTree.length} times`);
    assert(apiCalls.getChildren.length > 0,
        'Should call getChildren at least once');
}

async function testOnlyFetchesVisibleBookmarks() {
    global.localStorage.setItem('column.0.0', '1');
    global.localStorage.setItem('open.10', 'true');

    const { prefetchVisibleBookmarks, clearPrefetchCache } = require('../newtab-functions.js');
    clearPrefetchCache();
    await prefetchVisibleBookmarks();

    assert(apiCalls.getChildren.includes('1'), 'Should fetch children of column root 1');
    assert(apiCalls.getChildren.includes('10'), 'Should fetch children of open folder 10');
    assert(!apiCalls.getChildren.includes('12'), 'Should NOT fetch children of closed folder 12');
}

async function testCachesResults() {
    global.localStorage.setItem('column.0.0', '1');

    const { prefetchVisibleBookmarks, clearPrefetchCache, getPrefetchedData } = require('../newtab-functions.js');
    clearPrefetchCache();
    await prefetchVisibleBookmarks();

    const cache = getPrefetchedData();
    assert(cache.children['1'] !== undefined, 'Should cache children of folder 1');
    assert(cache.children['1'].length === 3, 'Should have 3 children cached for folder 1');
}

async function testSpecialFoldersNotFetched() {
    global.localStorage.setItem('column.0.0', 'top');
    global.localStorage.setItem('column.0.1', 'recent');
    global.localStorage.setItem('column.1.0', '1');

    const { prefetchVisibleBookmarks, clearPrefetchCache } = require('../newtab-functions.js');
    clearPrefetchCache();
    await prefetchVisibleBookmarks();

    assert(!apiCalls.getChildren.includes('top'), 'Should NOT fetch children of special folder top');
    assert(!apiCalls.getChildren.includes('recent'), 'Should NOT fetch children of special folder recent');
    assert(apiCalls.getChildren.includes('1'), 'Should fetch children of regular folder 1');
}

// Run all tests
async function runAllTests() {
    console.log('Running bookmark loading optimization tests...\n');

    await runTest('getOpenFolderIds returns correct open folder IDs', testGetOpenFolderIds);
    await runTest('getColumnIds returns correct column IDs', testGetColumnIds);
    await runTest('prefetch uses getChildren not getSubTree', testPrefetchUsesGetChildrenNotGetSubTree);
    await runTest('only fetches visible bookmarks', testOnlyFetchesVisibleBookmarks);
    await runTest('caches prefetched results', testCachesResults);
    await runTest('special folders are not fetched via getChildren', testSpecialFoldersNotFetched);

    console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
}

runAllTests();

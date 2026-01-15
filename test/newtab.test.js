/**
 * Unit tests for newtab.js bookmark loading optimization
 * Run with: node test/newtab.test.js
 */

'use strict';

// Track API calls for verification
const apiCalls = {
    getChildren: []
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

// Load themes (shared between early-styles.js and newtab.js)
// In browser, themes.js creates a global `themes` const
// In Node.js, we need to execute it and capture the global
const vm = require('vm');
const fs = require('fs');
const themesCode = fs.readFileSync(require.resolve('../themes.js'), 'utf8');
vm.runInThisContext(themesCode);
global.themes = themes;

// Mock bookmark data - folders have no url, bookmarks have url
const mockBookmarks = {
    '1': { id: '1', title: 'Bookmarks Bar' },  // folder (no url)
    '2': { id: '2', title: 'Other Bookmarks' },  // folder (no url)
    '10': { id: '10', title: 'Folder A' },  // folder (no url)
    '11': { id: '11', title: 'Site 1', url: 'https://example.com' },  // bookmark
    '12': { id: '12', title: 'Folder B' },  // folder (no url)
    '20': { id: '20', title: 'Site 2', url: 'https://test.com' },  // bookmark
    '21': { id: '21', title: 'Site 3', url: 'https://demo.com' },  // bookmark
    '100': { id: '100', title: 'Nested 1', url: 'https://nested1.com' },  // bookmark
    '101': { id: '101', title: 'Nested 2', url: 'https://nested2.com' }  // bookmark
};

const mockChildren = {
    '1': [mockBookmarks['10'], mockBookmarks['11'], mockBookmarks['12']],
    '2': [mockBookmarks['20'], mockBookmarks['21']],
    '10': [mockBookmarks['100'], mockBookmarks['101']],
    '12': []
};

// Mock DOM elements
const mockElements = {};
function createMockElement(tag) {
    const children = [];
    const el = {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        childNodes: children,
        children: children,
        firstChild: null,
        lastChild: null,
        nextSibling: null,
        previousSibling: null,
        parentNode: null,
        appendChild: function(child) {
            children.push(child);
            this.firstChild = children[0];
            this.lastChild = children[children.length - 1];
            child.parentNode = this;
            return child;
        },
        removeChild: function(child) {
            const idx = children.indexOf(child);
            if (idx > -1) children.splice(idx, 1);
            this.firstChild = children[0] || null;
            this.lastChild = children[children.length - 1] || null;
            return child;
        },
        replaceChildren: function(...newChildren) {
            children.length = 0;
            newChildren.forEach(child => {
                children.push(child);
                child.parentNode = this;
            });
            this.firstChild = children[0] || null;
            this.lastChild = children[children.length - 1] || null;
        },
        remove: function() {
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
        },
        hasChildNodes: function() { return children.length > 0; },
        classList: { add: function() {}, remove: function() {}, toggle: function() {} },
        addEventListener: function() {},
        querySelectorAll: function() { return []; },
        getElementsByClassName: function() { return []; },
        insertBefore: function(newNode, refNode) {
            children.unshift(newNode);
            this.firstChild = children[0];
            return newNode;
        },
        getBoundingClientRect: function() { return { top: 0, left: 0, width: 100, height: 20 }; }
    };
    return el;
}
global.document = {
    createElement: createMockElement,
    getElementById: function(id) {
        if (!mockElements[id]) {
            mockElements[id] = createMockElement('div');
            mockElements[id].id = id;
        }
        return mockElements[id];
    },
    head: { appendChild: function() {} },
    body: { appendChild: function() {}, classList: { add: function() {}, remove: function() {} } },
    addEventListener: function() {},
    querySelectorAll: function() { return []; },
    onclick: null,
    onmousedown: null,
    oncontextmenu: null,
    onkeydown: null
};

global.window = {
    innerWidth: 1024,
    innerHeight: 768,
    scrollX: 0,
    scrollY: 0,
    onresize: null
};

global.location = { search: '' };

// Mock Chrome APIs - Manifest V3 style (return promises)
global.chrome = {
    bookmarks: {
        getChildren: function(id) {
            apiCalls.getChildren.push(id);
            // Return copies to avoid mutation issues
            const children = (mockChildren[id] || []).map(c => ({...c}));
            return new Promise(resolve => setTimeout(() => resolve(children), 5));
        },
        get: function(ids) {
            const nodes = ids.map(id => mockBookmarks[id] ? {...mockBookmarks[id]} : null).filter(Boolean);
            return new Promise(resolve => setTimeout(() => resolve(nodes), 5));
        },
        getTree: function() {
            return new Promise(resolve => setTimeout(() => resolve([{ children: [mockBookmarks['1'], mockBookmarks['2']] }]), 5));
        },
        getRecent: function(count) {
            return new Promise(resolve => setTimeout(() => resolve([]), 5));
        }
    },
    tabs: {
        getCurrent: function() { return new Promise(resolve => setTimeout(() => resolve({ id: 1 }), 5)); },
        create: function() {},
        update: function() {}
    },
    sessions: {
        getRecentlyClosed: function(opts) { return new Promise(resolve => setTimeout(() => resolve([]), 5)); },
        getDevices: function(opts) { return new Promise(resolve => setTimeout(() => resolve([]), 5)); },
        onChanged: { addListener: function() {} }
    },
    topSites: {
        get: function() { return new Promise(resolve => setTimeout(() => resolve([]), 5)); }
    }
};

// Reset state between tests
function resetState() {
    global.localStorage.clear();
    apiCalls.getChildren = [];
    // Clear require cache to get fresh module state
    delete require.cache[require.resolve('../newtab.js')];
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

async function testGetColumnIds() {
    global.localStorage.setItem('column.0.0', '1');
    global.localStorage.setItem('column.0.1', '2');
    global.localStorage.setItem('column.1.0', 'top');

    const { getColumnIds } = require('../newtab.js');
    const columnIds = getColumnIds();

    assert(columnIds.length === 3, `Expected 3 column IDs, got ${columnIds.length}`);
    assert(columnIds[0] === '1', 'First column ID should be 1');
    assert(columnIds[1] === '2', 'Second column ID should be 2');
    assert(columnIds[2] === 'top', 'Third column ID should be top');
}

async function testGetCachedChildrenFetchesOnDemand() {
    const { getCachedChildren, clearPrefetchCache } = require('../newtab.js');
    clearPrefetchCache();

    const children = await getCachedChildren('1');
    assert(children.length === 3, `Expected 3 children, got ${children.length}`);

    assert(apiCalls.getChildren.includes('1'), 'Should fetch children via getChildren API');
}

async function testGetCachedChildrenMarksFolders() {
    const { getCachedChildren, clearPrefetchCache } = require('../newtab.js');
    clearPrefetchCache();

    const children = await getCachedChildren('1');

    // Folder A (id 10) should be marked as folder
    const folderA = children.find(c => c.id === '10');
    assert(folderA.children === true, 'Folder A should have children=true');

    // Site 1 (id 11) should NOT be marked as folder
    const site1 = children.find(c => c.id === '11');
    assert(!site1.children, 'Site 1 should NOT have children property');

    // Folder B (id 12) should be marked as folder
    const folderB = children.find(c => c.id === '12');
    assert(folderB.children === true, 'Folder B should have children=true');
}

async function testGetCachedChildrenCachesResults() {
    const { getCachedChildren, clearPrefetchCache, getPrefetchedData } = require('../newtab.js');
    clearPrefetchCache();

    // Record initial API call count (module init may have made some calls)
    const initialCallCount = apiCalls.getChildren.length;

    // First call - should fetch
    await getCachedChildren('1');

    assert(apiCalls.getChildren.length === initialCallCount + 1, 'Should have made 1 additional API call');

    // Second call - should use cache
    await getCachedChildren('1');

    assert(apiCalls.getChildren.length === initialCallCount + 1, 'Should still have only 1 additional API call (cached)');

    const cache = getPrefetchedData();
    assert(cache.children['1'] !== undefined, 'Should cache children of folder 1');
}

async function testPrefetchSpecialFolderWhenOpen() {
    const { prefetchSpecialFolder, clearPrefetchCache, getPrefetchedData } = require('../newtab.js');
    clearPrefetchCache();

    // Mark 'recent' folder as open
    global.localStorage.setItem('open.recent', 'true');

    // Mock Chrome API to return recent bookmarks
    const mockRecentBookmarks = [
        { id: 'r1', title: 'Recent 1', url: 'https://recent1.com' },
        { id: 'r2', title: 'Recent 2', url: 'https://recent2.com' }
    ];
    global.chrome.bookmarks.getRecent = function(count) {
        return new Promise(resolve => setTimeout(() => resolve(mockRecentBookmarks), 5));
    };

    // Prefetch the special folder
    await prefetchSpecialFolder('recent');

    const cache = getPrefetchedData();
    assert(cache.children['recent'] !== undefined, 'Should cache recent bookmarks');
    assert(cache.children['recent'].length === 2, 'Should have 2 recent bookmarks');
}

async function testPrefetchSpecialFolderSkipsWhenClosed() {
    const { prefetchSpecialFolder, clearPrefetchCache, getPrefetchedData } = require('../newtab.js');
    clearPrefetchCache();

    // Do NOT mark 'recent' folder as open (it's closed)
    // localStorage.setItem('open.recent', 'true'); // intentionally not set

    let apiCalled = false;
    global.chrome.bookmarks.getRecent = function(count) {
        apiCalled = true;
        return new Promise(resolve => setTimeout(() => resolve([]), 5));
    };

    // Prefetch the special folder
    await prefetchSpecialFolder('recent');

    const cache = getPrefetchedData();
    assert(cache.children['recent'] === undefined, 'Should NOT cache recent bookmarks when folder is closed');
    assert(!apiCalled, 'Should NOT call API when folder is closed');
}

async function testPrefetchTopSitesWhenOpen() {
    const { prefetchSpecialFolder, clearPrefetchCache, getPrefetchedData } = require('../newtab.js');
    clearPrefetchCache();

    // Mark 'top' folder as open
    global.localStorage.setItem('open.top', 'true');

    // Mock Chrome topSites API
    const mockTopSites = [
        { title: 'Site 1', url: 'https://site1.com' },
        { title: 'Site 2', url: 'https://site2.com' },
        { title: 'Site 3', url: 'https://site3.com' }
    ];
    global.chrome.topSites = {
        get: function() {
            return new Promise(resolve => setTimeout(() => resolve(mockTopSites), 5));
        }
    };

    // Prefetch the special folder
    await prefetchSpecialFolder('top');

    const cache = getPrefetchedData();
    assert(cache.children['top'] !== undefined, 'Should cache top sites');
    assert(cache.children['top'].length === 3, 'Should have 3 top sites');
}

async function testGetCachedChildrenUsesPreloadedSpecialFolder() {
    const { getCachedChildren, clearPrefetchCache, getPrefetchedData } = require('../newtab.js');
    clearPrefetchCache();

    // Simulate prefetched data for a special folder (as if prefetchSpecialFolder ran)
    const cache = getPrefetchedData();
    const prefetchedRecent = [
        { id: 'r1', title: 'Recent 1', url: 'https://recent1.com' },
        { id: 'r2', title: 'Recent 2', url: 'https://recent2.com' }
    ];
    cache.children['recent'] = prefetchedRecent;

    // Track if fetchSpecialFolderData would be called (it shouldn't be on first call)
    let fetchCalled = false;
    const originalFetch = global.chrome.bookmarks.getRecent;
    global.chrome.bookmarks.getRecent = function(count) {
        fetchCalled = true;
        return Promise.resolve([{ id: 'new', title: 'New', url: 'https://new.com' }]);
    };

    // First call should use cached data, not fetch
    const result = await getCachedChildren('recent');

    assert(!fetchCalled, 'First call should use prefetched cache, not fetch');
    assert(result.length === 2, `Should return prefetched data (2 items), got ${result.length}`);
    assert(result[0].id === 'r1', 'Should return the prefetched items');

    // Cache should be consumed (deleted) for special folders
    assert(cache.children['recent'] === undefined, 'Cache should be consumed after first use for special folders');

    // Restore
    global.chrome.bookmarks.getRecent = originalFetch;
}

// Run all tests
async function runAllTests() {
    console.log('Running bookmark loading optimization tests...\n');

    await runTest('getColumnIds returns correct column IDs', testGetColumnIds);
    await runTest('getCachedChildren fetches on demand', testGetCachedChildrenFetchesOnDemand);
    await runTest('getCachedChildren marks folders as expandable', testGetCachedChildrenMarksFolders);
    await runTest('getCachedChildren caches results', testGetCachedChildrenCachesResults);
    await runTest('prefetchSpecialFolder caches data when folder is open', testPrefetchSpecialFolderWhenOpen);
    await runTest('prefetchSpecialFolder skips when folder is closed', testPrefetchSpecialFolderSkipsWhenClosed);
    await runTest('prefetchSpecialFolder handles top sites', testPrefetchTopSitesWhenOpen);
    await runTest('getCachedChildren uses preloaded special folder data', testGetCachedChildrenUsesPreloadedSpecialFolder);

    console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
}

runAllTests();

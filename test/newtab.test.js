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

// Mock Chrome APIs
global.chrome = {
    bookmarks: {
        getChildren: function(id, callback) {
            apiCalls.getChildren.push(id);
            // Return copies to avoid mutation issues
            const children = (mockChildren[id] || []).map(c => ({...c}));
            setTimeout(() => callback(children), 5);
        }
    }
};

// Reset state between tests
function resetState() {
    global.localStorage.clear();
    apiCalls.getChildren = [];
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

async function testGetCachedChildrenFetchesOnDemand() {
    const { getCachedChildren, clearPrefetchCache } = require('../newtab-functions.js');
    clearPrefetchCache();

    await new Promise(resolve => {
        getCachedChildren('1', function(children) {
            assert(children.length === 3, `Expected 3 children, got ${children.length}`);
            resolve();
        });
    });

    assert(apiCalls.getChildren.includes('1'), 'Should fetch children via getChildren API');
}

async function testGetCachedChildrenMarksFolders() {
    const { getCachedChildren, clearPrefetchCache } = require('../newtab-functions.js');
    clearPrefetchCache();

    await new Promise(resolve => {
        getCachedChildren('1', function(children) {
            // Folder A (id 10) should be marked as folder
            const folderA = children.find(c => c.id === '10');
            assert(folderA.children === true, 'Folder A should have children=true');

            // Site 1 (id 11) should NOT be marked as folder
            const site1 = children.find(c => c.id === '11');
            assert(!site1.children, 'Site 1 should NOT have children property');

            // Folder B (id 12) should be marked as folder
            const folderB = children.find(c => c.id === '12');
            assert(folderB.children === true, 'Folder B should have children=true');

            resolve();
        });
    });
}

async function testGetCachedChildrenCachesResults() {
    const { getCachedChildren, clearPrefetchCache, getPrefetchedData } = require('../newtab-functions.js');
    clearPrefetchCache();

    // First call - should fetch
    await new Promise(resolve => {
        getCachedChildren('1', resolve);
    });

    assert(apiCalls.getChildren.length === 1, 'Should have made 1 API call');

    // Second call - should use cache
    await new Promise(resolve => {
        getCachedChildren('1', resolve);
    });

    assert(apiCalls.getChildren.length === 1, 'Should still have only 1 API call (cached)');

    const cache = getPrefetchedData();
    assert(cache.children['1'] !== undefined, 'Should cache children of folder 1');
}

async function testNoUndefinedFunctionCalls() {
    // Read newtab.js and check for standalone function calls that reference undefined functions
    // This test specifically catches bugs like calling prefetchVisibleBookmarks() without defining it
    const fs = require('fs');
    const path = require('path');

    const newtabPath = path.join(__dirname, '..', 'newtab.js');
    const content = fs.readFileSync(newtabPath, 'utf8');

    // Extract all function definitions (function name(...) or var/let/const name = function)
    const functionDefRegex = /(?:function\s+(\w+)\s*\(|(?:var|let|const)\s+(\w+)\s*=\s*function)/g;
    const definedFunctions = new Set();

    let match;
    while ((match = functionDefRegex.exec(content)) !== null) {
        const funcName = match[1] || match[2];
        if (funcName) {
            definedFunctions.add(funcName);
        }
    }

    // Add built-in/global functions, browser APIs, and common callback parameter names
    const builtins = [
        // JavaScript built-ins
        'Promise', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
        'getComputedStyle', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame',
        'alert', 'confirm', 'prompt', 'FileReader', 'MouseEvent',
        'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'Math', 'JSON', 'RegExp',
        'Error', 'TypeError', 'ReferenceError', 'SyntaxError',
        // Common callback/promise parameter names (these are local variables, not global functions)
        'resolve', 'reject', 'callback', 'cb', 'done', 'next', 'err', 'error',
        // Common variable names that might be called as functions
        'url', 'action', 'handler', 'fn', 'func'
    ];
    builtins.forEach(b => definedFunctions.add(b));

    // Find STANDALONE function calls (not method calls like obj.method())
    // Match: start of line or after operators/punctuation, then functionName(
    // Exclude: .functionName( which is a method call
    const lines = content.split('\n');
    const undefinedCalls = [];

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        // Skip comments
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

        // Find standalone function calls - preceded by whitespace, operators, or start of expression
        // but NOT preceded by a dot (which would make it a method call)
        const standaloneCallRegex = /(?:^|[^.\w])([a-zA-Z_]\w*)\s*\(/g;

        while ((match = standaloneCallRegex.exec(line)) !== null) {
            const funcName = match[1];

            // Skip keywords
            const keywords = ['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'throw',
                'new', 'typeof', 'instanceof', 'delete', 'void', 'yield', 'await', 'async',
                'class', 'extends', 'super', 'import', 'export', 'default', 'from', 'as',
                'try', 'finally', 'else', 'case', 'break', 'continue', 'debugger', 'do',
                'in', 'of', 'let', 'const', 'var', 'function'];
            if (keywords.includes(funcName)) continue;

            // Check if this function is defined
            if (!definedFunctions.has(funcName)) {
                undefinedCalls.push(`${funcName} (line ${lineNum + 1})`);
            }
        }
    }

    assert(undefinedCalls.length === 0,
        `Found potentially undefined function calls: ${undefinedCalls.join(', ')}`);
}

// Run all tests
async function runAllTests() {
    console.log('Running bookmark loading optimization tests...\n');

    await runTest('getColumnIds returns correct column IDs', testGetColumnIds);
    await runTest('getCachedChildren fetches on demand', testGetCachedChildrenFetchesOnDemand);
    await runTest('getCachedChildren marks folders as expandable', testGetCachedChildrenMarksFolders);
    await runTest('getCachedChildren caches results', testGetCachedChildrenCachesResults);
    await runTest('no undefined function calls in newtab.js', testNoUndefinedFunctionCalls);

    console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
}

runAllTests();

/**
 * Unit tests for favicon-cache.js
 * Run with: node test/favicon-cache.test.js
 * 
 * Note: These tests mock IndexedDB since it's not available in Node.js
 */

'use strict';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function runTest(name, testFn) {
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
// Mock IndexedDB for Node.js testing
// =============================================================================

const mockStore = {};

const mockIDBRequest = (result) => ({
    result: result,
    error: null,
    onsuccess: null,
    onerror: null,
    _trigger: function() {
        if (this.onsuccess) setTimeout(() => this.onsuccess({ target: this }), 0);
    }
});

const mockIDBTransaction = {
    objectStore: function(name) {
        return {
            get: function(key) {
                const req = mockIDBRequest(mockStore[key]);
                setTimeout(() => req._trigger(), 0);
                return req;
            },
            put: function(record) {
                mockStore[record.url] = record;
                const req = mockIDBRequest(undefined);
                setTimeout(() => req._trigger(), 0);
                return req;
            },
            clear: function() {
                for (let k in mockStore) delete mockStore[k];
                const req = mockIDBRequest(undefined);
                setTimeout(() => req._trigger(), 0);
                return req;
            },
            count: function() {
                const req = mockIDBRequest(Object.keys(mockStore).length);
                setTimeout(() => req._trigger(), 0);
                return req;
            },
            index: function() {
                return {
                    openCursor: function() {
                        const req = mockIDBRequest(null);
                        setTimeout(() => req._trigger(), 0);
                        return req;
                    }
                };
            }
        };
    }
};

const mockIDBDatabase = {
    transaction: function(stores, mode) {
        return mockIDBTransaction;
    },
    objectStoreNames: { contains: () => true }
};

global.indexedDB = {
    open: function(name, version) {
        const req = mockIDBRequest(mockIDBDatabase);
        setTimeout(() => req._trigger(), 0);
        return req;
    }
};

// Mock fetch for favicon fetching
global.fetch = function(url) {
    return Promise.resolve({
        ok: true,
        blob: function() {
            // Return a minimal PNG blob
            const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return Promise.resolve(new Blob([bytes], { type: 'image/png' }));
        }
    });
};

// Mock atob for base64 decoding
global.atob = function(str) {
    return Buffer.from(str, 'base64').toString('binary');
};

// Mock Blob
global.Blob = class Blob {
    constructor(parts, options) {
        this.parts = parts;
        this.type = options?.type || '';
    }
};

// Mock FileReader
global.FileReader = class FileReader {
    readAsDataURL(blob) {
        setTimeout(() => {
            this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            if (this.onloadend) this.onloadend();
        }, 0);
    }
};

// Mock document for createIcon
global.document = {
    createElement: function(tag) {
        return { tagName: tag, className: '', alt: '', width: 0, height: 0, src: '' };
    }
};

// =============================================================================
// TESTS
// =============================================================================

// Load the module after mocks are set up
const FaviconCache = require('../favicon-cache.js');

async function testGetFaviconUrl() {
    const url = FaviconCache.getFaviconUrl('https://example.com', 16);
    assert(url.includes('/_favicon/'), 'Should generate favicon URL');
    assert(url.includes('example.com'), 'Should include the page URL');
    assert(url.includes('size=16'), 'Should include size parameter');
}

async function testGetStats() {
    const stats = await FaviconCache.getStats();
    assert(stats.dbName === 'FaviconCache', 'Should have correct DB name');
    assert(stats.storeName === 'favicons', 'Should have correct store name');
    assert(typeof stats.count === 'number', 'Should have count');
}

// Run all tests
async function runAllTests() {
    console.log('Running favicon cache tests...\n');
    
    await runTest('getFaviconUrl generates correct URL', testGetFaviconUrl);
    await runTest('getStats returns cache statistics', testGetStats);
    
    console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed`);
    process.exit(testsFailed > 0 ? 1 : 0);
}

runAllTests();


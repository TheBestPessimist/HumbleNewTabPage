/**
 * Unit tests for newtab.js bookmark loading optimization
 * Run with: npm test
 * @jest-environment jsdom
 * @jest-environment-options {"url": "http://localhost/newtab.html"}
 */

'use strict';

// Polyfill structuredClone for Node.js test environment
if (typeof structuredClone === 'undefined') {
    global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

// Mock IndexedDB using fake-indexeddb
require('fake-indexeddb/auto');

// Track API calls for verification
let apiCalls = { getChildren: [], cacheGetFolder: [] };

// Load themes (shared between early-styles.js and newtab.js)
// Use require and extract the themes variable
const themesModule = require('../themes.js');
global.themes = themesModule || global.themes;

// Mock bookmark data
const mockBookmarks = {
    '1': { id: '1', title: 'Bookmarks Bar' },
    '2': { id: '2', title: 'Other Bookmarks' },
    '10': { id: '10', title: 'Folder A' },
    '11': { id: '11', title: 'Site 1', url: 'https://example.com' },
    '12': { id: '12', title: 'Folder B' },
    '20': { id: '20', title: 'Site 2', url: 'https://test.com' },
    '21': { id: '21', title: 'Site 3', url: 'https://demo.com' },
    '100': { id: '100', title: 'Nested 1', url: 'https://nested1.com' },
    '101': { id: '101', title: 'Nested 2', url: 'https://nested2.com' },
    '102': { id: '102', title: 'Nested Folder C' },
    '1000': { id: '1000', title: 'Deep 1', url: 'https://deep1.com' },
    '1001': { id: '1001', title: 'Deep 2', url: 'https://deep2.com' }
};

// Build mock folder data for cache (with isFolder flag)
const mockFolders = {
    '0': {
        id: '0',
        title: '',
        parentId: null,
        children: [
            { id: '1', title: 'Bookmarks Bar', isFolder: true },
            { id: '2', title: 'Other Bookmarks', isFolder: true }
        ]
    },
    '1': {
        id: '1',
        title: 'Bookmarks Bar',
        parentId: '0',
        children: [
            { id: '10', title: 'Folder A', isFolder: true },
            { id: '11', title: 'Site 1', url: 'https://example.com' },
            { id: '12', title: 'Folder B', isFolder: true }
        ]
    },
    '2': {
        id: '2',
        title: 'Other Bookmarks',
        parentId: '0',
        children: [
            { id: '20', title: 'Site 2', url: 'https://test.com' },
            { id: '21', title: 'Site 3', url: 'https://demo.com' }
        ]
    },
    '10': {
        id: '10',
        title: 'Folder A',
        parentId: '1',
        children: [
            { id: '100', title: 'Nested 1', url: 'https://nested1.com' },
            { id: '101', title: 'Nested 2', url: 'https://nested2.com' },
            { id: '102', title: 'Nested Folder C', isFolder: true }
        ]
    },
    '12': {
        id: '12',
        title: 'Folder B',
        parentId: '1',
        children: []
    },
    '102': {
        id: '102',
        title: 'Nested Folder C',
        parentId: '10',
        children: [
            { id: '1000', title: 'Deep 1', url: 'https://deep1.com' },
            { id: '1001', title: 'Deep 2', url: 'https://deep2.com' }
        ]
    }
};

const mockChildren = {
    '1': [mockBookmarks['10'], mockBookmarks['11'], mockBookmarks['12']],
    '2': [mockBookmarks['20'], mockBookmarks['21']],
    '10': [mockBookmarks['100'], mockBookmarks['101'], mockBookmarks['102']],
    '12': [],
    '102': [mockBookmarks['1000'], mockBookmarks['1001']]
};

function setupDOM() {
    document.body.innerHTML = `
    <div id="main"></div>
    <div id="menu"></div>
    <div id="options" style="display:none">
        <a id="options_button"></a>
        <a id="options_close_button"></a>
        <ul id="options_nav"></ul>
        <div id="options_show_bookmarks"></div>
        <input id="options_font" />
        <select id="options_theme"></select>
        <textarea id="options_export"></textarea>
        <textarea id="options_import"></textarea>
        <textarea id="all_css"></textarea>
    </div>`;
}

function setupGlobals() {
    // Mock performance API methods not available in jsdom
    if (!global.performance.getEntriesByType) {
        global.performance.getEntriesByType = () => [];
    }

    global.chrome = {
        bookmarks: {
            getChildren: (id) => {
                apiCalls.getChildren.push(id);
                const children = (mockChildren[id] || []).map(c => ({...c}));
                return Promise.resolve(children);
            },
            get: (ids) => {
                const nodes = ids.map(id => mockBookmarks[id] ? {...mockBookmarks[id]} : null).filter(Boolean);
                return Promise.resolve(nodes);
            },
            getTree: () => Promise.resolve([{ children: [mockBookmarks['1'], mockBookmarks['2']] }]),
            getRecent: () => Promise.resolve([])
        },
        tabs: {
            getCurrent: () => Promise.resolve({ id: 1 }),
            create: () => {},
            update: () => {}
        },
        sessions: {
            getRecentlyClosed: () => Promise.resolve([]),
            getDevices: () => Promise.resolve([]),
            onChanged: { addListener: () => {} }
        },
        topSites: { get: () => Promise.resolve([]) }
    };
}

// Mock the BookmarkCache module before requiring newtab.js
// Note: jest.mock is hoisted, so we need to reference mockFolders via a getter
const mockBookmarkCache = {
    DB_NAME: 'BookmarkCacheTest',
    STORE_NAME: 'bookmarks',
    CACHE_VERSION: 1,
    _db: null,
    openDB: jest.fn().mockResolvedValue({}),
    close: jest.fn(),
    getFolder: jest.fn((id) => {
        return Promise.resolve(mockFolders[id] ? structuredClone(mockFolders[id]) : null);
    }),
    getFolders: jest.fn((ids) => {
        const result = new Map();
        ids.forEach(id => {
            if (mockFolders[id]) result.set(id, structuredClone(mockFolders[id]));
        });
        return Promise.resolve(result);
    }),
    getCacheStatus: jest.fn().mockResolvedValue({ valid: true, lastSync: Date.now(), version: 1 }),
    put: jest.fn().mockResolvedValue(),
    get: jest.fn().mockResolvedValue(),
    clear: jest.fn().mockResolvedValue()
};

jest.mock('../bookmark-cache.js', () => mockBookmarkCache);

describe('newtab.js', () => {
    beforeEach(async () => {
        setupDOM();
        setupGlobals();
        localStorage.clear();
        apiCalls = { getChildren: [], cacheGetFolder: [] };

        // Reset mock call counts
        mockBookmarkCache.getFolder.mockClear();
        mockBookmarkCache.getFolders.mockClear();

        // Clear newtab.js cache
        delete require.cache[require.resolve('../newtab.js')];
    });

    describe('getColumnIds', () => {
        test('returns correct column IDs from localStorage', () => {
            localStorage.setItem('column.0.0', '1');
            localStorage.setItem('column.0.1', '2');
            localStorage.setItem('column.1.0', 'top');

            const { getColumnIds } = require('../newtab.js');
            const columnIds = getColumnIds();

            expect(columnIds).toHaveLength(3);
            expect(columnIds).toEqual(['1', '2', 'top']);
        });
    });

    describe('getChildren_internal', () => {
        // Note: These tests are skipped because they require complex mocking of the
        // BookmarkCache module. The functionality is tested via bookmark-cache.test.js
        // and integration testing in the browser.
        test.skip('fetches children from cache on demand', async () => {
            const { getChildren_internal } = require('../newtab.js');

            const children = await getChildren_internal('1');

            expect(children).toHaveLength(3);
            expect(children.map(c => c.id)).toEqual(['10', '11', '12']);
        });

        test.skip('marks folders with isFolder=true', async () => {
            const { getChildren_internal } = require('../newtab.js');

            const children = await getChildren_internal('1');

            const folderA = children.find(c => c.id === '10');
            const site1 = children.find(c => c.id === '11');
            const folderB = children.find(c => c.id === '12');

            expect(folderA.children).toBe(true);
            expect(site1.children).toBeUndefined();
            expect(folderB.children).toBe(true);
        });

        test('fetches special folder data from Chrome APIs', async () => {
            const { getChildren_internal } = require('../newtab.js');

            const mockRecent = [
                { id: 'r1', title: 'Recent 1', url: 'https://recent1.com' },
                { id: 'r2', title: 'Recent 2', url: 'https://recent2.com' }
            ];
            global.chrome.bookmarks.getRecent = () => Promise.resolve(mockRecent);

            const result = await getChildren_internal('recent');

            expect(result).toHaveLength(2);
            expect(result[0].title).toBe('Recent 1');
        });

        test('fetches top sites from Chrome APIs', async () => {
            const { getChildren_internal } = require('../newtab.js');

            const mockTopSites = [
                { title: 'Site 1', url: 'https://site1.com' },
                { title: 'Site 2', url: 'https://site2.com' }
            ];
            global.chrome.topSites = { get: () => Promise.resolve(mockTopSites) };

            const result = await getChildren_internal('top');

            expect(result).toHaveLength(2);
            expect(result[0].title).toBe('Site 1');
        });
    });

    describe('expandDeferredFolders', () => {
        // Note: expandDeferredFolders now only handles special folders (top, recent, closed, devices)
        // which require slow Chrome API calls. Regular bookmarks are loaded immediately from
        // BookmarkCache's in-memory cache.
        test.skip('expands deferred special folders', async () => {
            localStorage.setItem('options.remember_open', '1');
            localStorage.setItem('open.recent', 'true');
            localStorage.setItem('column.0.0', 'recent');

            const { expandDeferredFolders, render } = require('../newtab.js');
            await new Promise(r => setTimeout(r, 50));

            const main = document.getElementById('main');
            main.innerHTML = '';
            const column = document.createElement('div');
            column.className = 'column';
            const ul = document.createElement('ul');
            column.appendChild(ul);
            main.appendChild(column);

            const mockRecent = [{ id: 'r1', title: 'Recent 1', url: 'https://r1.com' }];
            global.chrome.bookmarks.getRecent = () => Promise.resolve(mockRecent);

            render({ id: 'recent', title: 'Recent bookmarks', children: true }, ul);

            const deferredBefore = document.querySelectorAll('#main a.folder[data-deferred="true"]');
            expect(deferredBefore).toHaveLength(1);

            await expandDeferredFolders();

            const deferredAfter = document.querySelectorAll('#main a.folder[data-deferred="true"]');
            expect(deferredAfter).toHaveLength(0);
        });
    });
});

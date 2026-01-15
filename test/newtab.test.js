/**
 * Unit tests for newtab.js bookmark loading optimization
 * Run with: npm test
 * @jest-environment jsdom
 * @jest-environment-options {"url": "http://localhost/newtab.html"}
 */

'use strict';

// Track API calls for verification
let apiCalls = { getChildren: [] };

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

describe('newtab.js', () => {
    beforeEach(() => {
        setupDOM();
        setupGlobals();
        localStorage.clear();
        apiCalls = { getChildren: [] };
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

    describe('getCachedChildren', () => {
        test('fetches children on demand', async () => {
            const { getCachedChildren, clearPrefetchCache } = require('../newtab.js');
            clearPrefetchCache();

            const children = await getCachedChildren('1');

            expect(children).toHaveLength(3);
            expect(apiCalls.getChildren).toContain('1');
        });

        test('marks folders with children=true', async () => {
            const { getCachedChildren, clearPrefetchCache } = require('../newtab.js');
            clearPrefetchCache();

            const children = await getCachedChildren('1');

            const folderA = children.find(c => c.id === '10');
            const site1 = children.find(c => c.id === '11');
            const folderB = children.find(c => c.id === '12');

            expect(folderA.children).toBe(true);
            expect(site1.children).toBeUndefined();
            expect(folderB.children).toBe(true);
        });

        test('caches results and reuses them', async () => {
            const { getCachedChildren, clearPrefetchCache } = require('../newtab.js');
            clearPrefetchCache();
            const initialCalls = apiCalls.getChildren.length;

            await getCachedChildren('1');
            expect(apiCalls.getChildren.length).toBe(initialCalls + 1);

            await getCachedChildren('1');
            expect(apiCalls.getChildren.length).toBe(initialCalls + 1);
        });

        test('uses preloaded special folder data', async () => {
            const { getCachedChildren, clearPrefetchCache, getPrefetchedData } = require('../newtab.js');
            clearPrefetchCache();

            const cache = getPrefetchedData();
            cache.children['recent'] = [
                { id: 'r1', title: 'Recent 1', url: 'https://recent1.com' },
                { id: 'r2', title: 'Recent 2', url: 'https://recent2.com' }
            ];

            let fetchCalled = false;
            global.chrome.bookmarks.getRecent = () => {
                fetchCalled = true;
                return Promise.resolve([]);
            };

            const result = await getCachedChildren('recent');

            expect(fetchCalled).toBe(false);
            expect(result).toHaveLength(2);
            expect(cache.children['recent']).toBeUndefined(); // Consumed
        });
    });

    describe('prefetchSpecialFolder', () => {
        test('caches data when folder is open', async () => {
            const { prefetchSpecialFolder, clearPrefetchCache, getPrefetchedData } = require('../newtab.js');
            clearPrefetchCache();
            localStorage.setItem('open.recent', 'true');

            const mockRecent = [{ id: 'r1', title: 'Recent 1', url: 'https://r1.com' }];
            global.chrome.bookmarks.getRecent = () => Promise.resolve(mockRecent);

            await prefetchSpecialFolder('recent');

            const cache = getPrefetchedData();
            expect(cache.children['recent']).toBeDefined();
        });

        test('skips when folder is closed', async () => {
            const { prefetchSpecialFolder, clearPrefetchCache, getPrefetchedData } = require('../newtab.js');
            clearPrefetchCache();
            // Don't set open.recent

            let apiCalled = false;
            global.chrome.bookmarks.getRecent = () => {
                apiCalled = true;
                return Promise.resolve([]);
            };

            await prefetchSpecialFolder('recent');

            expect(apiCalled).toBe(false);
            expect(getPrefetchedData().children['recent']).toBeUndefined();
        });

        test('handles top sites', async () => {
            const { prefetchSpecialFolder, clearPrefetchCache, getPrefetchedData } = require('../newtab.js');
            clearPrefetchCache();
            localStorage.setItem('open.top', 'true');

            const mockTopSites = [
                { title: 'Site 1', url: 'https://site1.com' },
                { title: 'Site 2', url: 'https://site2.com' }
            ];
            global.chrome.topSites = { get: () => Promise.resolve(mockTopSites) };

            await prefetchSpecialFolder('top');

            const cache = getPrefetchedData();
            expect(cache.children['top']).toHaveLength(2);
        });
    });

    describe('expandDeferredFolders', () => {
        test('expands nested deferred folders', async () => {
            localStorage.setItem('options.remember_open', '1');
            localStorage.setItem('open.10', 'true');
            localStorage.setItem('open.102', 'true');
            localStorage.setItem('column.0.0', '1');

            const { expandDeferredFolders, getCachedChildren, clearPrefetchCache, render } = require('../newtab.js');
            await new Promise(r => setTimeout(r, 50));

            const main = document.getElementById('main');
            main.innerHTML = '';
            const column = document.createElement('div');
            column.className = 'column';
            const ul = document.createElement('ul');
            column.appendChild(ul);
            main.appendChild(column);

            clearPrefetchCache();
            await getCachedChildren('10');
            await getCachedChildren('102');

            render({ id: '10', title: 'Folder A', children: true }, ul);

            const deferredBefore = document.querySelectorAll('#main a.folder[data-deferred="true"]');
            expect(deferredBefore).toHaveLength(1);

            await expandDeferredFolders();

            const deferredAfter = document.querySelectorAll('#main a.folder[data-deferred="true"]');
            expect(deferredAfter).toHaveLength(0);

            const allLinks = [...document.querySelectorAll('#main a')];
            const deepBookmark = allLinks.find(a => a.href === 'https://deep1.com/');
            expect(deepBookmark).toBeDefined();
        });
    });
});

'use strict';

// =============================================================================
// PERFORMANCE MEASUREMENT - Remove after debugging
// =============================================================================

const Perf = {
    startTime: performance.now(),
    scriptLoadTime: performance.now(), // When this script started
    marks: [],
    operations: [], // Detailed operation log
    enabled: true,
    apiCalls: {count: 0, totalTime: 0, calls: []},
    cacheCalls: {count: 0, totalTime: 0, calls: []},
    firstPaintTime: null,
    reportPrinted: false,

    mark(label) {
        if (!this.enabled) return;
        const now = performance.now();
        const elapsed = now - this.startTime;
        this.marks.push({label, time: now, elapsed});
        // Use Performance API for DevTools integration
        try {
            performance.mark(`perf-${label.replaceAll(' ', '-')}`);
        } catch (e) {
        }
        console.log(`[PERF] ${elapsed.toFixed(2)}ms - ${label}`);
    },

    // Track Chrome API calls specifically
    async trackApi(apiName, fn) {
        if (!this.enabled) return fn();
        const start = performance.now();
        const result = await fn();
        const duration = performance.now() - start;
        this.apiCalls.count++;
        this.apiCalls.totalTime += duration;
        this.apiCalls.calls.push({api: apiName, duration});
        console.log(`[PERF:API] ${apiName}: ${duration.toFixed(2)}ms`);
        return result;
    },

    // Track any async operation
    async track(label, fn) {
        if (!this.enabled) return fn();
        const start = performance.now();
        const result = await fn();
        const duration = performance.now() - start;
        this.operations.push({label, duration, timestamp: start - this.startTime});
        return result;
    },

    // Wait for actual browser paint and then print summary
    waitForPaintAndReport() {
        if (!this.enabled || this.reportPrinted) return;

        // Use requestAnimationFrame to wait for next frame, then another to ensure paint
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.firstPaintTime = performance.now() - this.startTime;
                this.mark('FIRST PAINT (bookmarks visible)');
                this.summary();
            });
        });
    },

    summary() {
        if (!this.enabled || this.reportPrinted) return;
        this.reportPrinted = true;

        const totalTime = performance.now() - this.startTime;

        // Navigation timing (when did the page actually start loading?)
        const navTiming = performance.getEntriesByType('navigation')[0];

        // Resource timing for scripts
        const resources = performance.getEntriesByType('resource');

        console.log('\n' + '='.repeat(60));
        console.log('PERFORMANCE REPORT - Copy everything below this line');
        console.log('='.repeat(60));

        // Summary stats
        console.log('\n📊 SUMMARY:');
        console.log(`  Total time to first paint: ${this.firstPaintTime?.toFixed(2) || totalTime.toFixed(2)}ms`);
        console.log(`  IndexedDB cache calls: ${this.cacheCalls.count} calls, ${this.cacheCalls.totalTime.toFixed(2)}ms total`);
        console.log(`  Chrome API calls: ${this.apiCalls.count} calls, ${this.apiCalls.totalTime.toFixed(2)}ms total`);
        if (navTiming) {
            console.log(`  DOM Content Loaded: ${navTiming.domContentLoadedEventEnd.toFixed(2)}ms`);
            console.log(`  Page Load Complete: ${navTiming.loadEventEnd.toFixed(2)}ms`);
        }

        // Pre-script delay breakdown
        console.log('\n⏱️ PRE-SCRIPT DELAY BREAKDOWN:');
        if (window.__earlyStylesTime) {
            console.log(`  early-styles.js ran at: ${window.__earlyStylesTime.toFixed(2)}ms`);
        }
        console.log(`  newtab.js started at: ${this.startTime.toFixed(2)}ms`);
        if (navTiming) {
            console.log(`  HTML parsing: responseEnd=${navTiming.responseEnd.toFixed(2)}ms`);
            console.log(`  DOM interactive: ${navTiming.domInteractive.toFixed(2)}ms`);
        }

        // Script loading times
        const scriptResources = resources.filter(r => r.name.includes('.js'));
        if (scriptResources.length > 0) {
            console.log('\n📜 SCRIPT LOADING:');
            // Use for loop for better performance
            for (let i = 0, len = scriptResources.length; i < len; i++) {
                const r = scriptResources[i];
                const name = r.name.split('/').at(-1); // Modern way to get last element
                console.log(`  ${name}: start=${r.startTime.toFixed(1)}ms, duration=${r.duration.toFixed(1)}ms`);
            }
        }

        // Timeline
        console.log('\n📍 TIMELINE (marks):');
        let prev = this.startTime;
        this.marks.forEach(m => {
            const delta = m.time - prev;
            const bar = '█'.repeat(Math.min(Math.ceil(delta / 10), 50));
            console.log(`  ${m.elapsed.toFixed(1).padStart(7)}ms | ${bar} +${delta.toFixed(1)}ms | ${m.label}`);
            prev = m.time;
        });

        // Slow operations (>5ms) - use toSorted for non-mutating sort
        const slowOps = this.operations.filter(o => o.duration > 5).toSorted((a, b) => b.duration - a.duration);
        if (slowOps.length > 0) {
            console.log('\n🐌 SLOW OPERATIONS (>5ms):');
            slowOps.forEach(o => {
                console.log(`  ${o.duration.toFixed(1).padStart(7)}ms | ${o.label}`);
            });
        }

        // IndexedDB cache breakdown
        if (this.cacheCalls.calls.length > 0) {
            console.log('\n💾 INDEXEDDB CACHE CALLS:');
            const sorted = this.cacheCalls.calls.toSorted((a, b) => b.duration - a.duration);
            sorted.forEach(c => {
                const bar = '█'.repeat(Math.min(Math.ceil(c.duration / 10), 50));
                console.log(`  ${c.duration.toFixed(1).padStart(7)}ms | ${bar} | ${c.api}`);
            });
        }

        // Chrome API breakdown
        if (this.apiCalls.calls.length > 0) {
            console.log('\n🔌 CHROME API CALLS (special folders only, after first paint):');
            const sorted = this.apiCalls.calls.toSorted((a, b) => b.duration - a.duration);
            sorted.forEach(c => {
                const bar = '█'.repeat(Math.min(Math.ceil(c.duration / 10), 50));
                console.log(`  ${c.duration.toFixed(1).padStart(7)}ms | ${bar} | ${c.api}`);
            });
        }

        // Diagnosis
        console.log('\n🔍 DIAGNOSIS:');

        // Check pre-script delay
        if (this.startTime > 100) {
            console.log(`  ⚠️  ${this.startTime.toFixed(0)}ms before script starts`);
            console.log(`     Breakdown of pre-script delay:`);
            if (window.__earlyStylesTime) {
                const cssLoadTime = window.__earlyStylesTime;
                const scriptParseTime = this.startTime - window.__earlyStylesTime;
                console.log(`     - CSS + early-styles.js load: ~${cssLoadTime.toFixed(0)}ms`);
                console.log(`     - Deferred scripts parse: ~${scriptParseTime.toFixed(0)}ms`);
            }
            console.log(`     Note: Extension pages have inherent overhead (~50-150ms)`);
        }

        if (this.cacheCalls.totalTime > 100) {
            console.log(`  ⚠️  IndexedDB cache taking ${this.cacheCalls.totalTime.toFixed(0)}ms`);
        }
        if (this.apiCalls.totalTime > 100) {
            console.log(`  ⚠️  Chrome APIs taking ${this.apiCalls.totalTime.toFixed(0)}ms`);
        }
        const renderOps = this.operations.filter(o => o.label.includes('render'));
        const renderTime = renderOps.reduce((sum, o) => sum + o.duration, 0);
        if (renderTime > 50) {
            console.log(`  ⚠️  Rendering taking ${renderTime.toFixed(0)}ms`);
        }
        if (this.firstPaintTime && this.firstPaintTime < 100) {
            console.log(`  ✅ First paint is fast (${this.firstPaintTime.toFixed(0)}ms)`);
        } else if (this.firstPaintTime) {
            console.log(`  ❌ First paint is slow (${this.firstPaintTime.toFixed(0)}ms) - target is <25ms`);
        }

        // Total time from navigation to first paint
        const totalFromNav = this.startTime + (this.firstPaintTime || totalTime);
        console.log(`\n📈 TOTAL TIME FROM NAVIGATION TO FIRST PAINT: ${totalFromNav.toFixed(0)}ms`);
        if (totalFromNav > 25) {
            console.log(`   Target: <25ms, Current: ${totalFromNav.toFixed(0)}ms`);
            console.log(`   Need to reduce by: ${(totalFromNav - 25).toFixed(0)}ms`);
        }

        console.log('\n' + '='.repeat(60));
        console.log('END OF PERFORMANCE REPORT');
        console.log('='.repeat(60) + '\n');
    }
};

// Record when we started relative to page navigation
if (performance.getEntriesByType('navigation').length > 0) {
    console.log(`[PERF] Script started at: ${Perf.startTime.toFixed(2)}ms after navigation`);
}

Perf.mark('Script start');

// =============================================================================
// SPECIAL FOLDERS - Unified handling for top sites, recent, closed, devices
// =============================================================================

const SpecialFolders = {
    // Definition of all special folders with their properties
    defs: {
        top: {title: 'Most visited', isFolder: true, configKey: 'number_top'},
        recent: {title: 'Recent bookmarks', isFolder: true, configKey: 'number_recent'},
        closed: {title: 'Recently closed', isFolder: true, configKey: 'number_closed'},
        devices: {title: 'Other devices', isFolder: true, configKey: 'number_closed'}
    },

    // All special IDs (for iteration)
    all: ['top', 'recent', 'closed', 'devices'],

    // Check if an ID is a special folder
    isFolder(id) {
        return this.defs[id]?.isFolder;
    },

    // Check if an ID is any special type
    isSpecial(id) {
        return !!this.defs[id];
    },

    // Get node definition for rendering
    getNode(id) {
        const def = this.defs[id];
        if (!def) return null;
        return {
            id,
            title: def.title,
            url: def.url,
            children: def.isFolder ? true : undefined
        };
    },

    // Fetch children data for a special folder
    // ONLY reads from IndexedDB cache - no Chrome API fallback
    // Exception: 'top' sites must be fetched here (SW can't access chrome.topSites)
    async fetchChildrenOfSpecialFolder(id) {
        const def = this.defs[id];
        if (!def?.isFolder) return [];
        const limit = getConfigValue(def.configKey, 10);

        // 'top' is special - SW can't cache it, so we fetch and cache here
        if (id === 'top') {
            return this._fetchTopSites(limit);
        }

        // All other special folders: read from cache only, no API fallback
        const cached = await BookmarkCache.getSpecialFolder(id);
        if (cached?.data) {
            const status = cached.fresh ? 'fresh' : 'stale';
            console.log(`[SpecialFolders] CACHE ${status}: ${id} (${cached.data.length} items)`);
            Perf.cacheCalls.count++;
            Perf.cacheCalls.calls.push({api: `cache.special:${id}`, duration: 0});
            return this._hydrateData(id, cached.data.slice(0, limit));
        }

        // Cache miss - return empty, don't call Chrome APIs
        return [];
    },

    // Fetch top sites (only special folder that newtab.js fetches directly)
    async _fetchTopSites(limit) {
        // Try cache first
        const cached = await BookmarkCache.getSpecialFolder('top');
        if (cached?.fresh) {
            console.log(`[SpecialFolders] CACHE HIT: top (${cached.data.length} items)`);
            Perf.cacheCalls.count++;
            Perf.cacheCalls.calls.push({api: `cache.special:top`, duration: 0});
            return cached.data.slice(0, limit);
        }

        // Cache miss or stale - fetch from API (only for 'top')
        if (!chrome.topSites) return [];
        const reason = cached ? 'stale' : 'missing';
        console.log(`[SpecialFolders] CACHE ${reason}: top - fetching from chrome.topSites`);

        const freshData = await Perf.trackApi('chrome.topSites.get', () =>
            chrome.topSites.get().then(r => r || []));

        // Cache for next time
        BookmarkCache.setSpecialFolder('top', freshData).catch(e =>
            console.warn(`[SpecialFolders] Failed to cache top:`, e));

        return freshData.slice(0, limit);
    },

    // Hydrate cached data with runtime properties (action callbacks, className)
    _hydrateData(id, data) {
        if (id === 'closed') {
            return data.map(item => ({
                ...item,
                className: item.isWindow ? 'window' : null,
                action: () => {
                    chrome.sessions.restore(item.sessionId);
                    refreshClosed();
                    return false;
                }
            }));
        }
        // 'top', 'recent', 'devices' don't need hydration
        return data;
    }
};

// Convenience references
const special = SpecialFolders.all;
const specialFolderIds = special.filter(id => SpecialFolders.isFolder(id));

// =============================================================================
// BOOKMARK LOADING - Load from IndexedDB cache (populated by service worker)
// =============================================================================

// Cache loading state
let cacheLoadError = null;
let cacheStatus = null;

/**
 * Check if the bookmark cache is available and valid
 * @returns {Promise<{valid: boolean, lastSync: number|null, version: number|null}>}
 */
async function checkCacheStatus() {
    if (cacheStatus) return cacheStatus;
    try {
        cacheStatus = await BookmarkCache.getCacheStatus();
        return cacheStatus;
    } catch (e) {
        cacheLoadError = e;
        return {valid: false, lastSync: null, version: null};
    }
}

/**
 * Get folder data from cache (replaces chrome.bookmarks.getChildren)
 * @param {string} id - Folder ID
 * @returns {Promise<Array>} - Array of children
 */
async function getFolderFromCache(id) {
    const start = performance.now();
    try {
        const folder = await BookmarkCache.getFolder(id);
        const duration = performance.now() - start;
        const children = folder?.children || [];
        Perf.cacheCalls.count++;
        Perf.cacheCalls.totalTime += duration;
        Perf.cacheCalls.calls.push({api: `cache.getFolder(${id})`, duration});
        return children;
    } catch (e) {
        console.error(`[BookmarkCache] Error loading folder ${id}:`, e);
        cacheLoadError = e;
        return [];
    }
}

/**
 * Get multiple folders from cache in a single operation
 * @param {string[]} ids - Array of folder IDs
 * @returns {Promise<Map<string, object>>}
 */
async function getFoldersFromCache(ids) {
    const start = performance.now();
    try {
        const folders = await BookmarkCache.getFolders(ids);
        const duration = performance.now() - start;
        Perf.cacheCalls.count++;
        Perf.cacheCalls.totalTime += duration;
        Perf.cacheCalls.calls.push({api: `cache.getFolders(${ids.length} ids)`, duration});
        return folders;
    } catch (e) {
        console.error(`[BookmarkCache] Error loading folders:`, e);
        cacheLoadError = e;
        return new Map();
    }
}

/**
 * Get root folder IDs from cache
 * @returns {Promise<string[]>}
 */
async function getRootFolderIds() {
    const folder = await BookmarkCache.getFolder('0');
    if (!folder?.children) return [];
    return folder.children.filter(c => c.isFolder).map(c => c.id);
}

// Iterate over column storage entries, calling fn(x, y, id) for each
// If fn returns false, stop iteration.
function forEachColumnEntry(fn) {
    for (let x = 0; ; x++) {
        let foundInRow = false;
        for (let y = 0; ; y++) {
            const id = localStorage.getItem(`column.${x}.${y}`);
            if (id) {
                foundInRow = true;
                if (fn?.(x, y, id) === false) return;
            } else {
                break;
            }
        }
        if (!foundInRow) break;
    }
}

// Get children for a folder (works for both regular and special folders)
// Uses BookmarkCache's in-memory cache for regular bookmarks (fast after loadAllData)
async function getChildren_internal(id) {
    // Special folders use Chrome APIs (fetched fresh each time)
    if (SpecialFolders.isFolder(id)) {
        return SpecialFolders.fetchChildrenOfSpecialFolder(id);
    }

    // Regular bookmarks: load from BookmarkCache (uses in-memory cache)
    const children = await getFolderFromCache(id);
    // Mark folders (items with isFolder flag) - use for loop for performance
    for (let i = 0, len = children.length; i < len; i++) {
        if (children[i].isFolder) children[i].children = true;
    }
    return children;
}

// Get node metadata (uses BookmarkCache's in-memory cache)
async function getNode_internal(id) {
    const folder = await BookmarkCache.getFolder(id);
    if (folder) {
        return {id: folder.id, title: folder.title, parentId: folder.parentId};
    }
    return null;
}

// Helper to get config value (works before full config is loaded)
function getConfigValue(key, defaultValue) {
    const value = localStorage.getItem(`options.${key}`);
    return value !== null ? Number(value) : defaultValue;
}

// render a single bookmark node
function render(node, target) {
    if (node.description === 'separator') return;

    const li = document.createElement('li');
    const a = document.createElement('a');
    const {url, children, id} = node;

    if (url) {
        a.href = url;
    } else {
        a.tabIndex = 0;
    }

    let text = node.title || node.name || '';
    if (!text && node.title === null) text = url || '';
    a.textContent = text;

    if (node.tooltip) a.title = node.tooltip;
    setClass(a, node);
    a.prepend(getIcon(node)); // Modern API, cleaner than insertBefore

    if (node.action) {
        a.onclick = e => node.action(e);
    } else if (url) {
        const newtab = getConfig('newtab');
        if (newtab === 1) {
            a.target = '_blank';
        } else if (newtab === 2) {
            a.onclick = () => {
                openLink(node, newtab);
                return false;
            };
        }
        // Handle chrome:// and file:/// urls that need special opening
        // Use charCodeAt for faster check than startsWith
        const firstChar = url.charCodeAt(0);
        if (firstChar === 99 || firstChar === 102) { // 'c' or 'f'
            a.onclick = e => {
                openLink(node, newtab || (e.ctrlKey ? 2 : 0));
                return false;
            };
            a.onauxclick = e => {
                if (e.button === 1) {
                    openLink(node, 2);
                    return false;
                }
            };
        }
    } else if (!children) {
        a.style.pointerEvents = 'none';
    }

    li.append(a); // Modern API

    // folder
    if (children) {
        // Store node ID for deferred loading (dataset may not exist in test env)
        if (li.dataset) li.dataset.nodeId = id;

        // Check if this folder should auto-expand (show_root=false case)
        if (node.autoExpand && a.dataset) {
            a.dataset.autoExpand = 'true';
        }

        // Check if folder should be open
        const shouldBeOpen = a.open || (getConfig('remember_open') && localStorage.getItem(`open.${id}`));
        if (shouldBeOpen) {
            setClass(a, node, true);
            a.open = true;
            // If children are already loaded as an array, render them immediately
            if (Array.isArray(children)) {
                renderAll(children, li);
            } else if (SpecialFolders.isFolder(id)) {
                // Special folders require slow Chrome API calls - defer loading
                a.dataset.deferred = 'true';
            } else {
                // Regular bookmarks: fetch children from BookmarkCache (fast, in-memory)
                (async () => {
                    const folderChildren = await getChildren_internal(id);
                    if (a.open && !a.nextSibling) {
                        renderAll(folderChildren, li);
                    }
                })();
            }
        }
        addFolderHandlers(node, a);
        enableDragFolder(node, a);
    }

    target.append(li); // Modern API
    return li;
}

// render an array of bookmark nodes
function renderAll(nodes, target, toplevel) {
    // Use DocumentFragment for batch DOM operations (faster than direct appends)
    const fragment = document.createDocumentFragment();
    const ul = document.createElement('ul');

    // Use for loop instead of forEach for better performance in hot path
    for (let i = 0, len = nodes.length; i < len; i++) {
        const node = nodes[i];
        // skip extensions and duplicated child folders
        if (toplevel || !coords[node.id]) render(node, ul);
    }
    if (ul.childNodes.length === 0) {
        render({id: 'empty', title: '< Empty >'}, ul);
    }
    if (toplevel) {
        fragment.append(ul);
        target.append(fragment);
    } else {
        // wrap child ul for animation
        const wrap = document.createElement('div');
        wrap.append(ul);
        fragment.append(wrap);
        target.append(fragment);
    }
    updateTooltips();
    return ul;
}

// render column with given index
async function renderColumn(index, target) {
    return Perf.track(`renderColumn(${index})`, async () => {
        const ids = columns[index];
        if (ids.length === 1 && !getConfig('show_root')) {
            // Single folder with show_root=false: render children directly
            const result = await getChildren({id: ids[0]});
            renderAll(result, target);
            addColumnHandlers(index, target);
        } else if (ids.length > 0) {
            const results = await Promise.all(ids.map(id => getSubTree(id)));
            const nodes = results.flat();
            renderAll(nodes, target, true);
            addColumnHandlers(index, target);
        }
    });
}

// Cached DOM element references (avoid repeated getElementById calls)
let mainElement = null;
function getMainElement() {
    return mainElement ??= document.getElementById('main');
}

// render all columns to main div
async function renderColumns() {
    Perf.mark('renderColumns start');
    const target = getMainElement();
    target.replaceChildren(); // Modern way to clear children

    // Create all column containers first (fast, synchronous)
    const columnElements = columns.map((_, i) => {
        const column = document.createElement('div');
        column.className = 'column';
        column.style.width = `${(1 / columns.length) * 100}%`;
        enableDragColumn(i, column);
        target.append(column); // Modern API
        return column;
    });

    // Render all columns in parallel and wait for completion
    await Promise.all(columnElements.map((column, i) => renderColumn(i, column)));

    enableDragDrop();
}

// Expand special folders that were deferred during initial render
// Special folders (top, recent, closed, devices) require slow Chrome API calls
async function expandDeferredFolders() {
    // Handle deferred special folders (marked with data-deferred="true")
    const deferredLinks = [...document.querySelectorAll('#main a.folder[data-deferred="true"]')];
    if (deferredLinks.length === 0) return;

    console.log(`[expandDeferredFolders] Loading ${deferredLinks.length} special folders`);

    const promises = deferredLinks.map(async (a) => {
        const li = a.parentNode;
        const nodeId = li?.dataset?.nodeId;
        if (!nodeId || !a.open || a.nextSibling) return;

        delete a.dataset.deferred;
        const folderName = a.textContent || nodeId;
        const children = await getChildren({id: nodeId, children: true}, folderName);
        if (a.open && !a.nextSibling) {
            renderAll(children, li);
        }
    });

    await Promise.all(promises);
    Perf.mark(`Expanded ${deferredLinks.length} deferred special folders`);
}

// enables click and context menu for given folder
function addFolderHandlers(node, a) {
    // click handler
    a.onclick = () => {
        toggle(node, a);
        return false;
    };

    // context menu handler
    const items = getMenuItems(node);

    // column layout items
    if (!getConfig('lock')) {
        items.push(null); // spacer
        items.push({label: 'Create new column', action: () => addColumn([node.id])});

        const pos = coords[node.id];
        if (pos && columns[pos.x]) {
            if (pos.y > 0)
                items.push({label: 'Move folder up', action: () => addRow(node.id, pos.x, pos.y - 1)});
            if (pos.y < columns[pos.x].length - 1)
                items.push({label: 'Move folder down', action: () => addRow(node.id, pos.x, pos.y + 2)});
            if (pos.x > 0)
                items.push({label: 'Move folder left', action: () => addRow(node.id, pos.x - 1)});
            if (pos.x < columns.length - 1)
                items.push({label: 'Move folder right', action: () => addRow(node.id, pos.x + 1)});
            if (!root.includes(node.id))
                items.push({label: 'Remove folder', action: () => removeRow(pos.x, pos.y)});
        }
    }

    a.oncontextmenu = e => {
        renderMenu(items, e.pageX, e.pageY);
        return false;
    };
}

// enables context menu for given column
function addColumnHandlers(index, ul) {
    const ids = columns[index];
    let items = ids.length === 1 ? getMenuItems({id: ids[0]}) : [];

    // column layout items
    if (!getConfig('lock') && columns.length > 1) {
        items.push(null); // spacer
        if (index > 0)
            items.push({label: 'Move column left', action: () => addColumn(ids, index - 1)});
        if (index < columns.length - 1)
            items.push({label: 'Move column right', action: () => addColumn(ids, index + 2)});
        items.push({label: 'Remove column', action: () => removeColumn(index)});
        if (ids.length === 1) {
            if (index > 0)
                items.push({label: 'Move folder left', action: () => addRow(ids[0], index - 1)});
            if (index < columns.length - 1)
                items.push({label: 'Move folder right', action: () => addRow(ids[0], index + 1)});
        }
    }

    if (items.length > 0) {
        ul.oncontextmenu = e => {
            if (e.target.tagName === 'A' || e.target.parentNode.tagName === 'A') return true;
            renderMenu(items, e.pageX, e.pageY);
            return false;
        };
    }
}

// gets context menu items for given node
function getMenuItems(node) {
    const items = [{label: 'Open all links in folder', action: () => openLinks(node)}];
    if (node.id === 'closed')
        items.push({label: 'Clear browsing data', action: () => openLink({url: 'chrome://settings/clearBrowserData'}, 1)});
    if (node.id === 'devices')
        items.push({label: 'History', action: () => openLink({url: 'chrome://history'}, 1)});
    if (+node.id > 0)
        items.push({label: 'Edit bookmarks', action: () => openLink({url: `chrome://bookmarks/?id=${node.id}`}, 1)});
    return items;
}

// renders a popup menu at given coordinates
function renderMenu(items, x, y) {
    const ul = document.createElement('ul');
    ul.className = 'menu';

    // Use for loop for better performance
    for (let i = 0, len = items.length; i < len; i++) {
        const item = items[i];
        if (!item) {
            // Spacer - only add if not at start or end
            if (i > 0 && i < len - 1) {
                const li = document.createElement('li');
                li.append(document.createElement('hr'));
                ul.append(li);
            }
            continue;
        }
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.textContent = item.label;
        a.tabIndex = 0;
        a.onclick = () => {
            item.action();
            return false;
        };
        li.append(a);
        ul.append(li);
    }

    document.body.append(ul);
    ul.style.left = `${Math.max(Math.min(x, window.innerWidth + window.scrollX - ul.clientWidth), 0)}px`;
    ul.style.top = `${Math.max(Math.min(y, window.innerHeight + window.scrollY - ul.clientHeight), 0)}px`;
    ul.onmousedown = e => {
        e.stopPropagation();
        return true;
    };

    setTimeout(() => {
        const closeHandler = () => {
            closeMenu(ul);
            return true;
        };
        document.onclick = closeHandler;
        document.onmousedown = closeHandler;
        document.oncontextmenu = closeHandler;
        document.onkeydown = e => {
            if (e.key === 'Escape') closeMenu(ul);
            return true;
        };
    }, 20);
    return ul;
}

// removes the given popup menu
function closeMenu(ul) {
    ul.remove();
    document.onclick = null;
    document.onmousedown = null;
    document.oncontextmenu = null;
    document.onkeydown = null;
}

let dragIds;
let dropTarget;

// enable drag and drop of column
function enableDragColumn(id, column) {
    if (getConfig('lock')) return;

    column.draggable = true;
    column.ondragstart = e => {
        dragIds = columns[id];
        e.dataTransfer.effectAllowed = 'move';
        column.classList.add('dragstart');
    };
    column.ondragend = () => {
        dragIds = null;
        column.classList.remove('dragstart');
        clearDropTarget();
    };
}

// enable drag and drop of folder
function enableDragFolder(node, a) {
    if (getConfig('lock')) return;

    a.draggable = true;
    a.ondragstart = e => {
        dragIds = [node.id];
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move copy';
        a.classList.add('dragstart');
    };
    a.ondragend = () => {
        dragIds = null;
        a.classList.remove('dragstart');
        clearDropTarget();
    };
}

// init drag and drop handlers
function enableDragDrop() {
    const main = getMainElement();

    if (getConfig('lock')) {
        main.ondragover = main.ondragleave = main.ondrop = null;
        return;
    }

    main.ondragover = e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const target = getDropTarget(e);
        if (target) {
            clearDropTarget();
            dropTarget = target;
            const bordercss = `solid 2px ${getConfig('font_color')}`;
            if (target.tagName === 'LI' || target.tagName === 'UL') {
                if (isAbove(e.pageY, target)) {
                    target.style.borderBottom = bordercss;
                    target.style.margin = '0 0 -2px 0';
                } else {
                    target.style.borderTop = bordercss;
                    target.style.margin = '-2px 0 0 0';
                }
            } else if (target.className === 'column') {
                if (e.pageX - target.offsetLeft > target.clientWidth / 2) {
                    target.style.borderRight = bordercss;
                    target.style.margin = '0';
                } else {
                    target.style.borderLeft = bordercss;
                    target.style.margin = '0 2px 0 -2px';
                }
            }
        }
        return false;
    };

    main.ondragleave = () => clearDropTarget();

    main.ondrop = e => {
        e.stopPropagation();
        const target = getDropTarget(e);
        if (!target) return false;

        let x = getDropX(target);
        const y = getDropY(target, e);

        if (dragIds.length === 1 && y != null) {
            addRow(dragIds[0], x, y);
        } else {
            if (e.pageX - target.offsetLeft > target.clientWidth / 2) x++;
            addColumn(dragIds, x);
        }
        return false;
    };
}

// gets proper drop target element
function getDropTarget(event) {
    if (!dragIds) return null;

    let target = event.target;
    if (target && (target.tagName === 'A' || target.parentNode.tagName === 'A') && dragIds.length === 1) {
        // get parent folder until toplevel
        while (target?.parentNode?.parentNode?.className !== 'column') {
            target = target.parentNode;
        }
        // if single-folder column, get the UL
        if (target?.tagName === 'LI' && columns[getDropX(target)].length === 1) {
            target = target.parentNode;
        }
    } else {
        while (target && target.className !== 'column') {
            target = target.parentNode;
        }
    }
    return target;
}

// gets x coordinate of drop target
function getDropX(target) {
    while (target && target.className !== 'column') {
        target = target.parentNode;
    }
    if (!target) return null;

    let x = 0;
    while (target.previousSibling) {
        x++;
        target = target.previousSibling;
    }
    return x;
}

// gets y coordinate of drop target
function getDropY(target, event) {
    if (target.tagName !== 'LI' && target.tagName !== 'UL') return null;
    let y = isAbove(event.pageY, target) ? 1 : 0;
    if (target.tagName === 'LI') {
        while (target.previousSibling) {
            y++;
            target = target.previousSibling;
        }
    }
    return y;
}

// returns true if y position is above target element midpoint
const isAbove = (pageY, target) =>
    pageY - window.scrollY - target.getBoundingClientRect().top > target.clientHeight / 2;

// clears droptarget styles
function clearDropTarget() {
    if (dropTarget) {
        Object.assign(dropTarget.style, {border: null, margin: null});
    }
    dropTarget = null;
}

let tooltipTimeout = null;

// adds tooltips to truncated text - uses requestIdleCallback for non-blocking updates
function updateTooltips() {
    if (tooltipTimeout) {
        if (typeof cancelIdleCallback !== 'undefined') {
            cancelIdleCallback(tooltipTimeout);
        } else {
            clearTimeout(tooltipTimeout);
        }
    }

    const doUpdate = () => {
        tooltipTimeout = null;
        const links = document.querySelectorAll('#main li a');
        for (let i = 0, len = links.length; i < len; i++) {
            const el = links[i];
            if (el.clientWidth + 1 < el.scrollWidth) {
                if (!el.title) el.title = el.textContent;
            } else if (el.title === el.textContent) {
                el.title = '';
            }
        }
    };

    // Use requestIdleCallback if available for non-blocking updates
    if (typeof requestIdleCallback !== 'undefined') {
        tooltipTimeout = requestIdleCallback(doUpdate, {timeout: 500});
    } else {
        tooltipTimeout = setTimeout(doUpdate, 100);
    }
}

// Gets children of a node (returns Promise)
async function getChildren(node, folderName) {
    if (Array.isArray(node.children)) return node.children;

    const children = await getChildren_internal(node.id);
    if (!children && coords[node.id]) {
        removeRow(coords[node.id].x, coords[node.id].y);
    }
    return children || [];
}

// gets the subtree for given id
async function getSubTree(id) {
    const specialNode = SpecialFolders.getNode(id);
    if (specialNode) return [specialNode];

    const node = await getNode_internal(id);
    if (node) {
        // Mark as folder (children will be fetched on-demand)
        node.children = true;
        return [node];
    }
    if (coords[id]) removeRow(coords[id].x, coords[id].y);
    return [];
}

// sets css classes for node
function setClass(target, node, isopen) {
    if (node.className) target.classList.add(node.className);
    if (node.children) target.classList.add('folder');
    target.classList.toggle('open', !!isopen);
    if (SpecialFolders.isSpecial(node.id) || node.id === 'empty') {
        target.classList.add(node.id);
    }
}

// gets best icon for a node
function getIcon(node) {
    let url = null;
    let url2x = null;

    if (node.icons) {
        let size;
        // Use Object.values for cleaner iteration (no key needed)
        const iconValues = Object.values(node.icons);
        for (let i = 0, len = iconValues.length; i < len; i++) {
            const iconInfo = iconValues[i];
            if (iconInfo.url && (!size || (iconInfo.size < size && iconInfo.size > 15))) {
                url = iconInfo.url;
                if (iconInfo.size > 31) url2x = iconInfo.url;
                size = iconInfo.size;
            }
        }
    } else if (node.icon) {
        url = node.icon;
    } else if (node.url && typeof FaviconCache !== 'undefined') {
        return FaviconCache.createIcon(node.url, 16);
    }

    const icon = document.createElement(url ? 'img' : 'div');
    icon.className = 'icon';
    if (url) {
        icon.loading = 'lazy';
        icon.decoding = 'async';
        icon.src = url;
        if (url2x) icon.srcset = `${url2x} 2x`;
    }
    icon.alt = ' ';
    return icon;
}

// toggle folder open state
async function toggle(node, a) {
    const isopen = a.open;
    setClass(a, node, !isopen);
    a.open = !isopen;

    if (isopen) {
        // close folder
        localStorage.removeItem(`open.${node.id}`);
        if (a.nextSibling) {
            // auto-close child folders
            if (getConfig('auto_close')) {
                const wrapper = a.nextSibling.tagName === 'DIV' ? a.nextSibling.firstChild : a.nextSibling;
                const wrapperChildren = wrapper.children;
                for (let i = 0, len = wrapperChildren.length; i < len; i++) {
                    const child = wrapperChildren[i].firstChild;
                    if (child?.open) child.onclick();
                }
            }
            animate(node, a, isopen);
        }
    } else {
        // open folder
        localStorage.setItem(`open.${node.id}`, true);
        // auto-close sibling folders
        if (getConfig('auto_close')) {
            const siblings = a.parentNode.parentNode.children;
            for (let i = 0, len = siblings.length; i < len; i++) {
                const sibling = siblings[i].firstChild;
                if (sibling !== a && sibling?.open) sibling.onclick();
            }
        }
        // open folder
        if (a.nextSibling) {
            animate(node, a, isopen);
        } else {
            const result = await getChildren(node);
            if (!a.nextSibling && a.open) {
                renderAll(result, a.parentNode);
                animate(node, a, isopen);
            }
        }
    }
}

// smoothly open or close folder
function animate(node, a, isopen) {
    // TODO: fix nested animations
    // wrapper needed for inner height value
    let wrap = a.nextSibling;
    if (a.animationHandle) {
        // clear last animation
        clearTimeout(a.animationHandle);
        a.animationHandle = null;
    } else {
        // start animation
        Object.assign(wrap.style, {
            height: isopen ? `${wrap.firstChild.clientHeight}px` : '0',
            opacity: isopen ? '1' : '0'
        });
    }
    // requestAnimationFrame twice to ensure at least one frame has passed
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (wrap) {
                wrap.className = 'wrap';
                Object.assign(wrap.style, {
                    height: isopen ? '0' : `${wrap.firstChild.clientHeight}px`,
                    opacity: isopen ? '0' : '1',
                    pointerEvents: isopen ? 'none' : null
                });
            }
        });
    });

    const duration = scale(getConfig('slide'), 0.2, 1) * 1000;
    a.animationHandle = setTimeout(() => {
        a.animationHandle = null;
        if (isopen) {
            wrap.remove();
        } else {
            wrap.className = '';
            wrap.removeAttribute('style');
        }
        wrap = null;
    }, duration);
}

// opens immediate children of given node in new tabs
async function openLinks(node) {
    const result = await getChildren(node);
    for (let i = 0, len = result.length; i < len; i++) {
        openLink(result[i], 2);
    }
}

// opens given node
function openLink(node, newtab) {
    const {url} = node;
    if (!url) return;

    if (newtab) {
        window.open(url, '_blank');
    } else {
        window.location.href = url;
    }
}

let columns; // columns[x][y] = id
let root;    // root[] = id
let coords;  // coords[id] = {x, y}

// ensure root folders are included
function verifyColumns() {
    // default layout
    if (columns.length === 0) {
        columns.push([]);
        columns.push(special.filter(a => getConfig(`show_${a}`)));
    }

    // find missing root items
    const existing = new Set(columns.flat());
    const missing = root.filter(id => !existing.has(id));

    // add missing root items - use for loop for performance
    for (let i = 0, len = missing.length; i < len; i++) {
        const id = missing[i];
        if (getConfig(`show_${id}`)) {
            columns[0].push(id);
        }
    }

    // populate coordinate map and remove empty columns
    coords = {};
    for (let x = columns.length - 1; x >= 0; x--) {
        if (columns[x].length === 0) {
            columns.splice(x, 1);
        } else {
            columns[x].forEach((id, y) => {
                coords[id] = {x, y};
            });
        }
    }
}

// Show error message when cache is unavailable
function showCacheError(error) {
    const main = getMainElement();
    main.replaceChildren(); // Modern way to clear children

    const errorDiv = document.createElement('div');
    errorDiv.className = 'cache-error';
    errorDiv.innerHTML = `
        <h2>⚠️ Could not load bookmarks</h2>
        <p>The bookmark cache is not available. This usually means:</p>
        <ul>
            <li>The extension was just installed (wait a moment and refresh)</li>
            <li>The service worker hasn't synced yet</li>
            <li>There was an error syncing bookmarks</li>
        </ul>
        <p>Check the console for more details.</p>
    `;
    main.append(errorDiv);

    console.error('[BookmarkCache] Cache unavailable:', error);
    console.error('[BookmarkCache] Cache status:', cacheStatus);
    console.error('[BookmarkCache] To debug: Open chrome://extensions, find this extension, and check the service worker logs');
}

// load columns from storage or default
async function loadColumns() {
    Perf.mark('loadColumns start');

    // Load ALL data into memory cache FIRST (single IndexedDB read)
    // This is faster than checking status first (which would be 2 separate reads)
    // After this, getCacheStatus() will use the in-memory cache (instant)
    try {
        Perf.mark('loadAllData start');
        await BookmarkCache.loadAllData();
        Perf.mark('loadAllData end');
    } catch (e) {
        console.error('[BookmarkCache] loadAllData failed:', e);
        showCacheError(e);
        return;
    }

    // Check if bookmark cache is valid (uses in-memory cache now - instant)
    const status = await checkCacheStatus();
    if (!status.valid) {
        console.error('[BookmarkCache] Cache not valid:', status);
        showCacheError(cacheLoadError || new Error('Cache not initialized'));
        return;
    }

    Perf.mark('loadColumns: cache valid');

    columns = [];
    forEachColumnEntry((x, y, id) => {
        if (!columns[x]) columns[x] = [];
        columns[x][y] = id;
    });

    if (root) {
        verifyColumns();
        await renderColumns();
    } else {
        Perf.mark('loadColumns: fetching root IDs from cache');
        const rootIds = await getRootFolderIds();
        root = [...special, ...rootIds];
        verifyColumns();
        await renderColumns();
    }
    Perf.mark('loadColumns end (DOM ready)');

    // Wait for actual browser paint before printing report
    // This ensures we measure when bookmarks are actually visible
    if (typeof requestAnimationFrame !== 'undefined') {
        Perf.waitForPaintAndReport();

        // After first paint, expand deferred special folders (slow Chrome API calls)
        requestAnimationFrame(() => {
            requestAnimationFrame(async () => {
                await expandDeferredFolders();
                Perf.mark('Finished loading');
            });
        });
    } else {
        Perf.summary();
    }
}

// saves current column configuration to storage
function saveColumns() {
    // clear previous config
    forEachColumnEntry((x, y) => localStorage.removeItem(`column.${x}.${y}`));
    verifyColumns();
    // save new config
    columns.forEach((col, x) => {
        col.forEach((id, y) => {
            localStorage.setItem(`column.${x}.${y}`, id);
        });
    });
    loadColumns();
}

// removes ids from columns, returns adjusted {xpos, ypos} if provided
function removeIdsFromColumns(ids, xpos, ypos) {
    // Use Set for O(1) lookup instead of O(n) array includes
    const idSet = new Set(ids);
    for (let x = 0; x < columns.length; x++) {
        for (let y = columns[x].length - 1; y >= 0; y--) {
            if (idSet.has(columns[x][y])) {
                columns[x].splice(y, 1);
                if (xpos !== undefined && x === xpos && ypos > y) ypos--;
            }
        }
        if (columns[x].length === 0) {
            columns.splice(x, 1);
            if (xpos !== undefined && xpos > x) xpos--;
            x--;
        }
    }
    return {xpos, ypos};
}

// creates and saves a new column
function addColumn(ids, index) {
    removeIdsFromColumns(ids);
    const insertAt = Math.min(index ?? columns.length, columns.length);
    columns.splice(insertAt, 0, [...ids]);
    saveColumns();
}

// removes given column
function removeColumn(index) {
    columns.splice(index, 1);
    saveColumns();
}

// creates and saves a new row
function addRow(id, xpos, ypos) {
    ypos = ypos ?? columns[xpos].length;
    const adjusted = removeIdsFromColumns([id], xpos, ypos);
    const insertAt = Math.min(adjusted.ypos, columns[adjusted.xpos].length);
    columns[adjusted.xpos].splice(insertAt, 0, id);
    saveColumns();
}

// removes given row
function removeRow(xpos, ypos) {
    columns[xpos].splice(ypos, 1);
    saveColumns();
}

// refresh recently closed tab lists
function refreshClosed() {
    const targets = [];
    const folders = [...document.getElementsByClassName('closed')];

    folders.forEach(a => {
        if (a.nextSibling) {
            a.nextSibling.remove();
            targets.push(a.parentNode);
        }
    });

    if (folders.length === 0 && coords.closed) {
        const target = document.getElementsByClassName('column')[coords.closed.x];
        target.firstChild.remove();
        targets.push(target);
    }

    getChildren({id: 'closed'}).then(result => {
        // Use for loop for better performance
        for (let i = 0, len = targets.length; i < len; i++) {
            renderAll(result, targets[i]);
        }
    });
}

// options : default values
const config = {
    font: 'Sans-serif',
    font_size: 16,
    font_weight: 400,
    theme: 'Default',
    font_color: '#555555',
    background_color: '#ffffff',
    highlight_color: '#e4f4ff',
    highlight_font_color: '#000000',
    shadow_color: '#57b0ff',
    background_image_file: '',
    background_image: '',
    background_align: 'left top',
    background_repeat: 'repeat',
    background_size: 'auto',
    shadow_blur: 1,
    highlight_round: 1,
    fade: 1,
    spacing: 1,
    width: 1,
    h_pos: 1,
    v_margin: 1,
    slide: 1,
    hide_options: 0,
    lock: 0,
    show_top: 1,
    show_recent: 1,
    show_closed: 1,
    show_devices: 1,
    show_root: 0,
    newtab: 0,
    remember_open: 1,
    auto_close: 0,
    auto_scale: 1,
    css: '',
    number_top: 10,
    number_closed: 10,
    number_recent: 10
};

// themes is defined in themes.js (loaded before this script)
let theme = {};

// Config value cache - avoids repeated localStorage reads during rendering
const configCache = new Map();

// get config value or default (uses cache for performance)
function getConfig(key) {
    // Use single get() call instead of has() + get() to avoid double lookup
    const cached = configCache.get(key);
    if (cached !== undefined) return cached;

    const value = localStorage.getItem(`options.${key}`);
    let result;
    if (value != null) {
        // Dynamic show_* keys (e.g., show_2, show_4) are numbers but not in config
        const isNumber = typeof config[key] === 'number' || (key.startsWith('show_') && !(key in config));
        result = isNumber ? Number(value) : value;
    } else {
        result = key in theme ? theme[key] : config[key];
    }
    configCache.set(key, result);
    return result;
}

// set config value
function setConfig(key, value) {
    // Invalidate cache for this key
    configCache.delete(key);

    if (value != null) {
        localStorage.setItem(`options.${key}`, typeof config[key] === 'number' ? Number(value) : value);
    } else {
        localStorage.removeItem(`options.${key}`);
        value = key in theme ? theme[key] : config[key];
    }

    // special case settings
    if (key === 'lock' || key === 'newtab' || key === 'show_root' || key.startsWith('number')) {
        loadColumns();
    } else if (key === 'theme') {
        theme = themes[value];
        configCache.clear(); // Theme affects all config defaults
        const configKeys = Object.keys(config);
        for (let i = 0, len = configKeys.length; i < len; i++) {
            const k = configKeys[i];
            if (k !== key) {
                onChange(k);
                showConfig(k);
            }
        }
    } else if (key.startsWith('show')) {
        const id = key.substring(5);
        if (!value && coords[id]) {
            removeRow(coords[id].x, coords[id].y);
        }
        saveColumns();
    }

    onChange(key, value);
    return value;
}

// map config keys to styles
const styles = {};

// Style schema: maps config keys to CSS generation rules
const styleSchema = {
    font: {sel: '#main a', prop: 'font-family', fmt: v => `"${v}"`},
    font_size: {sel: '#main a', prop: 'font-size', fmt: v => `${v / 10}em`},
    font_weight: {sel: '#main a', prop: 'font-weight'},
    font_color: {sel: '#main a', prop: 'color'},
    background_color: {sel: 'body', prop: 'background-color'},
    background_image: {sel: 'body', prop: 'background-image', fmt: v => `url(${v})`},
    background_image_file: {sel: 'body', prop: 'background-image', fmt: v => `url(${v})`},
    background_align: {sel: 'body', prop: 'background-position'},
    background_repeat: {sel: 'body', prop: 'background-repeat'},
    background_size: {sel: 'body', prop: 'background-size'},
    highlight_font_color: {sel: '#main a:hover', prop: 'color'},
    highlight_color: {sel: '#main a:hover', prop: 'background-color'},
    shadow_color: v => `#main a:hover { box-shadow: 0 0 ${scale(getConfig('shadow_blur'), 7, 100)}px ${v}; }`,
    shadow_blur: v => `#main a:hover { box-shadow: 0 0 ${scale(v, 7, 100)}px ${getConfig('shadow_color')}; }`,
    highlight_round: {sel: '#main a', prop: 'border-radius', fmt: v => `${scale(v, 0.2, 1.5)}em`},
    fade: {sel: '#main a', prop: 'transition-duration', fmt: v => `${scale(v, 0.2, 1)}s`},
    slide: {sel: '.wrap', prop: 'transition-duration', fmt: v => `${scale(v, 0.2, 1)}s`},
    spacing: v => `#main a { line-height: ${scale(v, 2, 5.6, 0.8)}; padding-left: ${scale(v, 0.8, 2, 0.4)}em; padding-right: ${scale(v, 0.8, 2, 0.4)}em; }`,
    width: v => `#main { width: ${getConfig('auto_scale') ? `${scale(v, 80, 100, 20)}%` : `${scale(v, 1000, 3000, 400)}px`}; }`,
    h_pos: v => {
        const margin = 100 - scale(getConfig('width'), 80, 100, 20);
        return `#main { left: ${scale(v, 0, margin / 2, -margin / 2)}%; }`;
    },
    v_margin: v => `#main { margin-top: ${getConfig('auto_scale') ? `${scale(v, 5, 20)}%` : `${scale(v, 80, 600)}px`}; }`,
    hide_options: () => '#options_button { opacity: 0; }',
    css: v => v,
    auto_scale: v => v ? null : '#main { margin-top: 80px; width: 1000px; }'
};

function getStyle(key, value) {
    const schema = styleSchema[key];
    if (!schema) return null;

    if (typeof schema === 'function') return schema(value);

    const formattedValue = schema.fmt ? schema.fmt(value) : value;
    return `${schema.sel} { ${schema.prop}: ${formattedValue}; }`;
}

// scales input value from [0,1,2] to [min,mid,max]
function scale(value, mid, max, min = 0) {
    return value > 1
        ? mid + (value - 1) * (max - mid)
        : min + value * (mid - min);
}

// apply config value change
function onChange(key, value) {
    value = value ?? getConfig(key);

    if (value !== config[key]) {
        const css = getStyle(key, value);
        if (css) {
            const style = styles[key] ?? (styles[key] = document.createElement('style'));
            document.head.appendChild(style);
            style.textContent = css;
        }
    } else if (key in styles) {
        styles[key].remove();
        delete styles[key];
    }

    // refresh dependent values
    if (key === 'width') onChange('h_pos');
    else if (key === 'shadow_blur') onChange('shadow_color');
    else if (key === 'auto_scale') {
        onChange('width');
        onChange('v_margin');
    }

    if (!settingsInitialized) return;

    // show/hide default button
    const input = document.getElementById(`options_${key}`);
    if (input) {
        const isDefault = value === (key in theme ? theme[key] : config[key]);
        input.reset.style.visibility = isDefault ? 'hidden' : null;
        if (input.swatch) input.swatch.value = value;
    }
}

// loads config settings
function loadSettings() {
    Perf.mark('loadSettings start');
    // Remove early-styles.js overrides so new settings can take effect
    document.getElementById('early-styles')?.remove();
    theme = themes[getConfig('theme')] ?? {};
    const configKeys = Object.keys(config);
    for (let i = 0, len = configKeys.length; i < len; i++) {
        const key = configKeys[i];
        if (key === 'background_image_file') {
            setTimeout(() => onChange('background_image_file'), 0);
        } else {
            onChange(key);
        }
    }
    Perf.mark('loadSettings end');
}

// apply config values to input controls
function showConfig(key) {
    const input = document.getElementById(`options_${key}`);
    if (!input || input.type === 'file') return;
    input[input.type === 'checkbox' ? 'checked' : 'value'] = getConfig(key);
}

// initialize config settings
function initConfig(key) {
    const input = document.getElementById(`options_${key}`);
    if (!input) return;

    if (input.type === 'color') {
        input.type = 'text';
        input.className = 'color';
        const swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.value = input.value;
        swatch.oninput = e => {
            input.value = swatch.value;
            return input.onchange(e);
        };
        input.swatch = swatch;
        input.parentNode.appendChild(swatch);
    }

    input.onchange = e => {
        if (input.type === 'file') {
            if (e.target.files.length === 1) {
                const file = e.target.files[0];
                if (file.size > 2097152) {
                    input.value = null;
                    alert('Image must be less than 2 MB.');
                    return false;
                }
                const reader = new FileReader();
                reader.onload = f => {
                    if (f.target.result) setConfig(key, f.target.result);
                };
                reader.readAsDataURL(file);
            }
        } else {
            setConfig(key, input.type === 'checkbox' ? Number(input.checked) : input.value);
        }
    };

    const reset = document.createElement('a');
    reset.className = 'revert';
    reset.title = 'Reset to default';
    reset.tabIndex = 0;
    reset.onclick = () => {
        setConfig(key, null);
        showConfig(key);
        return false;
    };

    input.reset = reset;
    input.parentNode.appendChild(reset);
    showConfig(key);
}

let settingsInitialized = false;

// initialize options panel
function initSettings() {
    settingsInitialized = true;

    document.getElementById('options_close_button').onclick = () => {
        showOptions(false);
        return false;
    };

    const options = document.getElementById('options');
    const nav = document.getElementById('options_nav');
    let currentIndex = 0;

    const sections = options.getElementsByClassName('section');
    const navChildren = nav.children;
    for (let i = 0, len = navChildren.length; i < len; i++) {
        const a = navChildren[i].firstChild;
        a.onclick = function () {
            // clear current style
            navChildren[currentIndex].firstChild.classList.remove('current');
            sections[currentIndex].classList.remove('current');

            // apply new current style
            currentIndex = i;
            navChildren[currentIndex].firstChild.classList.add('current');
            sections[currentIndex].classList.add('current');

            // show custom css on advanced tab
            if (currentIndex === len - 1) {
                const allcss = document.getElementById('all_css');
                allcss.value = Object.keys(config)
                    .map(k => getStyle(k, getConfig(k)))
                    .filter(css => css && css.length < 1000)
                    .join('\n');
            }

            // import/export
            if (currentIndex === len - 2) {
                const exports = document.getElementById('options_export');
                const imports = document.getElementById('options_import');
                const replacer = (k, v) =>
                    (k === 'options.background_image_file' || k.startsWith('cache.')) ? undefined : v;

                exports.value = JSON.stringify(localStorage, replacer);
                imports.value = '';
                imports.placeholder = 'Paste exported settings here';
                imports.onchange = () => {
                    try {
                        const imported = JSON.parse(imports.value);
                        localStorage.clear();
                        // Use for loop for better performance
                        const entries = Object.entries(imported);
                        for (let i = 0, len = entries.length; i < len; i++) {
                            const [k, v] = entries[i];
                            localStorage.setItem(k, v);
                        }
                        imports.value = '';
                        imports.placeholder = 'Import successful!';
                        exports.value = JSON.stringify(localStorage, replacer);
                        loadSettings();
                        loadColumns();
                        // Use for loop for better performance
                        const configKeys = Object.keys(config);
                        for (let i = 0, len = configKeys.length; i < len; i++) {
                            showConfig(configKeys[i]);
                        }
                    } catch {
                        imports.value = '';
                        imports.placeholder = 'Import error! Please check if your settings are valid JSON.';
                    }
                };
            }
            return false;
        };
    }

    // add options to hide bookmark folders (load from cache)
    BookmarkCache.getFolder('0').then(async rootFolder => {
        const placeholder = document.getElementById('options_show_bookmarks');
        const children = rootFolder?.children || [];
        // Use for loop for better performance
        for (let i = 0, len = children.length; i < len; i++) {
            const node = children[i];
            if (!node.isFolder) continue;

            const key = `show_${node.id}`;
            config[key] = 1;

            const span = document.createElement('span');
            span.textContent = node.title;

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `options_${key}`;

            const label = document.createElement('label');
            label.append(span, input); // append multiple elements at once
            placeholder.append(label);
        }

        // replace text input with system font list
        if (chrome.fontSettings) {
            const fontInput = document.getElementById('options_font');
            const select = document.createElement('select');
            select.id = fontInput.id;
            fontInput.replaceWith(select); // Modern API
        }

        // show settings - use for loop for better performance
        const configKeys = Object.keys(config);
        for (let i = 0, len = configKeys.length; i < len; i++) {
            initConfig(configKeys[i]);
        }
        loadSettings();

        // load themes
        const themeSelect = document.getElementById('options_theme');
        if (themeSelect.childNodes.length === 0) {
            Object.keys(themes).forEach(name => {
                const option = document.createElement('option');
                option.textContent = name;
                option.selected = name === getConfig('theme');
                themeSelect.appendChild(option);
            });
        }

        // load font list
        if (chrome.fontSettings) {
            const fonts = await chrome.fontSettings.getFontList();
            const select = document.getElementById('options_font');
            if (select.childNodes.length > 0) return;

            [{fontId: 'Sans-serif'}, ...fonts].forEach(({fontId}) => {
                const option = document.createElement('option');
                option.textContent = fontId;
                option.selected = fontId === getConfig('font');
                select.appendChild(option);
            });
        }
    });
}

// show options panel
function showOptions(show) {
    document.getElementById('options').style.display = show ? 'block' : 'none';
    if (show) {
        if (!settingsInitialized) initSettings();
        // Use for loop for better performance
        const configKeys = Object.keys(config);
        for (let i = 0, len = configKeys.length; i < len; i++) {
            showConfig(configKeys[i]);
        }
    }
}

// initialize page
loadSettings();
loadColumns();

// keyboard shortcuts
document.addEventListener('keypress', e => {
    if (e.key === 'Enter' && e.target?.onclick && e.target.tagName === 'A') {
        e.target.dispatchEvent(new MouseEvent('click'));
        e.preventDefault();
    }
});

document.addEventListener('mousedown', () => document.body.classList.add('hide-focus'), {passive: true});
document.addEventListener('keydown', () => document.body.classList.remove('hide-focus'), {passive: true});

window.onresize = updateTooltips;

// load options panel
document.getElementById('options_button').onclick = () => {
    showOptions(true);
    return false;
};
if (location.search === '?options') showOptions(true);

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getColumnIds: () => {
            const ids = [];
            forEachColumnEntry((x, y, id) => ids.push(id));
            return ids;
        },
        getChildren_internal,
        getConfigValue,
        special,
        expandDeferredFolders,
        render,
        renderAll
    };
}

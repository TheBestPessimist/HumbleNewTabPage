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
    apiCalls: { count: 0, totalTime: 0, calls: [] },
    firstPaintTime: null,
    reportPrinted: false,

    mark(label) {
        if (!this.enabled) return;
        const now = performance.now();
        const elapsed = now - this.startTime;
        this.marks.push({ label, time: now, elapsed });
        // Use Performance API for DevTools integration
        try { performance.mark(`perf-${label.replace(/\s+/g, '-')}`); } catch(e) {}
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
        this.apiCalls.calls.push({ api: apiName, duration });
        console.log(`[PERF:API] ${apiName}: ${duration.toFixed(2)}ms`);
        return result;
    },

    // Track any async operation
    async track(label, fn) {
        if (!this.enabled) return fn();
        const start = performance.now();
        const result = await fn();
        const duration = performance.now() - start;
        this.operations.push({ label, duration, timestamp: start - this.startTime });
        console.log(`[PERF:OP] ${label}: ${duration.toFixed(2)}ms`);
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
            scriptResources.forEach(r => {
                const name = r.name.split('/').pop();
                console.log(`  ${name}: start=${r.startTime.toFixed(1)}ms, duration=${r.duration.toFixed(1)}ms`);
            });
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

        // Slow operations (>5ms)
        const slowOps = this.operations.filter(o => o.duration > 5).sort((a,b) => b.duration - a.duration);
        if (slowOps.length > 0) {
            console.log('\n🐌 SLOW OPERATIONS (>5ms):');
            slowOps.forEach(o => {
                console.log(`  ${o.duration.toFixed(1).padStart(7)}ms | ${o.label}`);
            });
        }

        // Chrome API breakdown
        if (this.apiCalls.calls.length > 0) {
            console.log('\n🔌 CHROME API CALLS:');
            const sorted = [...this.apiCalls.calls].sort((a,b) => b.duration - a.duration);
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

        if (this.apiCalls.totalTime > 100) {
            console.log(`  ⚠️  Chrome APIs taking ${this.apiCalls.totalTime.toFixed(0)}ms - this is likely the bottleneck`);
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
    const nav = performance.getEntriesByType('navigation')[0];
    console.log(`[PERF] Page navigation started at: 0ms`);
    console.log(`[PERF] Script started at: ${Perf.startTime.toFixed(2)}ms after navigation`);
}

Perf.mark('Script start');

// =============================================================================
// SPECIAL FOLDERS - Unified handling for apps, top sites, recent, closed, devices
// =============================================================================

const SpecialFolders = {
	// Definition of all special folders with their properties
	defs: {
		apps:    { title: 'Apps',             isFolder: false, url: 'chrome://apps' },
		top:     { title: 'Most visited',     isFolder: true,  configKey: 'number_top' },
		recent:  { title: 'Recent bookmarks', isFolder: true,  configKey: 'number_recent' },
		closed:  { title: 'Recently closed',  isFolder: true,  configKey: 'number_closed' },
		devices: { title: 'Other devices',    isFolder: true,  configKey: 'number_closed' }
	},

	// All special IDs (for iteration)
	all: ['apps', 'top', 'recent', 'closed', 'devices'],

	// Check if an ID is a special folder (not apps, which is a link)
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
	async fetchChildren(id) {
		const def = this.defs[id];
		if (!def?.isFolder) return [];

		switch (id) {
			case 'top':
				if (!chrome.topSites) return [];
				return Perf.trackApi('chrome.topSites.get', () =>
					chrome.topSites.get().then(r => (r || []).slice(0, getConfigValue('number_top', 10))));
			case 'recent':
				return Perf.trackApi('chrome.bookmarks.getRecent', () =>
					chrome.bookmarks.getRecent(getConfigValue('number_recent', 10)).then(r => r || []));
			case 'closed':
				return Perf.trackApi('chrome.sessions.getRecentlyClosed', () => getClosed());
			case 'devices':
				return Perf.trackApi('chrome.sessions.getDevices', () => getDevices());
			default:
				return [];
		}
	}
};

// Convenience references
const special = SpecialFolders.all;
const specialFolderIds = special.filter(id => SpecialFolders.isFolder(id));

// =============================================================================
// BOOKMARK LOADING - Prefetch only visible bookmarks in parallel
// =============================================================================

// Promise wrappers for Chrome bookmark APIs (with performance tracking)
// Chrome Manifest V3 APIs return promises natively when no callback is provided
const getBookmarkNodes = ids =>
	(!ids || ids.length === 0) ? Promise.resolve([]) :
	Perf.trackApi(`chrome.bookmarks.get(${ids.length} ids)`, () =>
		chrome.bookmarks.get(ids).then(r => r || []));

const getBookmarkChildren = id =>
	Perf.trackApi(`chrome.bookmarks.getChildren(${id})`, () =>
		chrome.bookmarks.getChildren(id).then(r => r || []));

// FAST: Get only root folder IDs (Bookmarks Bar, Other Bookmarks, Mobile Bookmarks)
// Uses getChildren("0") which is much faster than getTree()
const getRootFolderIds = () =>
	Perf.trackApi('chrome.bookmarks.getChildren(0) [root]', () =>
		chrome.bookmarks.getChildren("0").then(r => (r || []).map(n => n.id)));

// SLOW - avoid using this! Fetches entire bookmark tree
const getBookmarkTree = () =>
	Perf.trackApi('chrome.bookmarks.getTree [SLOW!]', () =>
		chrome.bookmarks.getTree().then(r => r || []));

// Cache for prefetched bookmark data
const prefetchedData = {
	nodes: {},      // id -> node data
	children: {}    // id -> array of child nodes
};

// Mark folders (nodes without url) as having children
function markFolders(children) {
	children.forEach(child => {
		if (!child.url) child.children = true;
	});
	return children;
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

// Get cached children or fetch if not available (works for both regular and special folders)
async function getCachedChildren(id) {
	// Use cache if available
	if (id in prefetchedData.children) {
		const result = prefetchedData.children[id];
		// Special folders: consume cache (delete after use) so next open fetches fresh
		if (SpecialFolders.isFolder(id)) {
			delete prefetchedData.children[id];
		}
		return result;
	}

	// Fetch based on folder type (cache miss)
	if (SpecialFolders.isFolder(id)) {
		return SpecialFolders.fetchChildren(id);
	}
	const children = await getBookmarkChildren(id);
	markFolders(children);
	prefetchedData.children[id] = children;
	return children;
}

// Get cached node or fetch if not available
async function getCachedNode(id) {
	if (id in prefetchedData.nodes) {
		return [prefetchedData.nodes[id]];
	}
	const nodes = await getBookmarkNodes([id]);
	if (nodes?.[0]) {
		prefetchedData.nodes[id] = nodes[0];
	}
	return nodes;
}

// Prefetch ONLY the immediate children of a folder (no recursion for initial load)
async function prefetchFolderChildren(id) {
	// Skip if already cached
	if (id in prefetchedData.children) return;

	const children = await getBookmarkChildren(id);
	markFolders(children);
	prefetchedData.children[id] = children;
	// NOTE: No recursive prefetching - open subfolders load on-demand during render
}

// Prefetch special folder data if it's marked as open
async function prefetchSpecialFolder(id) {
	if (!localStorage.getItem(`open.${id}`)) return;
	prefetchedData.children[id] = await SpecialFolders.fetchChildren(id);
}

// Helper to get config value (works before full config is loaded)
function getConfigValue(key, defaultValue) {
	const value = localStorage.getItem(`options.${key}`);
	return value !== null ? Number(value) : defaultValue;
}

// Prefetch ONLY folder metadata (not children) - this is fast
async function prefetchFolderMetadata() {
	Perf.mark('prefetchFolderMetadata start');
	const columnIds = columns?.flat() || [];
	const bookmarkIds = columnIds.filter(id => !special.includes(id));

	if (bookmarkIds.length > 0) {
		const nodes = await getBookmarkNodes(bookmarkIds);
		nodes.forEach(node => {
			if (node) prefetchedData.nodes[node.id] = node;
		});
	}
	Perf.mark('prefetchFolderMetadata end');
}

// Load children for all visible folders AFTER first paint (progressive loading)
async function loadChildrenProgressively() {
	Perf.mark('loadChildrenProgressively start');
	const columnIds = columns?.flat() || [];
	const bookmarkIds = columnIds.filter(id => !special.includes(id));
	const visibleSpecialFolders = columnIds.filter(id => specialFolderIds.includes(id));

	// Collect IDs of deferred open folders (these need their children prefetched too)
	const deferredFolderIds = [...document.querySelectorAll('#main a.folder[data-deferred="true"]')]
		.map(a => a.parentNode?.dataset?.nodeId)
		.filter(id => id && !special.includes(id) && !specialFolderIds.includes(id));

	// Combine all IDs that need prefetching (deduplicated)
	const allIds = [...new Set([...bookmarkIds, ...deferredFolderIds])];

	// Load in small batches to avoid API congestion (Chrome API bottleneck)
	const BATCH_SIZE = 3;

	for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
		const batch = allIds.slice(i, i + BATCH_SIZE);
		await Promise.all(batch.map(id => prefetchFolderChildren(id)));
	}

	// Also load special folders that are open
	await Promise.all(visibleSpecialFolders.map(id => prefetchSpecialFolder(id)));

	Perf.mark('loadChildrenProgressively end');
}

// render a single bookmark node
function render(node, target) {
    if (node.description === 'separator') return;

    const li = document.createElement('li');
    const a = document.createElement('a');
    const { url } = node;

    if (url) {
        a.href = url;
    } else {
        a.tabIndex = 0;
    }

    let text = node.title || node.name || '';
    if (!text && node.title === null) text = node.url || '';
    a.innerText = text;

    if (node.tooltip) a.title = node.tooltip;
    setClass(a, node);
    a.insertBefore(getIcon(node), a.firstChild);

    if (node.action) {
        a.onclick = e => node.action(e);
    } else if (url) {
        const newtab = getConfig('newtab');
        if (newtab === 1) {
            a.target = '_blank';
        } else if (newtab === 2) {
            a.onclick = () => { openLink(node, newtab); return false; };
        }
        // Handle chrome:// and file:/// urls that need special opening
        if (url.startsWith('chrome') || url.startsWith('file:/')) {
            a.onclick = e => { openLink(node, newtab || (e.ctrlKey ? 2 : 0)); return false; };
            a.onauxclick = e => { if (e.button === 1) { openLink(node, 2); return false; } };
        }
    } else if (!node.children) {
        a.style.pointerEvents = 'none';
    }

    li.appendChild(a);

    // folder
    if (node.children) {
        // Store node ID for deferred loading (dataset may not exist in test env)
        if (li.dataset) li.dataset.nodeId = node.id;

        // Check if this folder should auto-expand (show_root=false case)
        if (node.autoExpand && a.dataset) {
            a.dataset.autoExpand = 'true';
        }

        // Check if folder should be open
        const shouldBeOpen = a.open || (getConfig('remember_open') && localStorage.getItem(`open.${node.id}`));
        if (shouldBeOpen) {
            setClass(a, node, true);
            a.open = true;
            // If children are already loaded as an array, render them immediately
            // (e.g., device subfolders from "Other devices" have inline children)
            if (Array.isArray(node.children)) {
                renderAll(node.children, li);
            } else if (a.dataset) {
                // Defer loading for folders that need to fetch children
                a.dataset.deferred = 'true';
            }
        }
        addFolderHandlers(node, a);
        enableDragFolder(node, a);
    } else if (node.id === 'apps') {
        enableDragFolder(node, a);
    }

    target.appendChild(li);
    return li;
}

// render an array of bookmark nodes
function renderAll(nodes, target, toplevel) {
    const ul = document.createElement('ul');
    nodes.forEach(node => {
        // skip extensions and duplicated child folders
        if (toplevel || !coords[node.id]) render(node, ul);
    });
    if (ul.childNodes.length === 0) {
        render({ id: 'empty', title: '< Empty >' }, ul);
    }
    if (toplevel) {
        target.appendChild(ul);
    } else {
        // wrap child ul for animation
        const wrap = document.createElement('div');
        wrap.appendChild(ul);
        target.appendChild(wrap);
    }
    updateTooltips();
    return ul;
}

// render column with given index
async function renderColumn(index, target) {
    return Perf.track(`renderColumn(${index})`, async () => {
        const ids = columns[index];
        if (ids.length === 1 && !getConfig('show_root')) {
            // Check if children are already cached (fast path)
            if (ids[0] in prefetchedData.children) {
                const result = await getChildren({ id: ids[0] });
                renderAll(result, target);
            } else {
                // Children not loaded yet - render folder as expandable, mark for deferred load
                const results = await Promise.all(ids.map(id => getSubTree(id)));
                const nodes = results.flat();
                // Mark these folders for auto-expansion after children load
                nodes.forEach(n => { if (n.children) n.autoExpand = true; });
                renderAll(nodes, target, true);
            }
            addColumnHandlers(index, target);
        } else if (ids.length > 0) {
            const results = await Promise.all(ids.map(id => getSubTree(id)));
            const nodes = results.flat();
            renderAll(nodes, target, true);
            addColumnHandlers(index, target);
        }
    });
}

// render all columns to main div
async function renderColumns() {
    Perf.mark('renderColumns start');
    const target = document.getElementById('main');
    target.replaceChildren(); // Modern way to clear children

    // Create all column containers first (fast, synchronous)
    const columnElements = columns.map((_, i) => {
        const column = document.createElement('div');
        column.className = 'column';
        column.style.width = `${(1 / columns.length) * 100}%`;
        enableDragColumn(i, column);
        target.appendChild(column);
        return column;
    });

    // Render all columns in parallel and wait for completion
    await Promise.all(columnElements.map((column, i) => renderColumn(i, column)));

    enableDragDrop();
    Perf.mark('renderColumns end (all columns rendered)');
}

// Expand folders that were deferred during initial render (runs after first paint)
async function expandDeferredFolders() {
    // Handle auto-expand folders (show_root=false case where we rendered folder header temporarily)
    const autoExpandLinks = [...document.querySelectorAll('#main a.folder[data-auto-expand="true"]')];
    if (autoExpandLinks.length > 0) {
        Perf.mark(`Auto-expanding ${autoExpandLinks.length} folders`);
        await Promise.all(autoExpandLinks.map(async (a) => {
            const li = a.parentNode;
            const nodeId = li?.dataset?.nodeId;
            if (!nodeId) return;

            delete a.dataset.autoExpand;
            const children = await getChildren({ id: nodeId, children: true });
            // Replace the folder header with its children directly in the column
            const column = li.closest('.column');
            const ul = li.parentNode;
            if (column && ul) {
                // Remove the folder header li
                li.remove();
                // Add children to the ul
                children.forEach(child => {
                    if (!coords[child.id]) render(child, ul);
                });
                if (ul.childNodes.length === 0) {
                    render({ id: 'empty', title: '< Empty >' }, ul);
                }
                updateTooltips();
            }
        }));
    }

    // Handle deferred open folders (folders that were open but children weren't rendered yet)
    // Loop until no more deferred folders exist (rendering children may create new deferred folders)
    let totalDeferred = 0;
    let deferredLinks;
    while ((deferredLinks = [...document.querySelectorAll('#main a.folder[data-deferred="true"]')]).length > 0) {
        totalDeferred += deferredLinks.length;

        // Expand all deferred folders in parallel
        await Promise.all(deferredLinks.map(async (a) => {
            const li = a.parentNode;
            const nodeId = li?.dataset?.nodeId;

            if (!nodeId || !a.open || a.nextSibling) return;

            delete a.dataset.deferred;
            const children = await getChildren({ id: nodeId, children: true });
            if (!a.nextSibling && a.open) {
                renderAll(children, li);
            }
        }));
    }

    if (totalDeferred > 0) {
        Perf.mark(`Expanded ${totalDeferred} deferred folders`);
    }
}

// enables click and context menu for given folder
function addFolderHandlers(node, a) {
    // click handler
    a.onclick = () => { toggle(node, a); return false; };

    // context menu handler
    const items = getMenuItems(node);

    // column layout items
    if (!getConfig('lock')) {
        items.push(null); // spacer
        items.push({ label: 'Create new column', action: () => addColumn([node.id]) });

        const pos = coords[node.id];
        if (pos && columns[pos.x]) {
            if (pos.y > 0)
                items.push({ label: 'Move folder up', action: () => addRow(node.id, pos.x, pos.y - 1) });
            if (pos.y < columns[pos.x].length - 1)
                items.push({ label: 'Move folder down', action: () => addRow(node.id, pos.x, pos.y + 2) });
            if (pos.x > 0)
                items.push({ label: 'Move folder left', action: () => addRow(node.id, pos.x - 1) });
            if (pos.x < columns.length - 1)
                items.push({ label: 'Move folder right', action: () => addRow(node.id, pos.x + 1) });
            if (!root.includes(node.id))
                items.push({ label: 'Remove folder', action: () => removeRow(pos.x, pos.y) });
        }
    }

    a.oncontextmenu = e => { renderMenu(items, e.pageX, e.pageY); return false; };
}

// enables context menu for given column
function addColumnHandlers(index, ul) {
    const ids = columns[index];
    let items = ids.length === 1 ? getMenuItems({ id: ids[0] }) : [];

    // column layout items
    if (!getConfig('lock') && columns.length > 1) {
        items.push(null); // spacer
        if (index > 0)
            items.push({ label: 'Move column left', action: () => addColumn(ids, index - 1) });
        if (index < columns.length - 1)
            items.push({ label: 'Move column right', action: () => addColumn(ids, index + 2) });
        items.push({ label: 'Remove column', action: () => removeColumn(index) });
        if (ids.length === 1) {
            if (index > 0)
                items.push({ label: 'Move folder left', action: () => addRow(ids[0], index - 1) });
            if (index < columns.length - 1)
                items.push({ label: 'Move folder right', action: () => addRow(ids[0], index + 1) });
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
    const items = [{ label: 'Open all links in folder', action: () => openLinks(node) }];
    if (node.id === 'closed')
        items.push({ label: 'Clear browsing data', action: () => openLink({ url: 'chrome://settings/clearBrowserData' }, 1) });
    if (node.id === 'devices')
        items.push({ label: 'History', action: () => openLink({ url: 'chrome://history' }, 1) });
    if (Number(node.id))
        items.push({ label: 'Edit bookmarks', action: () => openLink({ url: `chrome://bookmarks/?id=${node.id}` }, 1) });
    return items;
}

// renders a popup menu at given coordinates
function renderMenu(items, x, y) {
    const ul = document.createElement('ul');
    ul.className = 'menu';

    items.forEach((item, i) => {
        if (!item) {
            // Spacer - only add if not at start or end
            if (i > 0 && i < items.length - 1) {
                const li = document.createElement('li');
                li.appendChild(document.createElement('hr'));
                ul.appendChild(li);
            }
            return;
        }
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.innerText = item.label;
        a.tabIndex = 0;
        a.onclick = () => { item.action(); return false; };
        li.appendChild(a);
        ul.appendChild(li);
    });

    document.body.appendChild(ul);
    ul.style.left = `${Math.max(Math.min(x, window.innerWidth + window.scrollX - ul.clientWidth), 0)}px`;
    ul.style.top = `${Math.max(Math.min(y, window.innerHeight + window.scrollY - ul.clientHeight), 0)}px`;
    ul.onmousedown = e => { e.stopPropagation(); return true; };

    setTimeout(() => {
        const closeHandler = () => { closeMenu(ul); return true; };
        document.onclick = closeHandler;
        document.onmousedown = closeHandler;
        document.oncontextmenu = closeHandler;
        document.onkeydown = e => { if (e.key === 'Escape') closeMenu(ul); return true; };
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
    const main = document.getElementById('main');

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
        dropTarget.style.border = null;
        dropTarget.style.margin = null;
    }
    dropTarget = null;
}

let tooltipTimeout = null;

// adds tooltips to truncated text
function updateTooltips() {
    if (tooltipTimeout) clearTimeout(tooltipTimeout);

    tooltipTimeout = setTimeout(() => {
        tooltipTimeout = null;
        document.querySelectorAll('#main li a').forEach(el => {
            if (el.clientWidth + 1 < el.scrollWidth) {
                el.title = el.title || el.textContent;
            } else if (el.title === el.textContent) {
                el.title = '';
            }
        });
    }, 100);
}

// Gets children of a node (returns Promise)
async function getChildren(node) {
    if (Array.isArray(node.children)) return node.children;

    const children = await getCachedChildren(node.id);
    if (!children && coords[node.id]) {
        removeRow(coords[node.id].x, coords[node.id].y);
    }
    return children || [];
}

// gets the subtree for given id
async function getSubTree(id) {
    const specialNode = SpecialFolders.getNode(id);
    if (specialNode) return [specialNode];

    const nodes = await getCachedNode(id);
    if (nodes?.[0]) {
        const node = nodes[0];
        node.children = id in prefetchedData.children ? prefetchedData.children[id] : true;
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
        for (const key in node.icons) {
            const iconInfo = node.icons[key];
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
                [...wrapper.children].forEach(li => {
                    if (li.firstChild?.open) li.firstChild.onclick();
                });
            }
            animate(node, a, isopen);
        }
    } else {
        // open folder
        localStorage.setItem(`open.${node.id}`, true);
        // auto-close sibling folders
        if (getConfig('auto_close')) {
            [...a.parentNode.parentNode.children].forEach(li => {
                const sibling = li.firstChild;
                if (sibling !== a && sibling?.open) sibling.onclick();
            });
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
        wrap.style.height = isopen ? `${wrap.firstChild.clientHeight}px` : '0';
        wrap.style.opacity = isopen ? '1' : '0';
    }
    // requestAnimationFrame twice to ensure at least one frame has passed
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (wrap) {
                wrap.className = 'wrap';
                wrap.style.height = isopen ? '0' : `${wrap.firstChild.clientHeight}px`;
                wrap.style.opacity = isopen ? '0' : '1';
                wrap.style.pointerEvents = isopen ? 'none' : null;
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
    result.forEach(child => openLink(child, 2));
}

// opens given node
async function openLink(node, newtab) {
    const { url } = node;
    if (!url) return;

    const tab = await chrome.tabs.getCurrent();
    if (newtab) {
        chrome.tabs.create({ url, active: newtab === 1, openerTabId: tab.id });
    } else {
        chrome.tabs.update(tab.id, { url });
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

    // add missing root items
    missing.forEach(id => {
        if (getConfig(`show_${id}`)) {
            columns[0].push(id);
        }
    });

    // populate coordinate map and remove empty columns
    coords = {};
    for (let x = columns.length - 1; x >= 0; x--) {
        if (columns[x].length === 0) {
            columns.splice(x, 1);
        } else {
            columns[x].forEach((id, y) => {
                coords[id] = { x, y };
            });
        }
    }
}

// load columns from storage or default
async function loadColumns() {
    Perf.mark('loadColumns start');
    columns = [];
    forEachColumnEntry((x, y, id) => {
        if (!columns[x]) columns[x] = [];
        columns[x][y] = id;
    });

    if (root) {
        verifyColumns();
        // FAST: Only fetch folder metadata, not children
        await prefetchFolderMetadata();
        await renderColumns();
    } else {
        Perf.mark('loadColumns: fetching root IDs + metadata');
        // Use fast getRootFolderIds and metadata fetch (no children yet)
        const [rootIds] = await Promise.all([
            getRootFolderIds(),
            prefetchFolderMetadata()
        ]);
        root = [...special, ...rootIds];
        verifyColumns();
        await renderColumns();
    }
    Perf.mark('loadColumns end (DOM ready)');

    // Wait for actual browser paint before printing report
    // This ensures we measure when bookmarks are actually visible
    if (typeof requestAnimationFrame !== 'undefined') {
        Perf.waitForPaintAndReport();

        // After first paint, load children progressively
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                // Load children data in background, then expand folders
                loadChildrenProgressively().then(() => {
                    expandDeferredFolders();
                });
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
    for (let x = 0; x < columns.length; x++) {
        for (let y = columns[x].length - 1; y >= 0; y--) {
            if (ids.includes(columns[x][y])) {
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
    return { xpos, ypos };
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

// get recently closed tabs
async function getClosed() {
    const maxResults = getConfig('number_closed');
    const sessions = await chrome.sessions.getRecentlyClosed({ maxResults });
    return sessions.slice(0, maxResults).map(session => {
        if (session.window?.tabs.length === 1) {
            session.tab = session.window.tabs[0];
        }
        const sessionId = session.window ? session.window.sessionId : session.tab.sessionId;
        return {
            title: session.tab ? session.tab.title : `${session.window.tabs.length} Tabs`,
            url: session.tab?.url ?? null,
            className: session.window ? 'window' : null,
            action: () => { chrome.sessions.restore(sessionId); refreshClosed(); return false; }
        };
    });
}

async function getDevices() {
    const devices = await chrome.sessions.getDevices({ maxResults: getConfig('number_closed') });
    return devices.map(device => {
        const children = device.sessions.flatMap(session => {
            const tabs = session.window ? session.window.tabs : [session.tab];
            return tabs.map(tab => ({ title: tab.title, url: tab.url }));
        });
        return {
            id: `device.${device.deviceName}`,
            title: device.deviceName,
            children
        };
    });
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

    getChildren({ id: 'closed' }).then(result => {
        targets.forEach(target => renderAll(result, target));
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
    show_apps: 1,
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

// get config value or default
function getConfig(key) {
    const value = localStorage.getItem(`options.${key}`);
    if (value != null) {
        // Dynamic show_* keys (e.g., show_2, show_4) are numbers but not in config
        const isNumber = typeof config[key] === 'number' || (key.startsWith('show_') && !(key in config));
        return isNumber ? Number(value) : value;
    }
    return key in theme ? theme[key] : config[key];
}

// set config value
function setConfig(key, value) {
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
        Object.keys(config).forEach(k => {
            if (k !== key) {
                onChange(k);
                showConfig(k);
            }
        });
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
    font:                 { sel: '#main a', prop: 'font-family', fmt: v => `"${v}"` },
    font_size:            { sel: '#main a', prop: 'font-size', fmt: v => `${v / 10}em` },
    font_weight:          { sel: '#main a', prop: 'font-weight' },
    font_color:           { sel: '#main a', prop: 'color' },
    background_color:     { sel: 'body', prop: 'background-color' },
    background_image:     { sel: 'body', prop: 'background-image', fmt: v => `url(${v})` },
    background_image_file:{ sel: 'body', prop: 'background-image', fmt: v => `url(${v})` },
    background_align:     { sel: 'body', prop: 'background-position' },
    background_repeat:    { sel: 'body', prop: 'background-repeat' },
    background_size:      { sel: 'body', prop: 'background-size' },
    highlight_font_color: { sel: '#main a:hover', prop: 'color' },
    highlight_color:      { sel: '#main a:hover', prop: 'background-color' },
    shadow_color:         v => `#main a:hover { box-shadow: 0 0 ${scale(getConfig('shadow_blur'), 7, 100)}px ${v}; }`,
    shadow_blur:          v => `#main a:hover { box-shadow: 0 0 ${scale(v, 7, 100)}px ${getConfig('shadow_color')}; }`,
    highlight_round:      { sel: '#main a', prop: 'border-radius', fmt: v => `${scale(v, 0.2, 1.5)}em` },
    fade:                 { sel: '#main a', prop: 'transition-duration', fmt: v => `${scale(v, 0.2, 1)}s` },
    slide:                { sel: '.wrap', prop: 'transition-duration', fmt: v => `${scale(v, 0.2, 1)}s` },
    spacing:              v => `#main a { line-height: ${scale(v, 2, 5.6, 0.8)}; padding-left: ${scale(v, 0.8, 2, 0.4)}em; padding-right: ${scale(v, 0.8, 2, 0.4)}em; }`,
    width:                v => `#main { width: ${getConfig('auto_scale') ? `${scale(v, 80, 100, 20)}%` : `${scale(v, 1000, 3000, 400)}px`}; }`,
    h_pos:                v => { const margin = 100 - scale(getConfig('width'), 80, 100, 20); return `#main { left: ${scale(v, 0, margin / 2, -margin / 2)}%; }`; },
    v_margin:             v => `#main { margin-top: ${getConfig('auto_scale') ? `${scale(v, 5, 20)}%` : `${scale(v, 80, 600)}px`}; }`,
    hide_options:         () => '#options_button { opacity: 0; }',
    css:                  v => v,
    auto_scale:           v => v ? null : '#main { margin-top: 80px; width: 1000px; }'
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
            style.innerText = css;
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
    theme = themes[getConfig('theme')] || {};
    Object.keys(config).forEach(key => {
        if (key === 'background_image_file') {
            setTimeout(() => onChange('background_image_file'), 0);
        } else {
            onChange(key);
        }
    });
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
    reset.onclick = () => { setConfig(key, null); showConfig(key); return false; };

    input.reset = reset;
    input.parentNode.appendChild(reset);
    showConfig(key);
}

let settingsInitialized = false;

// initialize options panel
function initSettings() {
    settingsInitialized = true;

    document.getElementById('options_close_button').onclick = () => { showOptions(false); return false; };

    const options = document.getElementById('options');
    const nav = document.getElementById('options_nav');
    let currentIndex = 0;

    [...nav.children].forEach((li, i) => {
        const a = li.firstChild;
        a.onclick = function() {
            // clear current style
            nav.children[currentIndex].firstChild.classList.remove('current');
            options.getElementsByClassName('section')[currentIndex].classList.remove('current');

            // apply new current style
            currentIndex = i;
            nav.children[currentIndex].firstChild.classList.add('current');
            options.getElementsByClassName('section')[currentIndex].classList.add('current');

            // show custom css on advanced tab
            if (currentIndex === nav.children.length - 1) {
                const allcss = document.getElementById('all_css');
                allcss.value = Object.keys(config)
                    .map(k => getStyle(k, getConfig(k)))
                    .filter(css => css && css.length < 1000)
                    .join('\n');
            }

            // import/export
            if (currentIndex === nav.children.length - 2) {
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
                        Object.entries(imported).forEach(([k, v]) => localStorage.setItem(k, v));
                        imports.value = '';
                        imports.placeholder = 'Import successful!';
                        exports.value = JSON.stringify(localStorage, replacer);
                        loadSettings();
                        loadColumns();
                        Object.keys(config).forEach(showConfig);
                    } catch {
                        imports.value = '';
                        imports.placeholder = 'Import error! Please check if your settings are valid JSON.';
                    }
                };
            }
            return false;
        };
    });

    // add options to hide bookmark folders
    chrome.bookmarks.getTree().then(async result => {
        const placeholder = document.getElementById('options_show_bookmarks');
        result[0].children.forEach(node => {
            const key = `show_${node.id}`;
            config[key] = 1;

            const span = document.createElement('span');
            span.innerText = node.title;

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `options_${key}`;

            const label = document.createElement('label');
            label.appendChild(span);
            label.appendChild(input);
            placeholder.appendChild(label);
        });

        // replace text input with system font list
        if (chrome.fontSettings) {
            const fontInput = document.getElementById('options_font');
            const select = document.createElement('select');
            fontInput.parentNode.replaceChild(select, fontInput);
            select.id = fontInput.id;
        }

        // show settings
        Object.keys(config).forEach(initConfig);
        loadSettings();

        // load themes
        const themeSelect = document.getElementById('options_theme');
        if (themeSelect.childNodes.length === 0) {
            Object.keys(themes).forEach(name => {
                const option = document.createElement('option');
                option.innerText = name;
                option.selected = name === getConfig('theme');
                themeSelect.appendChild(option);
            });
        }

        // load font list
        if (chrome.fontSettings) {
            const fonts = await chrome.fontSettings.getFontList();
            const select = document.getElementById('options_font');
            if (select.childNodes.length > 0) return;

            [{ fontId: 'Sans-serif' }, ...fonts].forEach(({ fontId }) => {
                const option = document.createElement('option');
                option.innerText = fontId;
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
        Object.keys(config).forEach(showConfig);
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

document.addEventListener('mousedown', () => document.body.classList.add('hide-focus'));
document.addEventListener('keydown', () => document.body.classList.remove('hide-focus'));

window.onresize = updateTooltips;

// load options panel
document.getElementById('options_button').onclick = () => { showOptions(true); return false; };
if (location.search === '?options') showOptions(true);

// refresh recently closed
if (chrome.sessions) chrome.sessions.onChanged.addListener(refreshClosed);

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getColumnIds: () => {
            const ids = [];
            forEachColumnEntry((x, y, id) => ids.push(id));
            return ids;
        },
        getCachedChildren,
        clearPrefetchCache: () => {
            prefetchedData.nodes = {};
            prefetchedData.children = {};
        },
        getPrefetchedData: () => prefetchedData,
        prefetchSpecialFolder,
        getConfigValue,
        special,
        expandDeferredFolders,
        render,
        renderAll
    };
}

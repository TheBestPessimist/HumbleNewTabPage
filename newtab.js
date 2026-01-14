'use strict';

// =============================================================================
// OPTIMIZED BOOKMARK LOADING - Prefetch only visible bookmarks in parallel
// =============================================================================

// Promise wrapper helper for Chrome APIs
function promisify(fn, arg) {
	return new Promise(function(resolve) {
		fn(arg, function(results) { resolve(results || []); });
	});
}

// Promise wrappers for Chrome bookmark APIs
function getBookmarkNodes(ids) {
	return (!ids || ids.length === 0) ? Promise.resolve([]) : promisify(chrome.bookmarks.get, ids);
}

function getBookmarkChildren(id) {
	return promisify(chrome.bookmarks.getChildren, id);
}

function getBookmarkTree() {
	return new Promise(function(resolve) {
		chrome.bookmarks.getTree(function(results) { resolve(results || []); });
	});
}

// Promise wrapper for fetching special folder data
function fetchSpecialFolderData(id) {
	return new Promise(function(resolve) {
		switch (id) {
			case 'top':
				if (chrome.topSites) {
					chrome.topSites.get(function(result) {
						resolve((result || []).slice(0, getConfigValue('number_top', 10)));
					});
				} else {
					resolve([]);
				}
				break;
			case 'recent':
				chrome.bookmarks.getRecent(getConfigValue('number_recent', 10), function(result) {
					resolve(result || []);
				});
				break;
			case 'closed':
				getClosed(resolve);
				break;
			case 'devices':
				getDevices(resolve);
				break;
			default:
				resolve([]);
		}
	});
}

// Cache for prefetched bookmark data
var prefetchedData = {
	nodes: {},      // id -> node data
	children: {}    // id -> array of child nodes
};

// Mark folders (nodes without url) as having children
function markFolders(children) {
	for (var i = 0; i < children.length; i++) {
		if (!children[i].url) {
			children[i].children = true;
		}
	}
	return children;
}

// Iterate over column storage entries, calling fn(x, y, id) for each
// If fn returns false, stop iteration. Returns array of [x, y] pairs visited.
function forEachColumnEntry(fn) {
	for (var x = 0; ; x++) {
		var foundInRow = false;
		for (var y = 0; ; y++) {
			var id = localStorage.getItem('column.' + x + '.' + y);
			if (id) {
				foundInRow = true;
				if (fn && fn(x, y, id) === false) return;
			} else {
				break;
			}
		}
		if (!foundInRow) break;
	}
}

// Special folder IDs (apps, top, recent, closed, devices)
// - 'apps' is a link, not a folder, so it's excluded from folder-related arrays
var special = ['apps', 'top', 'recent', 'closed', 'devices'];
var specialFolderIds = ['top', 'recent', 'closed', 'devices'];

// Get cached children or fetch if not available (works for both regular and special folders)
function getCachedChildren(id, callback) {
	// Use cache if available
	if (prefetchedData.children.hasOwnProperty(id)) {
		callback(prefetchedData.children[id]);
		// Special folders: consume cache (delete after use) so next open fetches fresh
		if (specialFolderIds.indexOf(id) !== -1) {
			delete prefetchedData.children[id];
		}
		return;
	}

	// Fetch based on folder type
	if (specialFolderIds.indexOf(id) !== -1) {
		fetchSpecialFolderData(id).then(callback);
	} else {
		getBookmarkChildren(id).then(function(children) {
			markFolders(children);
			prefetchedData.children[id] = children;
			callback(children);
		});
	}
}

// Get cached node or fetch if not available
function getCachedNode(id, callback) {
	if (prefetchedData.nodes.hasOwnProperty(id)) {
		callback([prefetchedData.nodes[id]]);
	} else {
		getBookmarkNodes([id]).then(function(nodes) {
			if (nodes && nodes[0]) {
				prefetchedData.nodes[id] = nodes[0];
			}
			callback(nodes);
		});
	}
}

// Prefetch children of a folder and recursively prefetch open subfolders
function prefetchFolderChildren(id) {
	return getBookmarkChildren(id).then(function(children) {
		markFolders(children);
		prefetchedData.children[id] = children;

		// Check if "remember open folders" is enabled
		var rememberOpen = localStorage.getItem('options.remember_open');
		if (rememberOpen === null || rememberOpen === '1' || rememberOpen === 'true') {
			// Recursively prefetch children of open subfolders
			var openFolderPromises = [];
			for (var k = 0; k < children.length; k++) {
				var child = children[k];
				// If it's a folder and marked as open in localStorage
				if (!child.url && localStorage.getItem('open.' + child.id)) {
					openFolderPromises.push(prefetchFolderChildren(child.id));
				}
			}
			if (openFolderPromises.length > 0) {
				return Promise.all(openFolderPromises);
			}
		}
	});
}

// Prefetch special folder data if it's marked as open
function prefetchSpecialFolder(id) {
	if (!localStorage.getItem('open.' + id)) {
		return Promise.resolve();
	}
	return fetchSpecialFolderData(id).then(function(result) {
		prefetchedData.children[id] = result;
	});
}

// Helper to get config value (works before full config is loaded)
function getConfigValue(key, defaultValue) {
	var value = localStorage.getItem('options.' + key);
	return value !== null ? Number(value) : defaultValue;
}

// Prefetch visible bookmarks for all columns
function prefetchVisibleBookmarks() {
	// Get all column IDs from the columns variable
	var columnIds = [];
	if (columns) {
		for (var x = 0; x < columns.length; x++) {
			for (var y = 0; y < columns[x].length; y++) {
				columnIds.push(columns[x][y]);
			}
		}
	}

	// Separate special IDs from regular bookmark IDs (use global 'special' array)
	var bookmarkIds = columnIds.filter(function(id) {
		return special.indexOf(id) === -1;
	});
	var visibleSpecialFolders = columnIds.filter(function(id) {
		return specialFolderIds.indexOf(id) !== -1; // excludes 'apps' which is not a folder
	});

	var promises = [];

	// Prefetch special folders that are open
	for (var i = 0; i < visibleSpecialFolders.length; i++) {
		promises.push(prefetchSpecialFolder(visibleSpecialFolders[i]));
	}

	// Prefetch regular bookmark folders
	if (bookmarkIds.length > 0) {
		var bookmarkPromise = getBookmarkNodes(bookmarkIds).then(function(nodes) {
			// Cache the nodes
			for (var i = 0; i < nodes.length; i++) {
				if (nodes[i]) {
					prefetchedData.nodes[nodes[i].id] = nodes[i];
				}
			}

			// Prefetch children for each folder (including open subfolders recursively)
			var childPromises = bookmarkIds.map(function(id) {
				return prefetchFolderChildren(id);
			});

			return Promise.all(childPromises);
		});
		promises.push(bookmarkPromise);
	}

	return Promise.all(promises);
}

// =============================================================================
// END OPTIMIZED BOOKMARK LOADING
// =============================================================================

// render a single bookmark node
function render(node, target) {
    if (node.description === 'separator') return;

    const li = document.createElement('li');
    const a = document.createElement('a');

    const url = node.url;
    if (url)
        a.href = url;
    else
        a.tabIndex = 0;

    let text = node.title || node.name || '';
    if (!text && node.title === null) text = node.url || '';
    a.innerText = text;

    if (node.tooltip) a.title = node.tooltip;
    setClass(a, node);

    a.insertBefore(getIcon(node), a.firstChild);

    if (node.action) {
        a.onclick = function (event) {
            return node.action(event);
        };
    } else if (url) {
        const newtab = getConfig('newtab');
        if (newtab === 1) {
            // new foreground tab
            a.target = '_blank';
        } else if (newtab === 2) {
            // new background tab
            a.onclick = function () {
                openLink(node, newtab);
                return false;
            };
        }
        // fix opening chrome:// and file:/// urls
        const urlStart = url.substring(0, 6);
        if (urlStart === 'chrome' || urlStart === 'file:/') {
            a.onclick = function (e) {
                openLink(node, newtab || (e.ctrlKey ? 2 : 0));
                return false;
            };
            a.onauxclick = function (e) {
                if (e.button === 1) {
                    openLink(node, 2);
                    return false;
                }
            }
        }
    } else if (!node.children)
        a.style.pointerEvents = 'none';

    li.appendChild(a);

    // folder
    if (node.children) {
        // render children
        if (a.open || getConfig('remember_open') && localStorage.getItem('open.' + node.id)) {
            setClass(a, node, true);
            a.open = true;
            getChildrenFunction(node)(function (result) {
                renderAll(result, li);
            });
        }

        // click handlers
        addFolderHandlers(node, a);
        enableDragFolder(node, a);

    } else if (node.id === 'apps')
        enableDragFolder(node, a);

    target.appendChild(li);
    return li;
}

// render an array of bookmark nodes
function renderAll(nodes, target, toplevel) {
    const ul = document.createElement('ul');
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        // skip extensions and duplicated child folders
        if (toplevel || !coords[node.id])
            render(node, ul);
    }
    if (ul.childNodes.length === 0)
        render({id: 'empty', title: '< Empty >'}, ul);
    if (toplevel)
        target.appendChild(ul);
    else {
        // wrap child ul for animation
        const wrap = document.createElement('div');
        wrap.appendChild(ul);
        target.appendChild(wrap);
    }
    updateTooltips();
    return ul;
}

// render column with given index
function renderColumn(index, target) {
    const ids = columns[index];
    if (ids.length === 1 && !getConfig('show_root'))
        getChildrenFunction({id: ids[0]})(function (result) {
            renderAll(result, target);
            addColumnHandlers(index, target);
        });
    else if (ids.length > 0) {
        let i = 0;
        const nodes = [];
        // get all nodes for column
        const callback = function (result) {
            for (let j = 0; j < result.length; j++)
                nodes.push(result[j]);
            i++;
            if (i < ids.length)
                getSubTree(ids[i], callback);
            else {
                // render node list
                renderAll(nodes, target, true);
                addColumnHandlers(index, target);
            }
        };
        getSubTree(ids[i], callback);
    }
}

// render all columns to main div
function renderColumns() {
    // clear main div
    const target = document.getElementById('main');
    while (target.hasChildNodes())
        target.removeChild(target.lastChild);

    // render columns
    for (let i = 0; i < columns.length; i++) {
        const column = document.createElement('div');
        column.className = 'column';
        column.style.width = (1 / columns.length) * 100 + '%';

        // enable drag and drop
        enableDragColumn(i, column);

        target.appendChild(column);
        renderColumn(i, column);
    }

    enableDragDrop();
}

// enables click and context menu for given folder
function addFolderHandlers(node, a) {
    // click handler
    a.onclick = function () {
        toggle(node, a, getChildrenFunction(node));
        return false;
    };

    // context menu handler
    const items = getMenuItems(node);

    // column layout items
    if (!getConfig('lock')) {
        items.push(null);// spacer
        items.push({
            label: 'Create new column',
            action: function () {
                addColumn([node.id]);
            }
        });

        if (coords[node.id]) {
            const pos = coords[node.id];
            if (pos.y > 0)
                items.push({
                    label: 'Move folder up',
                    action: function () {
                        addRow(node.id, pos.x, pos.y - 1);
                    }
                });
            if (pos.y < columns[pos.x].length - 1)
                items.push({
                    label: 'Move folder down',
                    action: function () {
                        addRow(node.id, pos.x, pos.y + 2);
                    }
                });
            if (pos.x > 0)
                items.push({
                    label: 'Move folder left',
                    action: function () {
                        addRow(node.id, pos.x - 1);
                    }
                });
            if (pos.x < columns.length - 1)
                items.push({
                    label: 'Move folder right',
                    action: function () {
                        addRow(node.id, pos.x + 1);
                    }
                });
            if (root.indexOf(node.id) < 0)
                items.push({
                    label: 'Remove folder',
                    action: function () {
                        removeRow(pos.x, pos.y);
                    }
                });
        }
    }

    a.oncontextmenu = function (event) {
        renderMenu(items, event.pageX, event.pageY);
        return false;
    };
}

// enables context menu for given column
function addColumnHandlers(index, ul) {
    let items = [];
    const ids = columns[index];

    // single folder items
    if (ids.length === 1)
        items = getMenuItems({id: ids[0]});

    // column layout items
    if (!getConfig('lock') && columns.length > 1) {
        items.push(null);// spacer
        if (index > 0)
            items.push({
                label: 'Move column left',
                action: function () {
                    addColumn(ids, index - 1);
                }
            });
        if (index < columns.length - 1)
            items.push({
                label: 'Move column right',
                action: function () {
                    addColumn(ids, index + 2);
                }
            });
        items.push({
            label: 'Remove column',
            action: function () {
                removeColumn(index);
            }
        });
        if (ids.length === 1) {
            if (index > 0)
                items.push({
                    label: 'Move folder left',
                    action: function () {
                        addRow(ids[0], index - 1);
                    }
                });
            if (index < columns.length - 1)
                items.push({
                    label: 'Move folder right',
                    action: function () {
                        addRow(ids[0], index + 1);
                    }
                });
        }
    }

    if (items.length > 0)
        ul.oncontextmenu = function (event) {
            if (event.target.tagName === 'A' || event.target.parentNode.tagName === 'A')
                return true;
            renderMenu(items, event.pageX, event.pageY);
            return false;
        };
}

// gets context menu items for given node
function getMenuItems(node) {
    const items = [];
    items.push({
        label: 'Open all links in folder',
        action: function () {
            openLinks(node);
        }
    });
    if (node.id === 'closed')
        items.push({
            label: 'Clear browsing data',
            action: function () {
                openLink({url: 'chrome://settings/clearBrowserData'}, 1);
            }
        });
    if (node.id === 'devices')
        items.push({
            label: 'History',
            action: function () {
                openLink({url: 'chrome://history'}, 1);
            }
        });
    if (Number(node.id))
        items.push({
            label: 'Edit bookmarks',
            action: function () {
                openLink({url: 'chrome://bookmarks/?id=' + node.id}, 1);
            }
        });
    return items;
}

// wraps click handler for menu items
function onMenuClick(item) {
    return function () {
        item.action();
        return false;
    };
}

// renders a popup menu at given coordinates
function renderMenu(items, x, y) {
    const ul = document.createElement('ul');
    ul.className = 'menu';
    for (let i = 0; i < items.length; i++) {
        const li = document.createElement('li');
        if (items[i]) {
            const a = document.createElement('a');
            a.innerText = items[i].label;
            a.tabIndex = 0;
            a.onclick = onMenuClick(items[i]);

            li.appendChild(a);
        } else if (i > 0 && i < items.length - 1)
            li.appendChild(document.createElement('hr'));
        else
            continue;

        ul.appendChild(li);
    }
    document.body.appendChild(ul);
    ul.style.left = Math.max(Math.min(x, window.innerWidth + window.scrollX - ul.clientWidth), 0) + 'px';
    ul.style.top = Math.max(Math.min(y, window.innerHeight + window.scrollY - ul.clientHeight), 0) + 'px';
    ul.onmousedown = function (event) {
        event.stopPropagation();
        return true;
    };

    setTimeout(function () {
        var closeHandler = function () { closeMenu(ul); return true; };
        document.onclick = closeHandler;
        document.onmousedown = closeHandler;
        document.oncontextmenu = closeHandler;
        document.onkeydown = function (event) {
            if (event.keyCode === 27) closeMenu(ul);
            return true;
        };
    }, 20);
    return ul;
}

// removes the given popup menu
function closeMenu(ul) {
    document.body.removeChild(ul);
    document.onclick = null;
    document.onmousedown = null;
    document.oncontextmenu = null;
    document.onkeydown = null;
}

let dragIds;

// enable drag and drop of column
function enableDragColumn(id, column) {
    if (getConfig('lock'))
        return;

    column.draggable = true;

    column.ondragstart = function (event) {
        dragIds = columns[id];
        event.dataTransfer.effectAllowed = 'move';
        this.classList.add('dragstart');
    };
    column.ondragend = function () {
        dragIds = null;
        this.classList.remove('dragstart');
        clearDropTarget();
    };
}

let dropTarget;

// enable drag and drop of folder
function enableDragFolder(node, a) {
    if (getConfig('lock'))
        return;

    a.draggable = true;
    a.ondragstart = function (event) {
        dragIds = [node.id];
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move copy';
        this.classList.add('dragstart');
    };
    a.ondragend = function () {
        dragIds = null;
        this.classList.remove('dragstart');
        clearDropTarget();
    };
}

// init drag and drop handlers
function enableDragDrop() {
    const main = document.getElementById('main');

    if (getConfig('lock')) {
        main.ondragover = null;
        main.ondragleave = null;
        main.ondrop = null;
        return;
    }

    main.ondragover = function (event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        // highlight drop target
        const target = getDropTarget(event);
        if (target) {
            clearDropTarget();
            dropTarget = target;
            const bordercss = 'solid 2px ' + getConfig('font_color');
            if (target.tagName === 'LI' || target.tagName === 'UL') {
                if (isAbove(event.pageY, target)) {
                    target.style.borderBottom = bordercss;
                    target.style.margin = '0 0 -2px 0';
                } else {
                    target.style.borderTop = bordercss;
                    target.style.margin = '-2px 0 0 0';
                }
            } else if (target.className === 'column') {
                if (event.pageX - target.offsetLeft > target.clientWidth / 2) {
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

    main.ondragleave = function () {
        clearDropTarget();
    };

    main.ondrop = function (event) {
        event.stopPropagation();

        const target = getDropTarget(event);
        if (!target)
            return false;

        // calculate drop coordinates
        let x = getDropX(target);
        const y = getDropY(target, event);

        if (dragIds.length === 1 && y != null)
            addRow(dragIds[0], x, y);
        else {
            if (event.pageX - target.offsetLeft > target.clientWidth / 2)
                x++;
            addColumn(dragIds, x);
        }

        return false;
    };
}

// gets proper drop target element
function getDropTarget(event) {
    if (!dragIds)
        return null;
    let target = event.target;
    if (target && (target.tagName === 'A' || target.parentNode.tagName === 'A') && dragIds.length === 1) {
        // get parent folder until toplevel
        while (target &&
        target.parentNode.parentNode &&
        target.parentNode.parentNode.className !== 'column') {
            // target should be LI
            target = target.parentNode;
        }
        // if single-folder column, get the UL
        if (target && target.tagName === 'LI' &&
            columns[getDropX(target)].length === 1)
            target = target.parentNode;
        // target should be LI or UL by here...
    } else
        while (target && target.className !== 'column')
            target = target.parentNode;// target column

    return target;
}

// gets x coordinate of drop target
function getDropX(target) {
    let x = null;
    while (target && target.className !== 'column')
        target = target.parentNode;
    if (target) {
        x = 0;
        for (; target.previousSibling; x++)
            target = target.previousSibling;
    }
    return x;
}

// gets y coordinate of drop target
function getDropY(target, event) {
    if (target.tagName !== 'LI' && target.tagName !== 'UL') return null;
    let y = isAbove(event.pageY, target) ? 1 : 0;
    if (target.tagName === 'LI') {
        for (; target.previousSibling; y++) target = target.previousSibling;
    }
    return y;
}

// returns true if y position is above target element midpoint
function isAbove(pageY, target) {
    return pageY - window.scrollY - target.getBoundingClientRect().top > target.clientHeight / 2;
}

// clears droptarget styles
function clearDropTarget() {
    if (dropTarget) {
        dropTarget.style.border = null;
        dropTarget.style.margin = null;
    }
    dropTarget = null;
}

let tooltipTimeout = null;

// adds tootlips to truncated text
function updateTooltips() {
    if (tooltipTimeout) clearTimeout(tooltipTimeout);

    tooltipTimeout = setTimeout(function () {
        tooltipTimeout = null;
        const elements = document.querySelectorAll('#main li a');
        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            if (element.clientWidth + 1 < element.scrollWidth) {
                element.title = element.title || element.textContent;
            } else if (element.title === element.textContent) {
                element.title = '';
            }
        }
    }, 100);
}

// gets function that returns children of node
function getChildrenFunction(node) {
    return function (callback) {
        // If children is an array (already loaded), use it directly
        if (Array.isArray(node.children)) {
            callback(node.children);
            return;
        }
        // Otherwise fetch from cache (handles special folders, boolean markers, and unloaded folders)
        getCachedChildren(node.id, function(children) {
            if (children) {
                callback(children);
            } else if (coords[node.id]) {
                // remove missing bookmark locations
                removeRow(coords[node.id].x, coords[node.id].y);
            }
        });
    };
}

// Special folder definitions for getSubTree
var specialFolderDefs = {
    top: {title: 'Most visited', id: 'top', children: true},
    apps: {title: 'Apps', id: 'apps', url: 'chrome://apps'},
    recent: {title: 'Recent bookmarks', id: 'recent', children: true},
    closed: {title: 'Recently closed', id: 'closed', children: true},
    devices: {title: 'Other devices', id: 'devices', children: true}
};

// gets the subtree for given id
function getSubTree(id, callback) {
    if (specialFolderDefs[id]) {
        callback([specialFolderDefs[id]]);
        return;
    }
    // Use cached node data instead of fetching entire subtree
    getCachedNode(id, function(nodes) {
        if (nodes && nodes[0]) {
            var node = nodes[0];
            node.children = prefetchedData.children.hasOwnProperty(id) ? prefetchedData.children[id] : true;
            callback([node]);
        } else if (coords[id]) {
            removeRow(coords[id].x, coords[id].y);
        }
    });
}

// IDs that get their own CSS class
var specialClassIds = ['top', 'apps', 'recent', 'closed', 'devices', 'empty'];

// sets css classes for node
function setClass(target, node, isopen) {
    if (node.className) target.classList.add(node.className);
    if (node.children) target.classList.add('folder');
    target.classList.toggle('open', !!isopen);
    if (specialClassIds.indexOf(node.id) !== -1) target.classList.add(node.id);
}

// gets best icon for a node
function getIcon(node) {
    let url = null,
        url2x = null;
    let useCache = false;

    if (node.icons) {
        let size;
        for (let i in node.icons) {
            const iconInfo = node.icons[i];
            if (iconInfo.url && (!size || (iconInfo.size < size && iconInfo.size > 15))) {
                url = iconInfo.url;
                if (iconInfo.size > 31) url2x = iconInfo.url;
                size = iconInfo.size;
            }
        }
    } else if (node.icon) {
        url = node.icon;
    } else if (node.url) {
        // Use favicon cache for bookmark URLs
        useCache = true;
    }

    // If using cache, return an img that loads from IndexedDB cache
    if (useCache && typeof FaviconCache !== 'undefined') {
        return FaviconCache.createIcon(node.url, 16);
    }

    const icon = document.createElement(url ? 'img' : 'div');
    icon.className = 'icon';
    if (url) {
        // Use lazy loading for favicons to improve initial page load
        icon.loading = 'lazy';
        // Use decoding async to not block rendering
        icon.decoding = 'async';
        icon.src = url;
        if (url2x) icon.srcset = url2x + ' 2x';
    }
    icon.alt = ' ';
    return icon;
}

// toggle folder open state
function toggle(node, a) {
    const isopen = a.open;
    setClass(a, node, !isopen);
    a.open = !isopen;
    if (isopen) {
        // close folder
        localStorage.removeItem('open.' + node.id);
        if (a.nextSibling) {
            // auto-close child folders
            if (getConfig('auto_close')) {
                const children = (a.nextSibling.tagName === 'DIV' ? a.nextSibling.firstChild : a.nextSibling).children;
                for (var i = 0; i < children.length; i++) {
                    const child = children[i].firstChild;
                    if (child.open)
                        child.onclick();
                }
            }
            // close folder
            animate(node, a, isopen);
        }
    } else {
        // open folder
        localStorage.setItem('open.' + node.id, true);
        // auto-close sibling folders
        if (getConfig('auto_close')) {
            const siblings = a.parentNode.parentNode.children;
            for (var i = 0; i < siblings.length; i++) {
                const sibling = siblings[i].firstChild;
                if (sibling !== a && sibling.open)
                    sibling.onclick();
            }
        }
        // open folder
        if (a.nextSibling)
            animate(node, a, isopen);
        else
            getChildrenFunction(node)(function (result) {
                if (!a.nextSibling && a.open) {
                    renderAll(result, a.parentNode);
                    animate(node, a, isopen);
                }
            });
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
        wrap.style.height = isopen ? wrap.firstChild.clientHeight + 'px' : 0;
        wrap.style.opacity = isopen ? 1 : 0;
    }
    // requestAnimationFrame twice to ensure at least one frame has passed
    requestAnimationFrame(function () {
        requestAnimationFrame(function () {
            if (wrap) {
                wrap.className = 'wrap';
                wrap.style.height = isopen ? 0 : wrap.firstChild.clientHeight + 'px';
                wrap.style.opacity = isopen ? 0 : 1;
                wrap.style.pointerEvents = isopen ? 'none' : null;
            }
        });
    });

    const duration = scale(getConfig('slide'), .2, 1) * 1000;
    a.animationHandle = setTimeout(function () {
        a.animationHandle = null;
        if (isopen)
            a.parentNode.removeChild(wrap);
        else {
            wrap.className = null;
            wrap.removeAttribute('style');
        }
        wrap = null;
    }, duration);
}

// opens immediate children of given node in new tabs
function openLinks(node) {
    chrome.tabs.getCurrent(function () {
        getChildrenFunction(node)(function (result) {
            for (let i = 0; i < result.length; i++)
                openLink(result[i], 2);
        });
    });
}

// opens given node
function openLink(node, newtab) {
    const url = node.url;
    if (url) {
        chrome.tabs.getCurrent(function (tab) {
            if (newtab)
                chrome.tabs.create({url: url, active: (newtab === 1), openerTabId: tab.id});
            else
                chrome.tabs.update(tab.id, {url: url});
        });
    }
}

var columns; // columns[x][y] = id
var root; // root[] = id
var coords; // coords[id] = {x:x, y:y}
// Note: 'special' array is defined at the top of the file

// ensure root folders are included
function verifyColumns() {
    // default layout
    if (columns.length === 0) {
        columns.push([]);
        columns.push(special.filter(function (a) {
            return getConfig('show_' + a) !== false;
        }));
    }

    // find missing root items
    const missing = root.slice(0);
    for (var x = 0; x < columns.length; x++) {
        for (var y = 0; y < columns[x].length; y++) {
            var i = missing.indexOf(columns[x][y]);
            if (i > -1)
                missing.splice(i, 1);
        }
    }

    // add missing root items
    const column = columns[0];
    for (var i = 0; i < missing.length; i++) {
        if (getConfig('show_' + missing[i]) !== false)
            column.push(missing[i]);
    }

    // populate coordinate map
    coords = {};
    for (var x = 0; x < columns.length; x++) {
        for (var y = 0; y < columns[x].length; y++) {
            coords[columns[x][y]] = {x: x, y: y};
        }
        if (columns[x].length === 0) {
            columns.splice(x, 1);
            x--;
        }
    }
}

// load columns from storage or default
function loadColumns() {
    columns = [];
    for (let x = 0; ; x++) {
        const row = [];
        for (let y = 0; ; y++) {
            const id = localStorage.getItem('column.' + x + '.' + y);
            if (id) row.push(id); else break;
        }
        if (row.length > 0) columns.push(row); else break;
    }

    if (root) {
        verifyColumns();
        // Prefetch visible bookmarks in parallel, then render
        prefetchVisibleBookmarks().then(function() {
            renderColumns();
        });
    } else {
        // Get bookmark tree and prefetch in parallel
        Promise.all([
            getBookmarkTree(),
            prefetchVisibleBookmarks()
        ]).then(function(results) {
            var treeResult = results[0];
            // init root nodes
            const nodes = treeResult[0].children;
            root = special.slice(0);

            for (let i = 0; i < nodes.length; i++)
                root.push(nodes[i].id);

            verifyColumns();
            renderColumns();
        });
    }
}

// saves current column configuration to storage
function saveColumns() {
    // clear previous config
    forEachColumnEntry(function(x, y) { localStorage.removeItem('column.' + x + '.' + y); });
    verifyColumns();
    // save new config
    for (var x = 0; x < columns.length; x++) {
        for (var y = 0; y < columns[x].length; y++) {
            localStorage.setItem('column.' + x + '.' + y, columns[x][y]);
        }
    }
    // refresh
    loadColumns();
}

// removes ids from columns, returns adjusted {xpos, ypos} if provided
function removeIdsFromColumns(ids, xpos, ypos) {
    for (let x = 0; x < columns.length; x++) {
        for (let y = columns[x].length - 1; y >= 0; y--) {
            if (ids.indexOf(columns[x][y]) > -1) {
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
    return {xpos: xpos, ypos: ypos};
}

// creates and saves a new column
function addColumn(ids, index) {
    removeIdsFromColumns(ids);
    columns.splice(Math.min(index == null ? columns.length : index, columns.length), 0, ids.slice(0));
    saveColumns();
}

// removes given column
function removeColumn(index) {
    columns.splice(index, 1);
    saveColumns();
}

// creates and saves a new row
function addRow(id, xpos, ypos) {
    if (ypos == null) ypos = columns[xpos].length;
    var adjusted = removeIdsFromColumns([id], xpos, ypos);
    columns[adjusted.xpos].splice(Math.min(adjusted.ypos, columns[adjusted.xpos].length), 0, id);
    saveColumns();
}

// removes given row
function removeRow(xpos, ypos) {
    columns[xpos].splice(ypos, 1);
    saveColumns();
}

// get recently closed tabs
function getClosed(callback) {
    const maxResults = getConfig('number_closed');
    chrome.sessions.getRecentlyClosed({maxResults: maxResults}, function (sessions) {
        const nodes = sessions.slice(0, maxResults).map(function(session) {
            if (session.window && session.window.tabs.length === 1)
                session.tab = session.window.tabs[0];
            const sessionId = session.window ? session.window.sessionId : session.tab.sessionId;
            return {
                title: session.tab ? session.tab.title : session.window.tabs.length + ' Tabs',
                url: session.tab ? session.tab.url : null,
                className: session.window ? 'window' : null,
                action: function () {
                    chrome.sessions.restore(sessionId, refreshClosed);
                    return false;
                }
            };
        });
        callback(nodes);
    });
}

function getDevices(callback) {
    chrome.sessions.getDevices({maxResults: getConfig('number_closed')}, function (devices) {
        const nodes = devices.map(function(device) {
            const children = [];
            device.sessions.forEach(function(session) {
                var tabs = session.window ? session.window.tabs : [session.tab];
                tabs.forEach(function(tab) {
                    children.push({title: tab.title, url: tab.url});
                });
            });
            return {
                id: 'device.' + device.deviceName,
                title: device.deviceName,
                children: children
            };
        });
        callback(nodes);
    });
}

// refresh recently closed tab lists
function refreshClosed() {
    const targets = [];
    const folders = document.getElementsByClassName('closed');
    for (var i = 0; i < folders.length; i++) {
        const a = folders[i];
        if (a.nextSibling) {
            a.parentNode.removeChild(a.nextSibling);
            targets.push(a.parentNode);
        }
    }
    if (folders.length === 0 && coords['closed']) {
        const target = document.getElementsByClassName('column')[coords['closed'].x];
        target.removeChild(target.firstChild);
        targets.push(target);
    }

    getChildrenFunction({id: 'closed'})(function (result) {
        for (let i = 0; i < targets.length; i++)
            renderAll(result, targets[i]);
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

// color theme values
const themes = {
    Default: {},
    Classic: {
        font_color: '#000000',
        background_color: '#ffffff',
        highlight_color: '#3399ff',
        highlight_font_color: '#ffffff',
        shadow_color: '#97cbff'
    },
    Dusk: {
        font_color: '#c8b9be',
        background_color: '#56546b',
        highlight_color: '#494d5a',
        highlight_font_color: '#ffd275',
        shadow_color: '#000000'
    },
    Elegant: {
        font_color: '#888888',
        background_color: '#f6f6f6',
        highlight_color: '#ffffff',
        highlight_font_color: '#000000',
        shadow_color: '#aaaaaa'
    },
    Frosty: {
        font_color: '#3e5e82',
        background_color: '#e4eef3',
        highlight_color: '#0080c0',
        highlight_font_color: '#ffffff',
        shadow_color: '#8080ff'
    },
    Hacker: {
        font_color: '#00ff00',
        background_color: '#000000',
        highlight_color: '#00ff00',
        highlight_font_color: '#000000',
        shadow_color: '#ff0000'
    },
    Melon: {
        font_color: '#594526',
        background_color: '#f8ffe1',
        highlight_color: '#ff8000',
        highlight_font_color: '#ffff80',
        shadow_color: '#ff80c0'
    },
    Midnight: {
        font_color: '#bfdfff',
        background_color: '#101827',
        highlight_color: '#000000',
        highlight_font_color: '#80ecff',
        shadow_color: '#0080ff'
    },
    Slate: {
        font_color: '#555555',
        background_color: '#b7babf',
        highlight_color: '#aaaaaa',
        highlight_font_color: '#000000',
        shadow_color: '#2a2a2a'
    },
    Trees: {
        font_color: '#cdd088',
        background_color: '#566157',
        highlight_color: '#4d674b',
        highlight_font_color: '#ffff80',
        shadow_color: '#183010'
    },
    Valentine: {
        font_color: '#895fc2',
        background_color: '#eae1ff',
        highlight_color: '#ffb7f0',
        highlight_font_color: '#f00000',
        shadow_color: '#ffffff'
    },
    Warm: {
        font_color: '#824100',
        background_color: '#ffeedd',
        highlight_color: '#fffae8',
        highlight_font_color: '#800000',
        shadow_color: '#d98764'
    }
};
let theme = {};

// get config value or default
function getConfig(key) {
    const value = localStorage.getItem('options.' + key);
    if (value != null)
        return typeof config[key] === 'number' ? Number(value) : value;
    else
        return (theme.hasOwnProperty(key) ? theme[key] : config[key]);
}

// set config value
function setConfig(key, value) {
    if (value != null)
        localStorage.setItem('options.' + key, typeof config[key] === 'number' ? Number(value) : value);
    else {
        localStorage.removeItem('options.' + key);
        value = (theme.hasOwnProperty(key) ? theme[key] : config[key]);
    }
    // special case settings
    if (key === 'lock' || key === 'newtab' || key === 'show_root' || key.substring(0, 6) === 'number')
        loadColumns();
    else if (key === 'theme') {
        theme = themes[value];
        for (let i in config) {
            if (i !== key) {
                onChange(i);
                showConfig(i);
            }
        }
    } else if (key.substring(0, 4) === 'show') {
        const id = key.substring(5);
        if (!value) {
            if (coords[id])
                removeRow(coords[id].x, coords[id].y);
            saveColumns();
        } else {
            saveColumns();
        }
    }
    onChange(key, value);
    return value;
}

// map config keys to styles
const styles = {};

function getStyle(key, value) {
    switch (key) {
        case 'font':
            return '#main a { font-family: "' + value + '"; }';
        case 'font_size':
            return '#main a { font-size: ' + (value / 10) + 'em; }';
        case 'font_weight':
            return '#main a { font-weight: ' + value + '; }';
        case 'font_color':
            return '#main a { color: ' + value + '; }';
        case 'background_color':
            return 'body { background-color: ' + value + '; }';
        case 'background_image':
            return 'body { background-image: url(' + value + '); }';
        case 'background_image_file':
            return 'body { background-image: url(' + value + '); }';
        case 'background_align':
            return 'body { background-position: ' + value + '; }';
        case 'background_repeat':
            return 'body { background-repeat: ' + value + '; }';
        case 'background_size':
            return 'body { background-size: ' + value + '; }';
        case 'highlight_font_color':
            return '#main a:hover { color: ' + value + '; }';
        case 'highlight_color':
            return '#main a:hover { background-color: ' + value + '; }';
        case 'shadow_color':
            return '#main a:hover { box-shadow: 0 0 ' + scale(getConfig('shadow_blur'), 7, 100) + 'px ' + value + '; }';
        case 'shadow_blur':
            return '#main a:hover { box-shadow: 0 0 ' + scale(value, 7, 100) + 'px ' + getConfig('shadow_color') + '; }';
        case 'highlight_round':
            return '#main a { border-radius: ' + scale(value, .2, 1.5) + 'em; }';
        case 'fade':
            return '#main a { transition-duration: ' + scale(value, .2, 1) + 's; }';
        case 'slide':
            return '.wrap { transition-duration: ' + scale(value, .2, 1) + 's; }';
        case 'spacing':
            return '#main a { line-height: ' + scale(value, 2, 5.6, .8) + '; ' +
                'padding-left: ' + scale(value, .8, 2, .4) + 'em; ' +
                'padding-right: ' + scale(value, .8, 2, .4) + 'em; }';
        case 'width':
            return '#main { width: ' + (getConfig('auto_scale') ?
                scale(value, 80, 100, 20) + '%' :
                scale(value, 1000, 3000, 400) + 'px') + '; }';
        case 'h_pos':
            const margin = 100 - scale(getConfig('width'), 80, 100, 20);
            return '#main { left: ' + scale(value, 0, margin / 2, -margin / 2) + '%; }';
        case 'v_margin':
            return '#main { margin-top: ' + (getConfig('auto_scale') ?
                scale(value, 5, 20) + '%' :
                scale(value, 80, 600) + 'px') + '; }';
        case 'hide_options':
            return '#options_button { opacity: 0; }';
        case 'css':
            return value;
        case 'auto_scale':
            return value ? null : '#main { margin-top: 80px; width: 1000px; }';
        default:
            return null;
    }
}

// scales input value from [0,1,2] to [min,mid,max]
function scale(value, mid, max, min) {
    min = min || 0;
    return value > 1 ?
        mid + (value - 1) * (max - mid) :
        min + value * (mid - min);
}

// apply config value change
function onChange(key, value) {
    if (value == null)
        value = getConfig(key);

    if (value !== config[key]) {
        const css = getStyle(key, value);
        if (css) {
            let style;
            if (styles.hasOwnProperty(key))
                style = styles[key];
            else {
                style = document.createElement('style');
                styles[key] = style;
            }
            document.head.appendChild(style);

            // add style rules
            style.innerText = css;
        }
    } else if (styles.hasOwnProperty(key)) {
        // remove rules
        styles[key].parentNode.removeChild(styles[key]);
        delete styles[key];
    }
    // refresh dependent values
    if (key === 'width')
        onChange('h_pos');
    else if (key === 'shadow_blur')
        onChange('shadow_color');
    else if (key === 'auto_scale') {
        onChange('width');
        onChange('v_margin');
    }

    // update options panel
    if (!settingsInitialized)
        return;

    // show/hide default button
    const input = document.getElementById('options_' + key);
    if (input) {
        const isDefault = value === (theme.hasOwnProperty(key) ? theme[key] : config[key]);
        input.reset.style.visibility = (isDefault ? 'hidden' : null);
        if (input.swatch)
            input.swatch.value = value;
    }
}

// loads config settings
function loadSettings() {
    // load theme
    theme = themes[getConfig('theme')] || {};
    // load settings
    for (let key in config)
        if (key === 'background_image_file')
            setTimeout(function () {
                onChange('background_image_file');
            }, 0);
        else
            onChange(key);
}

// apply config values to input controls
function showConfig(key) {
    const input = document.getElementById('options_' + key);
    if (!input || input.type === 'file')
        return;

    input[input.type === 'checkbox' ? 'checked' : 'value'] = getConfig(key);
}

// initialize config settings
function initConfig(key) {
    const input = document.getElementById('options_' + key);
    if (!input)
        return;

    if (input.type === 'color') {
        input.type = 'text';
        input.className = 'color';
        const swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.value = input.value;
        swatch.oninput = function (event) {
            input.value = this.value;
            return input.onchange(event);
        };
        input.swatch = swatch;
        input.parentNode.appendChild(swatch);
    }
    input.onchange = function (event) {
        if (input.type === 'file') {
            // load file
            if (event.target.files.length === 1) {
                const file = event.target.files[0];
                if (file.size > 2097152) {
                    input.value = null;
                    alert('Image must be less than 2 MB.');
                    return false;
                }
                const reader = new FileReader();
                reader.onload = function (f) {
                    if (f.target.result)
                        setConfig(key, f.target.result);
                };
                reader.readAsDataURL(file);
            }
        } else
            setConfig(key, input.type === 'checkbox' ? Number(input.checked) : input.value);
    };

    const reset = document.createElement('a');
    reset.className = 'revert';
    reset.title = 'Reset to default';
    reset.tabIndex = 0;
    reset.onclick = function () {
        setConfig(key, null);
        showConfig(key);
        return false;
    };

    input.reset = reset;
    input.parentNode.appendChild(reset);
    showConfig(key);
}

var settingsInitialized = false;

// initialize options panel
function initSettings() {
    settingsInitialized = true;

    // options close button
    document.getElementById('options_close_button').onclick = function () {
        showOptions(false);
        return false;
    };

    // options submenu navigation
    const options = document.getElementById('options');
    const nav = document.getElementById('options_nav');
    let index = 0;
    for (var i = 0; i < nav.children.length; i++) {
        const a = nav.children[i].firstChild;
        a.onclick = function () {
            // clear current style
            nav.children[index].firstChild.classList.remove('current');
            options.getElementsByClassName('section')[index].classList.remove('current');
            // apply new current style
            index = Array.prototype.indexOf.call(nav.children, this.parentNode);
            nav.children[index].firstChild.classList.add('current');
            options.getElementsByClassName('section')[index].classList.add('current');
            // show custom css on advanced tab
            if (index === nav.children.length - 1) {
                const allcss = document.getElementById('all_css');
                allcss.value = '';
                for (var key in config) {
                    const css = (getStyle(key, getConfig(key)));
                    if (css && css.length < 1000 && key !== 'css')
                        allcss.value += css + '\n';
                }
            }
            // import/export
            if (index === nav.children.length - 2) {
                const exports = document.getElementById('options_export');
                const imports = document.getElementById('options_import');
                const replacer = function (key, value) {
                    if (key === 'options.background_image_file' || key === 'weather.cache') {
                        return undefined;
                    }
                    return value;
                };
                exports.value = JSON.stringify(localStorage, replacer);
                imports.value = '';
                imports.placeholder = 'Paste exported settings here';
                imports.onchange = function () {
                    try {
                        const imported = JSON.parse(imports.value);
                        for (let key in imported) {
                            localStorage.setItem(key, imported[key]);
                        }
                        imports.value = '';
                        imports.placeholder = 'Import successful!';
                        exports.value = JSON.stringify(localStorage, replacer);
                        loadSettings();
                        loadColumns();
                    } catch (e) {
                        imports.value = '';
                        imports.placeholder = 'Import error! Please check if your settings are valid JSON.';
                    }
                };
            }
            return false;
        };
    }

    // add options to hide bookmark folders
    chrome.bookmarks.getTree(function (result) {
        const placeholder = document.getElementById('options_show_bookmarks');
        const nodes = result[0].children;
        for (var i = 0; i < nodes.length; i++) {
            var key = 'show_' + nodes[i].id;
            config[key] = 1;

            const span = document.createElement('span');
            span.innerText = nodes[i].title;

            var input = document.createElement('input');
            input.type = 'checkbox';
            input.id = 'options_' + key;

            const label = document.createElement('label');
            label.appendChild(span);
            label.appendChild(input);
            placeholder.appendChild(label);
        }

        // replace text input with system font list
        if (chrome.fontSettings) {
            var input = document.getElementById('options_font');
            var select = document.createElement('select');
            input.parentNode.replaceChild(select, input);
            select.id = input.id;
        }

        // show settings
        for (var key in config)
            initConfig(key);

        loadSettings();

        // load themes
        var select = document.getElementById('options_theme');
        if (select.childNodes.length === 0) {
            for (var i in themes) {
                var option = document.createElement('option');
                option.innerText = i;
                if (i === getConfig('theme'))
                    option.selected = true;
                select.appendChild(option);
            }
        }

        // load font list
        if (chrome.fontSettings) {
            chrome.fontSettings.getFontList(function (fonts) {
                const select = document.getElementById('options_font');
                if (select.childNodes.length > 0)
                    return;

                fonts.unshift({fontId: 'Sans-serif'});
                for (let i = 0; i < fonts.length; i++) {
                    const font = fonts[i].fontId;
                    const option = document.createElement('option');
                    option.innerText = font;
                    if (font === getConfig('font'))
                        option.selected = true;
                    select.appendChild(option);
                }
            });
        }
    });
}

// show options panel
function showOptions(show) {
    document.getElementById('options').style.display = show ? 'block' : 'none';
    if (show) {
        if (!settingsInitialized)
            initSettings();
        for (let key in config)
            showConfig(key);
    }
}

// initialize page
loadSettings();
loadColumns();

// keyboard shortcuts
document.addEventListener('keypress', function (event) {
    if (event.keyCode === 13 && event.target && event.target.onclick && event.target.tagName === 'A') {
        event.target.dispatchEvent(new MouseEvent('click'));
        event.preventDefault();
    }
});
document.addEventListener('mousedown', function () {
    document.body.classList.add('hide-focus');
});
document.addEventListener('keydown', function () {
    document.body.classList.remove('hide-focus');
});

window.onresize = function () {
    updateTooltips();
};

// load options panel
document.getElementById('options_button').onclick = function () {
    showOptions(true);
    return false;
};
if (location.search === '?options')
    showOptions(true);

// refresh recently closed
if (chrome.sessions)
    chrome.sessions.onChanged.addListener(refreshClosed);

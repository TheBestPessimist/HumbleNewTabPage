'use strict';

/**
 * Service Worker for Humble New Tab Page
 * 
 * Responsibilities:
 * 1. Keep IndexedDB bookmark cache up-to-date
 * 2. Listen to all chrome.bookmarks events and trigger resync
 * 3. Periodic resync (hourly) in case service worker was killed
 * 4. Initial sync on extension install/update
 * 
 * The newtab.js page reads ONLY from the cache, never from chrome.bookmarks API.
 */

// Import the bookmark cache module
importScripts('bookmark-cache.js');

// Sync state
let syncInProgress = false;
let lastSyncAttempt = 0;
const SYNC_DEBOUNCE_MS = 1000; // Debounce rapid bookmark changes
const HOURLY_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SESSIONS_DEBOUNCE_MS = 10 * 1000; // 10 seconds debounce for session changes
let sessionsSyncTimeout = null;

/**
 * Perform a full bookmark sync with debouncing
 * @param {string} reason - Why the sync was triggered (for logging)
 */
async function triggerSync(reason) {
    const now = Date.now();

    // Debounce rapid changes
    if (now - lastSyncAttempt < SYNC_DEBOUNCE_MS) {
        console.log(`[BookmarkCache] Sync debounced (reason: ${reason})`);
        return;
    }

    // Prevent concurrent syncs
    if (syncInProgress) {
        console.log(`[BookmarkCache] Sync already in progress, skipping (reason: ${reason})`);
        return;
    }

    lastSyncAttempt = now;
    syncInProgress = true;

    try {
        console.log(`[BookmarkCache] Starting sync (reason: ${reason})`);
        const result = await BookmarkCache.fullSync();
        console.log(`[BookmarkCache] Sync complete: ${result.folderCount} folders in ${result.syncTime.toFixed(0)}ms`);
    } catch (error) {
        console.error(`[BookmarkCache] Sync failed:`, error);
    } finally {
        syncInProgress = false;
    }
}

/**
 * Check if cache needs sync and trigger if necessary
 */
async function checkAndSync() {
    try {
        const status = await BookmarkCache.getCacheStatus();

        if (!status.valid) {
            console.log('[BookmarkCache] Cache invalid or empty, triggering sync');
            await triggerSync('cache-invalid');
            return;
        }

        // Check if hourly sync is needed
        const hourAgo = Date.now() - HOURLY_SYNC_INTERVAL_MS;
        if (status.lastSync < hourAgo) {
            console.log('[BookmarkCache] Cache stale (>1 hour), triggering sync');
            await triggerSync('hourly-sync');
        }
    } catch (error) {
        console.error('[BookmarkCache] Error checking cache status:', error);
        await triggerSync('error-recovery');
    }
}

// =============================================================================
// CHROME BOOKMARK EVENT LISTENERS
// =============================================================================

// All bookmark changes trigger a full resync
// This is simpler and more reliable than incremental updates

// Use single handler factory to reduce code duplication
const createBookmarkHandler = (eventName, reason) => (id) => {
    console.log(`[BookmarkCache] ${eventName}: ${id}`);
    triggerSync(reason);
};

chrome.bookmarks.onCreated.addListener(createBookmarkHandler('Bookmark created', 'bookmark-created'));
chrome.bookmarks.onRemoved.addListener(createBookmarkHandler('Bookmark removed', 'bookmark-removed'));
chrome.bookmarks.onChanged.addListener(createBookmarkHandler('Bookmark changed', 'bookmark-changed'));
chrome.bookmarks.onMoved.addListener(createBookmarkHandler('Bookmark moved', 'bookmark-moved'));
chrome.bookmarks.onChildrenReordered.addListener(createBookmarkHandler('Children reordered', 'children-reordered'));

// =============================================================================
// EXTENSION LIFECYCLE EVENTS
// =============================================================================

// On install or update, sync immediately
chrome.runtime.onInstalled.addListener((details) => {
    console.log(`[BookmarkCache] Extension ${details.reason}`);
    triggerSync(`extension-${details.reason}`);
});

// On service worker startup, check if sync is needed
chrome.runtime.onStartup.addListener(() => {
    console.log('[BookmarkCache] Browser startup');
    checkAndSync();
});

// =============================================================================
// SESSIONS CACHING (closed tabs + other devices)
// =============================================================================

/**
 * Sync recently closed tabs to cache
 * @param {string} reason - Why the sync was triggered
 */
async function syncClosedTabs(reason) {
    try {
        // Get max 20 recently closed (we'll slice to user preference in newtab.js)
        const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 20 });
        const len = sessions.length;
        const closed = new Array(len);
        for (let i = 0; i < len; i++) {
            const session = sessions[i];
            // Normalize window with single tab to just a tab
            if (session.window?.tabs.length === 1) {
                session.tab = session.window.tabs[0];
            }
            closed[i] = {
                sessionId: session.window ? session.window.sessionId : session.tab.sessionId,
                title: session.tab ? session.tab.title : `${session.window.tabs.length} Tabs`,
                url: session.tab?.url ?? null,
                isWindow: !!session.window
            };
        }
        await BookmarkCache.setSpecialFolder('closed', closed);
        console.log(`[Sessions] Cached ${closed.length} closed tabs (reason: ${reason})`);
    } catch (error) {
        console.error('[Sessions] Failed to sync closed tabs:', error);
    }
}

/**
 * Sync other devices to cache
 * @param {string} reason - Why the sync was triggered
 */
async function syncDevices(reason) {
    try {
        const devices = await chrome.sessions.getDevices({ maxResults: 10 });
        const deviceData = devices.map(device => {
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
        await BookmarkCache.setSpecialFolder('devices', deviceData);
        console.log(`[Sessions] Cached ${deviceData.length} devices (reason: ${reason})`);
    } catch (error) {
        console.error('[Sessions] Failed to sync devices:', error);
    }
}

/**
 * Sync all session data (closed + devices)
 */
async function syncSessions(reason) {
    await Promise.all([
        syncClosedTabs(reason),
        syncDevices(reason)
    ]);
}

// Listen for session changes (debounced to avoid rapid syncs when closing multiple tabs)
chrome.sessions.onChanged.addListener(() => {
    if (sessionsSyncTimeout) {
        clearTimeout(sessionsSyncTimeout);
    }
    sessionsSyncTimeout = setTimeout(() => {
        console.log('[Sessions] Session changed (debounced)');
        syncSessions('session-changed');
        sessionsSyncTimeout = null;
    }, SESSIONS_DEBOUNCE_MS);
});

// =============================================================================
// PERIODIC SYNC USING ALARMS
// =============================================================================

const BOOKMARK_ALARM_NAME = 'bookmark-cache-sync';
const SESSIONS_ALARM_NAME = 'sessions-cache-sync';

// Create alarms
chrome.alarms.create(BOOKMARK_ALARM_NAME, {
    periodInMinutes: 60 // Hourly for bookmarks
});

chrome.alarms.create(SESSIONS_ALARM_NAME, {
    periodInMinutes: 1 // Every minute for sessions
});

// Handle alarms
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BOOKMARK_ALARM_NAME) {
        console.log('[BookmarkCache] Hourly alarm triggered');
        checkAndSync();
    } else if (alarm.name === SESSIONS_ALARM_NAME) {
        console.log('[Sessions] Minute alarm triggered');
        syncSessions('alarm');
    }
});

// =============================================================================
// INITIAL CHECK ON SCRIPT LOAD
// =============================================================================

// When service worker starts, check cache status and sync sessions
checkAndSync();
syncSessions('startup');

console.log('[BookmarkCache] Service worker initialized');

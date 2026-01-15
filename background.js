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

chrome.bookmarks.onCreated.addListener((id, bookmark) => {
    console.log(`[BookmarkCache] Bookmark created: ${id}`);
    triggerSync('bookmark-created');
});

chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
    console.log(`[BookmarkCache] Bookmark removed: ${id}`);
    triggerSync('bookmark-removed');
});

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
    console.log(`[BookmarkCache] Bookmark changed: ${id}`);
    triggerSync('bookmark-changed');
});

chrome.bookmarks.onMoved.addListener((id, moveInfo) => {
    console.log(`[BookmarkCache] Bookmark moved: ${id}`);
    triggerSync('bookmark-moved');
});

chrome.bookmarks.onChildrenReordered.addListener((id, reorderInfo) => {
    console.log(`[BookmarkCache] Children reordered: ${id}`);
    triggerSync('children-reordered');
});

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
// PERIODIC SYNC USING ALARMS
// =============================================================================

const ALARM_NAME = 'bookmark-cache-sync';

// Create hourly alarm
chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: 60
});

// Handle alarm
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        console.log('[BookmarkCache] Hourly alarm triggered');
        checkAndSync();
    }
});

// =============================================================================
// INITIAL CHECK ON SCRIPT LOAD
// =============================================================================

// When service worker starts, check cache status
checkAndSync();

console.log('[BookmarkCache] Service worker initialized');


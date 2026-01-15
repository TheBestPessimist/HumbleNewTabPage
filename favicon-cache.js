/**
 * Favicon Module - Uses Chrome's built-in favicon cache
 */

'use strict';

const FaviconCache = (function () {
    function getFaviconUrl(pageUrl, size) {
        return '/_favicon/?pageUrl=' + encodeURIComponent(pageUrl) + '&size=' + (size || 16);
    }

    function get(pageUrl, size) {
        return Promise.resolve(getFaviconUrl(pageUrl, size || 16));
    }

    function createIcon(pageUrl, size) {
        size = size || 16;
        const img = document.createElement('img');
        img.className = 'icon';
        img.alt = ' ';
        img.width = size;
        img.height = size;
        // Defer loading: store URL in data-src, activate later after bookmarks are painted
        img.dataset.src = getFaviconUrl(pageUrl, size);
        return img;
    }

    // Activate all deferred favicons by moving data-src to src
    function activateFavicons() {
        const deferredIcons = document.querySelectorAll('img.icon[data-src]');
        deferredIcons.forEach(img => {
            img.src = img.dataset.src;
            delete img.dataset.src;
        });
    }

    return {
        get: get,
        createIcon: createIcon,
        activateFavicons: activateFavicons,
    };
})();

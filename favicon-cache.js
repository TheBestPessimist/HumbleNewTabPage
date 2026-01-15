/**
 * Favicon Module - Uses Chrome's built-in favicon cache
 */

'use strict';

const FaviconCache = {
    createIcon(pageUrl, size = 16) {
        const img = document.createElement('img');
        img.className = 'icon';
        img.alt = ' ';
        img.width = size;
        img.height = size;
        // Defer loading: store URL in data-src, activate later after bookmarks are painted
        img.dataset.src = `/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
        return img;
    },

    // Activate all deferred favicons by moving data-src to src
    activateFavicons() {
        document.querySelectorAll('img.icon[data-src]').forEach(img => {
            img.src = img.dataset.src;
            delete img.dataset.src;
        });
    }
};

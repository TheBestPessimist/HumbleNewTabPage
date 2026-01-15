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
        img.src = `/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
        return img;
    }
};

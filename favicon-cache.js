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
        img.src = getFaviconUrl(pageUrl, size);
        return img;
    }

    return {
        get: get,
        createIcon: createIcon,
    };
})();

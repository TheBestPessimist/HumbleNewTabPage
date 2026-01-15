// Apply critical styles immediately to prevent white flash
// This runs before body renders, reading from localStorage
(function() {
    // Performance: Record when this script runs (relative to navigation start)
    window.__earlyStylesTime = performance.now();
    console.log('[PERF:EARLY] early-styles.js running at: ' + window.__earlyStylesTime.toFixed(2) + 'ms after navigation');
    const themes = {
        Classic: { background_color: '#ffffff', font_color: '#000000' },
        Dusk: { background_color: '#56546b', font_color: '#c8b9be' },
        Elegant: { background_color: '#f6f6f6', font_color: '#888888' },
        Frosty: { background_color: '#e4eef3', font_color: '#3e5e82' },
        Hacker: { background_color: '#000000', font_color: '#00ff00' },
        Melon: { background_color: '#f8ffe1', font_color: '#594526' },
        Midnight: { background_color: '#101827', font_color: '#bfdfff' },
        Slate: { background_color: '#b7babf', font_color: '#555555' },
        Trees: { background_color: '#566157', font_color: '#cdd088' },
        Valentine: { background_color: '#eae1ff', font_color: '#895fc2' },
        Warm: { background_color: '#ffeedd', font_color: '#824100' }
    };
    const themeName = localStorage.getItem('options.theme');
    const theme = themes[themeName] || {};
    const bgColor = localStorage.getItem('options.background_color') || theme.background_color || '#ffffff';
    const fontColor = localStorage.getItem('options.font_color') || theme.font_color || '#555555';
    document.documentElement.style.setProperty('--initial-bg', bgColor);
    document.documentElement.style.setProperty('--initial-color', fontColor);
    // Apply immediately via style element for fastest paint
    const style = document.createElement('style');
    style.id = 'early-styles';
    style.textContent = 'body{background-color:' + bgColor + '}#main a{color:' + fontColor + '}';
    document.head.appendChild(style);
})();

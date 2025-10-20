/**
 * Main Entry Point
 * 
 * Initializes the timeline extension and manages SPA navigation
 * 
 * Features:
 * - Site detection and adapter loading
 * - History API hooks for better SPA support
 * - Route change detection
 * - Timeline lifecycle management
 */

// --- Entry Point and SPA Navigation Handler ---
let timelineManagerInstance = null;
let currentUrl = location.href;
let initVersion = 0; // Version number for initialization, increments on URL change
let pageObserver = null;
let routeCheckIntervalId = null;
let routeListenersAttached = false;
let adapterRegistry = new SiteAdapterRegistry();
let currentAdapter = null;

// Hook history methods for better SPA detection (more efficient than polling)
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function(...args) {
    originalPushState.apply(this, args);
    setTimeout(handleUrlChange, 0);
};

history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    setTimeout(handleUrlChange, 0);
};

// Check if current route is a conversation page (uses adapter)
function isConversationRoute(pathname = location.pathname) {
    if (!currentAdapter) {
        currentAdapter = adapterRegistry.detectAdapter();
    }
    return currentAdapter ? currentAdapter.isConversationRoute(pathname) : false;
}

// Helper function: sleep for specified milliseconds
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function: lightweight check if timeline can be initialized
function canInitialize() {
    if (!currentAdapter) {
        currentAdapter = adapterRegistry.detectAdapter();
    }
    if (!currentAdapter) return false;
    
    const selector = currentAdapter.getUserMessageSelector();
    return document.querySelector(selector) !== null;
}

// Initialize timeline with retry mechanism (exponential backoff)
async function initWithRetry(version, delays, retryIndex = 0) {
    // Check if we've exceeded max retries
    if (retryIndex >= delays.length) {
        return;
    }
    
    // Wait for the specified delay
    await sleep(delays[retryIndex]);
    
    // Check if version is still current (user may have navigated away)
    if (version !== initVersion) {
        return; // Version mismatch, cancel this retry
    }
    
    // Double-check we're still on a conversation route
    if (!isConversationRoute()) {
        return;
    }
    
    // Lightweight check: can we initialize?
    if (canInitialize()) {
        // Yes! Initialize the timeline
        initializeTimeline();
        return;
    }
    
    // No, retry with next delay
    await initWithRetry(version, delays, retryIndex + 1);
}

function attachRouteListenersOnce() {
    if (routeListenersAttached) return;
    routeListenersAttached = true;
    
    TimelineUtils.removeEventListenerSafe(window, 'popstate', handleUrlChange);
    TimelineUtils.removeEventListenerSafe(window, 'hashchange', handleUrlChange);
    
    try { window.addEventListener('popstate', handleUrlChange); } catch {}
    try { window.addEventListener('hashchange', handleUrlChange); } catch {}
    
    // Lightweight polling fallback (less frequent now that we hook history methods)
    routeCheckIntervalId = TimelineUtils.clearIntervalSafe(routeCheckIntervalId);
    try {
        routeCheckIntervalId = setInterval(() => {
            if (location.href !== currentUrl) handleUrlChange();
        }, TIMELINE_CONFIG.ROUTE_CHECK_INTERVAL);
    } catch {}
}

function detachRouteListeners() {
    if (!routeListenersAttached) return;
    routeListenersAttached = false;
    
    TimelineUtils.removeEventListenerSafe(window, 'popstate', handleUrlChange);
    TimelineUtils.removeEventListenerSafe(window, 'hashchange', handleUrlChange);
    routeCheckIntervalId = TimelineUtils.clearIntervalSafe(routeCheckIntervalId);
}

function cleanupGlobalObservers() {
    TimelineUtils.disconnectObserverSafe(pageObserver);
    pageObserver = null;
}

function initializeTimeline() {
    // Detect current site adapter
    currentAdapter = adapterRegistry.detectAdapter();
    if (!currentAdapter) {
        return;
    }

    if (timelineManagerInstance) {
        try { timelineManagerInstance.destroy(); } catch {}
        timelineManagerInstance = null;
    }
    
    // Remove any leftover UI before creating a new instance
    TimelineUtils.removeElementSafe(document.querySelector('.chat-timeline-bar'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-left-slider'));
    TimelineUtils.removeElementSafe(document.getElementById('chat-timeline-tooltip'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-starred-btn'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-starred-panel'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-star-chat-btn-native'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-star-chat-btn-fixed'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-theme-dialog-overlay'));
    
    try {
        timelineManagerInstance = new TimelineManager(currentAdapter);
        timelineManagerInstance.init().catch(err => {});
    } catch (err) {
    }
}

function handleUrlChange() {
    // 检测 URL 是否变化
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    initVersion++;

    // URL 变化了，先清理旧时间轴
    if (timelineManagerInstance) {
        try { timelineManagerInstance.destroy(); } catch {}
        timelineManagerInstance = null;
    }
    TimelineUtils.removeElementSafe(document.querySelector('.chat-timeline-bar'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-left-slider'));
    TimelineUtils.removeElementSafe(document.getElementById('chat-timeline-tooltip'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-starred-btn'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-starred-panel'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-star-chat-btn-native'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-star-chat-btn-fixed'));
    TimelineUtils.removeElementSafe(document.querySelector('.timeline-theme-dialog-overlay'));
    cleanupGlobalObservers();

    // 如果当前是对话 URL，重新初始化
    if (isConversationRoute()) {
        const currentVersion = initVersion;
        initWithRetry(currentVersion, TIMELINE_CONFIG.INIT_RETRY_DELAYS);
    }
    // 如果不是对话 URL，只清理（上面已经做了）
}

// Check if current site is supported before initializing
if (!adapterRegistry.isSupportedSite()) {
} else {
    currentAdapter = adapterRegistry.detectAdapter();
    
    // ✅ 修复：先检查DOM中是否已存在用户消息（SPA路由切换场景）
    const checkAndInit = () => {
        const selector = currentAdapter ? currentAdapter.getUserMessageSelector() : null;
        if (selector && document.querySelector(selector)) {
            if (isConversationRoute()) {
                // Use retry mechanism for initial load as well
                initVersion++;
                const currentVersion = initVersion;
                initWithRetry(currentVersion, TIMELINE_CONFIG.INIT_RETRY_DELAYS);
            }
            
            // Create a single managed pageObserver
            pageObserver = new MutationObserver(handleUrlChange);
            try { pageObserver.observe(document.body, { childList: true, subtree: true }); } catch {}
            attachRouteListenersOnce();
            
            return true; // 已初始化
        }
        return false; // 未初始化
    };
    
    // ✅ 修复：立即检查一次（处理SPA路由切换到对话页的情况）
    if (checkAndInit()) {
        // 已经初始化成功，不需要observer
    } else {
        // 还没有用户消息，设置observer等待
        const initialObserver = new MutationObserver(() => {
            if (checkAndInit()) {
                // 初始化成功，断开observer
                TimelineUtils.disconnectObserverSafe(initialObserver);
            }
        });
        try { initialObserver.observe(document.body, { childList: true, subtree: true }); } catch {}
    }
}

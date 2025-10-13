/**
 * Common Utilities and Configuration
 * 
 * This file contains:
 * - TIMELINE_CONFIG: All timing and behavior constants
 * - TimelineUtils: Safe wrapper functions for common operations
 */

// ==================== Configuration ====================

const TIMELINE_CONFIG = {
    // Active state management
    MIN_ACTIVE_CHANGE_INTERVAL: 120, // ms - minimum interval between active state changes
    
    // UI interaction timings
    TOOLTIP_HIDE_DELAY: 100, // ms - delay before hiding tooltip
    DEBOUNCE_DELAY: 350, // ms - debounce delay for marker recalculation
    LONG_PRESS_DURATION: 550, // ms - duration to trigger long press
    LONG_PRESS_TOLERANCE: 6, // px - movement tolerance during long press
    CLICK_SUPPRESS_DURATION: 350, // ms - suppress clicks after long press
    
    // Slider behavior
    SLIDER_FADE_DELAY: 1000, // ms - delay before fading slider
    
    // Resize and layout
    RESIZE_IDLE_DELAY: 140, // ms - settle time before min-gap correction
    RESIZE_IDLE_TIMEOUT: 200, // ms - timeout for requestIdleCallback
    
    // Route detection
    ROUTE_CHECK_INTERVAL: 800, // ms - polling interval for URL changes
    INIT_DELAY: 300, // ms - delay before initializing timeline (deprecated, use INIT_RETRY_DELAYS)
    INIT_RETRY_DELAYS: [500, 500, 1000, 1000, 1000, 1000], // ms - retry delays for initialization (exponential backoff)
    INITIAL_RENDER_DELAY: 100, // ms - delay before first render to ensure DOM stability
    
    // Observers
    OBSERVER_TIMEOUT: 5000, // ms - timeout for mutation observers
    ZERO_TURNS_TIMER: 350, // ms - wait before clearing UI when no turns found
    
    // Virtualization
    VIRTUAL_BUFFER_MIN: 100, // px - minimum buffer for virtualization
    
    // CSS detection
    CSS_VAR_DETECTION_TOLERANCE: 2, // px - tolerance for CSS var support detection
};

// ==================== Utility Functions ====================

const TimelineUtils = {
    /**
     * Safely clear a timeout
     */
    clearTimerSafe(timer) {
        try {
            if (timer) {
                clearTimeout(timer);
            }
        } catch {}
        return null;
    },

    /**
     * Safely clear an interval
     */
    clearIntervalSafe(intervalId) {
        try {
            if (intervalId) {
                clearInterval(intervalId);
            }
        } catch {}
        return null;
    },

    /**
     * Safely cancel a requestAnimationFrame
     */
    clearRafSafe(rafId) {
        try {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }
        } catch {}
        return null;
    },

    /**
     * Safely cancel a requestIdleCallback
     */
    clearIdleCallbackSafe(ricId) {
        try {
            if (ricId && typeof cancelIdleCallback === 'function') {
                cancelIdleCallback(ricId);
            }
        } catch {}
        return null;
    },

    /**
     * Safely disconnect an observer
     */
    disconnectObserverSafe(observer) {
        try {
            if (observer) {
                observer.disconnect();
            }
        } catch {}
    },

    /**
     * Safely remove a DOM element
     */
    removeElementSafe(element) {
        try {
            if (element) {
                element.remove();
            }
        } catch {}
    },

    /**
     * Safely remove an event listener
     */
    removeEventListenerSafe(target, event, handler, options) {
        try {
            if (target && handler) {
                target.removeEventListener(event, handler, options);
            }
        } catch {}
    },

    /**
     * Safely add a CSS class
     */
    addClassSafe(element, className) {
        try {
            if (element) {
                element.classList.add(className);
            }
        } catch {}
    },

    /**
     * Safely remove a CSS class
     */
    removeClassSafe(element, className) {
        try {
            if (element) {
                element.classList.remove(className);
            }
        } catch {}
    },

    /**
     * Safely toggle a CSS class
     */
    toggleClassSafe(element, className, force) {
        try {
            if (element) {
                element.classList.toggle(className, force);
            }
        } catch {}
    },

    /**
     * Safely set an attribute
     */
    setAttributeSafe(element, name, value) {
        try {
            if (element) {
                element.setAttribute(name, value);
            }
        } catch {}
    },
};

// ==================== Storage Adapter ====================

/**
 * Storage Adapter - 跨网站存储
 * 
 * 优先使用 chrome.storage.sync（跨网站、跨设备同步）
 * 降级到 chrome.storage.local（跨网站、本地存储）
 * 最后降级到 localStorage（仅当前网站）
 */
const StorageAdapter = {
    /**
     * 检查是否支持 chrome.storage
     */
    isChromeStorageAvailable() {
        return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
    },

    /**
     * 获取存储的值
     * @param {string} key - 存储键名
     * @returns {Promise<any>} - 返回存储的值
     */
    async get(key) {
        try {
            if (this.isChromeStorageAvailable()) {
                // 使用 chrome.storage.sync（跨网站、跨设备）
                return new Promise((resolve) => {
                    chrome.storage.sync.get([key], (result) => {
                        resolve(result[key]);
                    });
                });
            } else {
                // 降级到 localStorage（仅当前网站）
                const value = localStorage.getItem(key);
                return value ? JSON.parse(value) : undefined;
            }
        } catch (e) {
            return undefined;
        }
    },

    /**
     * 设置存储的值
     * @param {string} key - 存储键名
     * @param {any} value - 要存储的值
     * @returns {Promise<void>}
     */
    async set(key, value) {
        try {
            if (this.isChromeStorageAvailable()) {
                // 使用 chrome.storage.sync（跨网站、跨设备）
                return new Promise((resolve) => {
                    chrome.storage.sync.set({ [key]: value }, () => {
                        resolve();
                    });
                });
            } else {
                // 降级到 localStorage（仅当前网站）
                localStorage.setItem(key, JSON.stringify(value));
            }
        } catch (e) {
            // Silently fail
        }
    },

    /**
     * 删除存储的值
     * @param {string} key - 存储键名
     * @returns {Promise<void>}
     */
    async remove(key) {
        try {
            if (this.isChromeStorageAvailable()) {
                // 使用 chrome.storage.sync（跨网站、跨设备）
                return new Promise((resolve) => {
                    chrome.storage.sync.remove([key], () => {
                        resolve();
                    });
                });
            } else {
                // 降级到 localStorage（仅当前网站）
                localStorage.removeItem(key);
            }
        } catch (e) {
            // Silently fail
        }
    },

    /**
     * 获取所有匹配前缀的键值对
     * @param {string} prefix - 键名前缀
     * @returns {Promise<Object>} - 返回匹配的键值对对象
     */
    async getAllByPrefix(prefix) {
        try {
            if (this.isChromeStorageAvailable()) {
                // 使用 chrome.storage.sync（跨网站、跨设备）
                return new Promise((resolve) => {
                    chrome.storage.sync.get(null, (items) => {
                        const result = {};
                        Object.keys(items).forEach(key => {
                            if (key.startsWith(prefix)) {
                                result[key] = items[key];
                            }
                        });
                        resolve(result);
                    });
                });
            } else {
                // 降级到 localStorage（仅当前网站）
                const result = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(prefix)) {
                        try {
                            result[key] = JSON.parse(localStorage.getItem(key));
                        } catch {
                            result[key] = localStorage.getItem(key);
                        }
                    }
                }
                return result;
            }
        } catch (e) {
            return {};
        }
    },

    /**
     * 监听存储变化
     * @param {Function} callback - 回调函数 (changes, areaName) => {}
     */
    addChangeListener(callback) {
        try {
            if (this.isChromeStorageAvailable()) {
                chrome.storage.onChanged.addListener(callback);
            } else {
                // localStorage 的 storage 事件只能监听其他标签页的变化
                // 需要包装 callback 以适配 storage 事件格式
                const storageHandler = (e) => {
                    if (e.storageArea === localStorage) {
                        try {
                            callback({
                                [e.key]: {
                                    oldValue: e.oldValue ? JSON.parse(e.oldValue) : undefined,
                                    newValue: e.newValue ? JSON.parse(e.newValue) : undefined
                                }
                            }, 'local');
                        } catch (err) {
                            // Silently fail
                        }
                    }
                };
                // 保存原始 handler 的引用以便后续移除
                callback._storageHandler = storageHandler;
                window.addEventListener('storage', storageHandler);
            }
        } catch (e) {
            // Silently fail
        }
    },

    /**
     * 移除存储变化监听器
     * @param {Function} callback - 之前添加的回调函数
     */
    removeChangeListener(callback) {
        try {
            if (this.isChromeStorageAvailable()) {
                chrome.storage.onChanged.removeListener(callback);
            } else {
                // 移除 localStorage 的 storage 事件监听器
                if (callback._storageHandler) {
                    window.removeEventListener('storage', callback._storageHandler);
                    delete callback._storageHandler;
                }
            }
        } catch (e) {
            // Silently fail
        }
    }
};


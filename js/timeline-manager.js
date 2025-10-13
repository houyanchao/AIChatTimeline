/**
 * Timeline Manager - Core Class
 * 
 * This is the heart of the timeline extension
 * Manages all UI, interactions, virtualization, and state
 * 
 * Responsibilities:
 * - Timeline UI injection and management
 * - Marker calculation and rendering
 * - Event handling (click, hover, long-press)
 * - Scroll synchronization
 * - Tooltip management
 * - Star/highlight persistence
 * - Virtual rendering for performance
 */

class TimelineManager {
    constructor(adapter) {
        if (!adapter) {
            throw new Error('TimelineManager requires a SiteAdapter');
        }
        this.adapter = adapter;
        this.scrollContainer = null;
        this.conversationContainer = null;
        this.markers = [];
        this.activeTurnId = null;
        this.ui = { timelineBar: null, tooltip: null, track: null, trackContent: null, slider: null, sliderHandle: null };
        this.isScrolling = false;

        this.mutationObserver = null;
        this.resizeObserver = null;
        this.intersectionObserver = null;
        this.visibleUserTurns = new Set();
        
        // Event handlers
        this.onTimelineBarClick = null;
        this.onScroll = null;
        this.onTimelineBarOver = null;
        this.onTimelineBarOut = null;
        this.onTimelineBarFocusIn = null;
        this.onTimelineBarFocusOut = null;
        this.onTooltipEnter = null; // ✅ 需求2：tooltip 悬停事件
        this.onTooltipLeave = null; // ✅ 需求2：tooltip 离开事件
        this.onWindowResize = null;
        this.onTimelineWheel = null;
        this.onSliderDown = null;
        this.onSliderMove = null;
        this.onSliderUp = null;
        this.onStorage = null;
        this.onVisualViewportResize = null;
        this.onBarEnter = null;
        this.onBarLeave = null;
        this.onSliderEnter = null;
        this.onSliderLeave = null;
        // Timers and RAF IDs
        this.scrollRafId = null;
        this.activeChangeTimer = null;
        this.tooltipHideTimer = null;
        this.showRafId = null;
        this.sliderFadeTimer = null;
        this.resizeIdleTimer = null;
        this.resizeIdleRICId = null;
        this.zeroTurnsTimer = null;

        // Active state management
        this.lastActiveChangeTime = 0;
        this.pendingActiveId = null;
        
        // Tooltip and measurement
        this.measureEl = null;
        this.truncateCache = new Map();
        this.measureCanvas = null;
        this.measureCtx = null;
        
        // ✅ 优化：Tooltip 配置缓存（避免频繁读取 CSS 变量）
        this.tooltipConfigCache = null;
        
        // ✅ 优化：Tooltip 更新防抖（快速移动时避免闪烁）
        this.tooltipUpdateDebounceTimer = null;

        // Long-canvas scrollable track (Linked mode)
        this.scale = 1;
        this.contentHeight = 0;
        this.yPositions = [];
        this.visibleRange = { start: 0, end: -1 };
        this.firstUserTurnOffset = 0;
        this.contentSpanPx = 1;
        this.usePixelTop = false;
        this._cssVarTopSupported = null;

        // Left-side slider
        this.sliderDragging = false;
        this.sliderAlwaysVisible = false;
        this.markersVersion = 0;

        // Performance debugging
        this.debugPerf = false;
        try { this.debugPerf = (localStorage.getItem('chatgptTimelineDebugPerf') === '1'); } catch {}
        
        this.debouncedRecalculateAndRender = this.debounce(this.recalculateAndRenderMarkers, TIMELINE_CONFIG.DEBOUNCE_DELAY);

        // Star/Highlight feature state
        this.starred = new Set();
        this.markerMap = new Map();
        this.conversationId = this.adapter.extractConversationId(location.pathname);
        // 临时存储加载的收藏 index（在 markers 创建前）
        this.starredIndexes = new Set();
        
        // ✅ URL 到网站信息的映射字典（包含名称和颜色）
        this.siteNameMap = {
            'chatgpt.com': { name: 'ChatGPT', color: '#10A37F' },
            'chat.openai.com': { name: 'ChatGPT', color: '#10A37F' },
            'gemini.google.com': { name: 'Gemini', color: '#4285F4' },
            'doubao.com': { name: '豆包', color: '#7C3AED' },
            'chat.deepseek.com': { name: 'DeepSeek', color: '#3B82F6' },
            'yiyan.baidu.com': { name: '文心一言', color: '#EF4444' },
            'tongyi.com': { name: '通义千问', color: '#F59E0B' },
            'kimi.com': { name: 'Kimi', color: '#8B5CF6' },
            'kimi.moonshot.cn': { name: 'Kimi', color: '#8B5CF6' },
            'yuanbao.tencent.com': { name: '元宝', color: '#10B981' }
        };
    }

    perfStart(name) {
        if (!this.debugPerf) return;
        try { performance.mark(`tg-${name}-start`); } catch {}
    }

    perfEnd(name) {
        if (!this.debugPerf) return;
        try {
            performance.mark(`tg-${name}-end`);
            performance.measure(`tg-${name}`, `tg-${name}-start`, `tg-${name}-end`);
        } catch {}
    }

    async init() {
        const elementsFound = await this.findCriticalElements();
        if (!elementsFound) return;
        
        this.injectTimelineUI();
        this.setupEventListeners();
        this.setupObservers();
        // Load persisted star markers for current conversation
        this.conversationId = this.adapter.extractConversationId(location.pathname);
        await this.loadStars();
        
        // Trigger initial rendering after a short delay to ensure DOM is stable
        // This fixes the bug where nodes don't appear until scroll
        setTimeout(async () => {
            this.recalculateAndRenderMarkers();
            // 初始化后手动触发一次滚动同步，确保激活状态正确
            this.scheduleScrollSync();
            
            // ✅ 等待时间轴渲染完成后，再显示收藏按钮
            // 使用双重 requestAnimationFrame 确保浏览器完成绘制
            requestAnimationFrame(() => {
                requestAnimationFrame(async () => {
                    // 此时浏览器已经完成时间轴的渲染
                    await this.updateStarredBtnVisibility();
                });
            });
        }, TIMELINE_CONFIG.INITIAL_RENDER_DELAY);
    }
    
    async findCriticalElements() {
        const selector = this.adapter.getUserMessageSelector();
        const firstTurn = await this.waitForElement(selector);
        if (!firstTurn) return false;
        
        this.conversationContainer = this.adapter.findConversationContainer(firstTurn);
        if (!this.conversationContainer) return false;

        let parent = this.conversationContainer;
        while (parent && parent !== document.body) {
            const style = window.getComputedStyle(parent);
            const overflowY = style.overflowY;
            if (overflowY === 'auto' || overflowY === 'scroll') {
                this.scrollContainer = parent;
                break;
            }
            parent = parent.parentElement;
        }
        
        // 如果没找到滚动容器，使用 document 作为备用（通用方案）
        if (!this.scrollContainer) {
            this.scrollContainer = document.scrollingElement || document.documentElement || document.body;
        }
        
        return this.scrollContainer !== null;
    }
    
    injectTimelineUI() {
        // Idempotent: ensure bar exists, then ensure track + content exist
        let timelineBar = document.querySelector('.chat-timeline-bar');
        if (!timelineBar) {
            timelineBar = document.createElement('div');
            timelineBar.className = 'chat-timeline-bar';
            document.body.appendChild(timelineBar);
        }
        this.ui.timelineBar = timelineBar;
        
        // Apply site-specific position from adapter
        const position = this.adapter.getTimelinePosition();
        if (position) {
            if (position.top) timelineBar.style.top = position.top;
            if (position.right) timelineBar.style.right = position.right;
            if (position.bottom) {
                // ✅ 修复：确保高度至少为 200px，避免窗口太小导致时间轴高度为 0
                // 使用 max() 函数确保即使 calc 结果为负数，也会有最小高度
                timelineBar.style.height = `max(200px, calc(100vh - ${position.top} - ${position.bottom}))`;
            }
        }
        // Track + content
        let track = this.ui.timelineBar.querySelector('.timeline-track');
        if (!track) {
            track = document.createElement('div');
            track.className = 'timeline-track';
            this.ui.timelineBar.appendChild(track);
        }
        let trackContent = track.querySelector('.timeline-track-content');
        if (!trackContent) {
            trackContent = document.createElement('div');
            trackContent.className = 'timeline-track-content';
            track.appendChild(trackContent);
        }
        this.ui.track = track;
        this.ui.trackContent = trackContent;
        // Ensure external left-side slider exists (outside the bar)
        let slider = document.querySelector('.timeline-left-slider');
        if (!slider) {
            slider = document.createElement('div');
            slider.className = 'timeline-left-slider';
            const handle = document.createElement('div');
            handle.className = 'timeline-left-handle';
            slider.appendChild(handle);
            document.body.appendChild(slider);
        }
        this.ui.slider = slider;
        this.ui.sliderHandle = slider.querySelector('.timeline-left-handle');
        // Visibility will be controlled by updateSlider() based on scrollable state
        if (!this.ui.tooltip) {
            const tip = document.createElement('div');
            tip.className = 'timeline-tooltip';
            tip.setAttribute('role', 'tooltip');
            tip.id = 'chat-timeline-tooltip';
            document.body.appendChild(tip);
            this.ui.tooltip = tip;
        }
        // ✅ 重新设计：测量元素应该模拟内容区的样式
        if (!this.measureEl) {
            const m = document.createElement('div');
            m.setAttribute('aria-hidden', 'true');
            m.style.position = 'fixed';
            m.style.left = '-9999px';
            m.style.top = '0px';
            m.style.visibility = 'hidden';
            m.style.pointerEvents = 'none';
            
            // ✅ 关键：模拟内容区的样式，而不是 tooltip 外层
            const cs = getComputedStyle(this.ui.tooltip);
            Object.assign(m.style, {
                fontFamily: cs.fontFamily,
                fontSize: cs.fontSize,
                lineHeight: cs.lineHeight || '18px',
                // ✅ 内容区的 padding（重要！）
                padding: '10px 12px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxWidth: 'none',
                display: 'block',
            });
            
            document.body.appendChild(m);
            this.measureEl = m;
        }
        // Create canvas for text layout based truncation (primary)
        if (!this.measureCanvas) {
            this.measureCanvas = document.createElement('canvas');
            this.measureCtx = this.measureCanvas.getContext('2d');
        }
        
        // ✅ 优化：延迟到下一帧缓存 CSS 变量（确保样式已应用）
        requestAnimationFrame(() => {
            this.cacheTooltipConfig();
        });
        
        // ✅ 添加收藏按钮（在 timeline-bar 下方 10px 处，垂直居中对齐）
        let starredBtn = document.querySelector('.timeline-starred-btn');
        let isReusedBtn = false;
        if (!starredBtn) {
            starredBtn = document.createElement('button');
            starredBtn.className = 'timeline-starred-btn';
            starredBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 26 26"><path fill="rgb(255, 125, 3)" stroke="rgb(255, 125, 3)" stroke-width="0.5" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
            starredBtn.setAttribute('title', chrome.i18n.getMessage('viewStarred'));
            starredBtn.setAttribute('aria-label', chrome.i18n.getMessage('viewStarred'));
            // ✅ 初始状态：隐藏，等时间轴渲染完成后再显示
            starredBtn.style.display = 'none';
            document.body.appendChild(starredBtn);
        } else {
            // ✅ 修复：复用的元素，clone后替换，清除旧的事件监听器
            isReusedBtn = true;
            const newBtn = starredBtn.cloneNode(true);
            starredBtn.replaceWith(newBtn);
            starredBtn = newBtn;
        }
        this.ui.starredBtn = starredBtn;
        
        // ✅ 动态设置收藏按钮位置，与 timeline-bar 垂直居中对齐
        if (position) {
            // 1. 计算 bottom 位置
            if (position.bottom) {
                const bottomValue = parseInt(position.bottom, 10) || 100;
                // 收藏按钮在 timeline-bar 下方 10px，按钮高度 22px
                starredBtn.style.bottom = `${bottomValue - 10 - 22}px`;
            }
            
            // 2. 计算 right 位置，使两者中心对齐
            // timeline-bar: width=24px, right=position.right
            // 收藏按钮: width=22px
            // 中心对齐: timelineBarRight + 24/2 = starredBtnRight + 22/2
            // 所以: starredBtnRight = timelineBarRight + 12 - 11 = timelineBarRight + 1
            if (position.right) {
                const timelineBarRight = parseInt(position.right, 10) || 20;
                const starredBtnRight = timelineBarRight + 1; // 24/2 - 22/2 = 1
                starredBtn.style.right = `${starredBtnRight}px`;
            }
        }
        
        // ✅ 修复：先查询 DOM，避免重复创建收藏面板
        let starredPanel = document.querySelector('.timeline-starred-panel');
        if (!starredPanel) {
            starredPanel = document.createElement('div');
            starredPanel.className = 'timeline-starred-panel';
            starredPanel.innerHTML = `
                <div class="timeline-starred-content">
                    <div class="timeline-starred-header">
                        <h3>${chrome.i18n.getMessage('starredList')}</h3>
                        <button class="timeline-starred-close" aria-label="${chrome.i18n.getMessage('close')}">×</button>
                    </div>
                    <div class="timeline-starred-list"></div>
                </div>
            `;
            document.body.appendChild(starredPanel);
        } else {
            // ✅ 修复：复用的元素，clone后替换，清除旧的事件监听器
            const newPanel = starredPanel.cloneNode(true);
            starredPanel.replaceWith(newPanel);
            starredPanel = newPanel;
        }
        this.ui.starredPanel = starredPanel;
        this.ui.starredList = starredPanel.querySelector('.timeline-starred-list');
        this.ui.starredClose = starredPanel.querySelector('.timeline-starred-close');
    }
    
    /**
     * ✅ 优化：缓存 Tooltip CSS 变量
     * 避免每次显示 Tooltip 时都调用 getComputedStyle（成本高）
     */
    cacheTooltipConfig() {
        const tip = this.ui.tooltip;
        if (!tip) return;
        
        try {
            this.tooltipConfigCache = {
                arrowOut: this.getCSSVarNumber(tip, '--timeline-tooltip-arrow-outside', 6),
                baseGap: this.getCSSVarNumber(tip, '--timeline-tooltip-gap-visual', 12),
                boxGap: this.getCSSVarNumber(tip, '--timeline-tooltip-gap-box', 8),
                lineH: this.getCSSVarNumber(tip, '--timeline-tooltip-lh', 18),
                padY: this.getCSSVarNumber(tip, '--timeline-tooltip-pad-y', 10),
                borderW: this.getCSSVarNumber(tip, '--timeline-tooltip-border-w', 1),
                maxW: this.getCSSVarNumber(tip, '--timeline-tooltip-max', 288),
            };
        } catch (e) {
            // 使用默认值
            this.tooltipConfigCache = {
                arrowOut: 6,
                baseGap: 12,
                boxGap: 8,
                lineH: 18,
                padY: 10,
                borderW: 1,
                maxW: 288,
            };
        }
    }

    recalculateAndRenderMarkers() {
        this.perfStart('recalc');
        if (!this.conversationContainer || !this.ui.timelineBar || !this.scrollContainer) return;

        const selector = this.adapter.getUserMessageSelector();
        let userTurnElements = this.conversationContainer.querySelectorAll(selector);
        
        // Reset visible window to avoid cleaning with stale indices after rebuild
        this.visibleRange = { start: 0, end: -1 };
        // If the conversation is transiently empty (branch switching), don't wipe UI immediately
        if (userTurnElements.length === 0) {
            if (!this.zeroTurnsTimer) {
                this.zeroTurnsTimer = setTimeout(() => {
                    this.zeroTurnsTimer = null;
                    this.recalculateAndRenderMarkers();
                }, TIMELINE_CONFIG.ZERO_TURNS_TIMER);
            }
            return;
        }
        this.zeroTurnsTimer = TimelineUtils.clearTimerSafe(this.zeroTurnsTimer);
        // Clear old dots from track/content (now that we know content exists)
        (this.ui.trackContent || this.ui.timelineBar).querySelectorAll('.timeline-dot').forEach(n => n.remove());

        // ✅ 按照元素在页面上的实际位置（从上往下）排序
        // 确保节点顺序和视觉顺序完全一致，适用于所有网站
        userTurnElements = Array.from(userTurnElements).sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return rectA.top - rectB.top;
        });
        
        // 计算内容跨度
        const firstRect = userTurnElements[0].getBoundingClientRect();
        const lastRect = userTurnElements[userTurnElements.length - 1].getBoundingClientRect();
        const firstTurnOffset = 0; // 使用第一个元素作为基准
        let contentSpan = lastRect.top - firstRect.top;
        
        if (userTurnElements.length < 2 || contentSpan <= 0) {
            contentSpan = 1;
        }

        // Cache for scroll mapping
        this.firstUserTurnOffset = firstTurnOffset;
        this.contentSpanPx = contentSpan;

        // Build markers with normalized position along conversation
        this.markerMap.clear();
        this.markers = Array.from(userTurnElements).map((el, index) => {
            // 统一使用 getBoundingClientRect 计算相对位置
            const elRect = el.getBoundingClientRect();
            const offsetFromStart = elRect.top - firstRect.top;
            
            let n = offsetFromStart / contentSpan;
            n = Math.max(0, Math.min(1, n));
            const id = this.adapter.generateTurnId(el, index);
            
            const m = {
                id: id,
                element: el,
                summary: this.adapter.extractText(el),
                n,
                baseN: n,
                dotElement: null,
                starred: false,
            };
            this.markerMap.set(m.id, m);
            return m;
        });
        
        // ✅ 应用收藏状态：根据 starredIndexes 设置 starred 和填充 this.starred
        this.starredIndexes.forEach(index => {
            const marker = this.markers[index];
            if (marker && marker.id) {
                marker.starred = true;
                this.starred.add(marker.id);
            }
        });
        
        // Bump version after markers are rebuilt to invalidate concurrent passes
        this.markersVersion++;

        // Compute geometry and virtualize render
        this.updateTimelineGeometry();
        if (!this.activeTurnId && this.markers.length > 0) {
            this.activeTurnId = this.markers[this.markers.length - 1].id;
        }
        this.syncTimelineTrackToMain();
        this.updateVirtualRangeAndRender();
        // Ensure active class is applied after dots are created
        this.updateActiveDotUI();
        this.scheduleScrollSync();
        // ✅ 检查是否有跨页面导航任务
        this.getNavigateData('targetIndex').then(targetIndex => {
            if (targetIndex !== null && this.markers[targetIndex]) {
                requestAnimationFrame(() => {
                    const marker = this.markers[targetIndex];
                    if (marker && marker.element) {
                        this.smoothScrollTo(marker.element);
                    }
                });
            }
        }).catch(() => {});
        
        this.perfEnd('recalc');
    }
    
    setupObservers() {
        this.mutationObserver = new MutationObserver(() => {
            try { this.ensureContainersUpToDate(); } catch {}
            this.debouncedRecalculateAndRender();
            this.updateIntersectionObserverTargets();
        });
        this.mutationObserver.observe(this.conversationContainer, { childList: true, subtree: true });
        // Resize: update long-canvas geometry and virtualization
        this.resizeObserver = new ResizeObserver(() => {
            this.updateTimelineGeometry();
            this.syncTimelineTrackToMain();
            this.updateVirtualRangeAndRender();
        });
        if (this.ui.timelineBar) {
            this.resizeObserver.observe(this.ui.timelineBar);
        }

        this.intersectionObserver = new IntersectionObserver(entries => {
            // Maintain which user turns are currently visible
            entries.forEach(entry => {
                const target = entry.target;
                if (entry.isIntersecting) {
                    this.visibleUserTurns.add(target);
                } else {
                    this.visibleUserTurns.delete(target);
                }
            });

            // Defer active state decision to scroll-based computation
            this.scheduleScrollSync();
        }, { 
            root: this.scrollContainer,
            threshold: 0.1,
            rootMargin: "-40% 0px -59% 0px"
        });

        this.updateIntersectionObserverTargets();
    }

    // Ensure our conversation/scroll containers are still current after DOM replacements
    ensureContainersUpToDate() {
        const selector = this.adapter.getUserMessageSelector();
        const first = document.querySelector(selector);
        if (!first) return;
        const newConv = this.adapter.findConversationContainer(first);
        if (newConv && newConv !== this.conversationContainer) {
            // Rebind observers and listeners to the new conversation root
            this.rebindConversationContainer(newConv);
        }
    }

    rebindConversationContainer(newConv) {
        // Detach old listeners
        if (this.scrollContainer && this.onScroll) {
            try { this.scrollContainer.removeEventListener('scroll', this.onScroll); } catch {}
        }
        try { this.mutationObserver?.disconnect(); } catch {}
        try { this.intersectionObserver?.disconnect(); } catch {}

        this.conversationContainer = newConv;

        // Find (or re-find) scroll container
        let parent = newConv;
        let newScroll = null;
        while (parent && parent !== document.body) {
            const style = window.getComputedStyle(parent);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                newScroll = parent; break;
            }
            parent = parent.parentElement;
        }
        if (!newScroll) newScroll = document.scrollingElement || document.documentElement || document.body;
        this.scrollContainer = newScroll;
        // Reattach scroll listener
        this.onScroll = () => this.scheduleScrollSync();
        this.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true });

        // Recreate IntersectionObserver with new root
        this.intersectionObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                const target = entry.target;
                if (entry.isIntersecting) { this.visibleUserTurns.add(target); }
                else { this.visibleUserTurns.delete(target); }
            });
            this.scheduleScrollSync();
        }, { root: this.scrollContainer, threshold: 0.1, rootMargin: "-40% 0px -59% 0px" });
        this.updateIntersectionObserverTargets();

        // Re-observe mutations on the new conversation container
        this.mutationObserver.observe(this.conversationContainer, { childList: true, subtree: true });

        // Force a recalc right away to rebuild markers
        this.recalculateAndRenderMarkers();
    }

    updateIntersectionObserverTargets() {
        if (!this.intersectionObserver || !this.conversationContainer) return;
        this.intersectionObserver.disconnect();
        this.visibleUserTurns.clear();
        const selector = this.adapter.getUserMessageSelector();
        const userTurns = this.conversationContainer.querySelectorAll(selector);
        userTurns.forEach(el => this.intersectionObserver.observe(el));
    }

    setupEventListeners() {
        this.onTimelineBarClick = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) {
                const targetId = dot.dataset.targetTurnId;
                // Find target element by matching marker ID
                const marker = this.markers.find(m => m.id === targetId);
                const targetElement = marker?.element;
                if (targetElement) {
                    // Only scroll; let scroll-based computation set active to avoid double-flash
                    this.smoothScrollTo(targetElement);
                }
            }
        };
        this.ui.timelineBar.addEventListener('click', this.onTimelineBarClick);
        // ✅ 移除：长按收藏功能已移除，现在只能通过 Tooltip 内点击星标收藏
        // Listen to container scroll to keep marker active state in sync
        this.onScroll = () => this.scheduleScrollSync();
        this.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true });

        // Tooltip interactions (delegated)
        this.onTimelineBarOver = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) this.showTooltipForDot(dot);
        };
        
        // ✅ 需求2：修改逻辑 - 只在鼠标不是移到 tooltip 时才隐藏
        this.onTimelineBarOut = (e) => {
            const fromDot = e.target.closest('.timeline-dot');
            const toDot = e.relatedTarget?.closest?.('.timeline-dot');
            const toTooltip = e.relatedTarget?.closest?.('.timeline-tooltip');
            
            // 如果从圆点移出，且不是移到另一个圆点或 tooltip，才隐藏
            if (fromDot && !toDot && !toTooltip) {
                this.hideTooltip();
            }
        };
        
        this.onTimelineBarFocusIn = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) this.showTooltipForDot(dot);
        };
        this.onTimelineBarFocusOut = (e) => {
            const dot = e.target.closest('.timeline-dot');
            if (dot) this.hideTooltip();
        };
        
        this.ui.timelineBar.addEventListener('mouseover', this.onTimelineBarOver);
        this.ui.timelineBar.addEventListener('mouseout', this.onTimelineBarOut);
        this.ui.timelineBar.addEventListener('focusin', this.onTimelineBarFocusIn);
        this.ui.timelineBar.addEventListener('focusout', this.onTimelineBarFocusOut);
        
        // ✅ 需求2：添加 tooltip 自身的悬停事件
        this.onTooltipEnter = () => {
            // 鼠标进入 tooltip，取消隐藏定时器
            this.tooltipHideTimer = TimelineUtils.clearTimerSafe(this.tooltipHideTimer);
        };
        
        this.onTooltipLeave = (e) => {
            // 鼠标离开 tooltip
            const toTimeline = e.relatedTarget?.closest?.('.chat-timeline-bar');
            const toDot = e.relatedTarget?.closest?.('.timeline-dot');
            
            // 如果不是移回圆点或时间轴，隐藏 tooltip
            if (!toTimeline && !toDot) {
                this.hideTooltip();
            }
        };
        
        if (this.ui.tooltip) {
            this.ui.tooltip.addEventListener('mouseenter', this.onTooltipEnter);
            this.ui.tooltip.addEventListener('mouseleave', this.onTooltipLeave);
        }

        // Slider visibility on hover (time axis or slider itself) with stable refs
        // Define and persist handlers so we can remove them in destroy()
        this.onBarEnter = () => this.showSlider();
        this.onBarLeave = () => this.hideSliderDeferred();
        this.onSliderEnter = () => this.showSlider();
        this.onSliderLeave = () => this.hideSliderDeferred();
        try {
            this.ui.timelineBar.addEventListener('pointerenter', this.onBarEnter);
            this.ui.timelineBar.addEventListener('pointerleave', this.onBarLeave);
            if (this.ui.slider) {
                this.ui.slider.addEventListener('pointerenter', this.onSliderEnter);
                this.ui.slider.addEventListener('pointerleave', this.onSliderLeave);
            }
        } catch {}

        // Reposition tooltip on resize
        this.onWindowResize = () => {
            if (this.ui.tooltip?.classList.contains('visible')) {
                const activeDot = this.ui.timelineBar.querySelector('.timeline-dot:hover, .timeline-dot:focus');
                if (activeDot) {
                    // ✅ 修改：window resize 时隐藏 tooltip，让用户重新 hover 时再显示
                    // 这样可以避免维护两套 tooltip 构建逻辑
                    this.hideTooltip();
                }
            }
            // Update long-canvas geometry and virtualization
            this.updateTimelineGeometry();
            this.syncTimelineTrackToMain();
            this.updateVirtualRangeAndRender();
        };
        window.addEventListener('resize', this.onWindowResize);
        // VisualViewport resize can fire on zoom on some platforms; schedule correction
        if (window.visualViewport) {
            this.onVisualViewportResize = () => {
                this.updateTimelineGeometry();
                this.syncTimelineTrackToMain();
                this.updateVirtualRangeAndRender();
            };
            try { window.visualViewport.addEventListener('resize', this.onVisualViewportResize); } catch {}
        }

        // Scroll wheel on the timeline controls the main scroll container (Linked mode)
        this.onTimelineWheel = (e) => {
            // Prevent page from attempting to scroll anything else
            try { e.preventDefault(); } catch {}
            const delta = e.deltaY || 0;
            this.scrollContainer.scrollTop += delta;
            // Keep markers in sync on next frame
            this.scheduleScrollSync();
            this.showSlider();
        };
        this.ui.timelineBar.addEventListener('wheel', this.onTimelineWheel, { passive: false });

        // Slider drag handlers
        this.onSliderDown = (ev) => {
            if (!this.ui.sliderHandle) return;
            try { this.ui.sliderHandle.setPointerCapture(ev.pointerId); } catch {}
            this.sliderDragging = true;
            this.showSlider();
            this.sliderStartClientY = ev.clientY;
            const rect = this.ui.sliderHandle.getBoundingClientRect();
            this.sliderStartTop = rect.top;
            this.onSliderMove = (e) => this.handleSliderDrag(e);
            this.onSliderUp = (e) => this.endSliderDrag(e);
            window.addEventListener('pointermove', this.onSliderMove);
            window.addEventListener('pointerup', this.onSliderUp, { once: true });
        };
        try { this.ui.sliderHandle?.addEventListener('pointerdown', this.onSliderDown); } catch {}

        // Cross-tab/cross-site star sync via chrome.storage change event
        this.onStorage = (changes, areaName) => {
            try {
                const url = location.href.replace(/^https?:\/\//, '');
                const prefix = `chatTimelineStar:${url}:`;
                
                // 检查变化的key中是否有当前页面的收藏数据
                Object.keys(changes).forEach(key => {
                    if (!key.startsWith(prefix)) return;
                    
                    // 提取 index
                    const indexStr = key.substring(prefix.length);
                    const index = parseInt(indexStr, 10);
                    if (isNaN(index)) return;
                    
                    const marker = this.markers[index];
                    if (!marker) return;
                    
                    const change = changes[key];
                    
                    // 判断是添加还是删除
                    if (change.newValue) {
                        // 添加收藏
                        this.starred.add(marker.id);
                        this.starredIndexes.add(index);
                        if (marker) marker.starred = true;
                    } else {
                        // 删除收藏
                        this.starred.delete(marker.id);
                        this.starredIndexes.delete(index);
                        if (marker) marker.starred = false;
                    }
                    
                    // 更新圆点样式并刷新 tooltip
                    if (marker.dotElement) {
                        try { 
                            marker.dotElement.classList.toggle('starred', this.starred.has(marker.id));
                            this.refreshTooltipForDot(marker.dotElement);
                        } catch {}
                    }
                });
                
                // 更新收藏列表 UI
                this.updateStarredListUI();
                // 更新收藏按钮显示状态
                this.updateStarredBtnVisibility();
            } catch {}
        };
        try { StorageAdapter.addChangeListener(this.onStorage); } catch {}
        
        // ✅ 收藏按钮点击事件
        if (this.ui.starredBtn) {
            this.ui.starredBtn.addEventListener('click', () => {
                this.toggleStarredPanel();
            });
        }
        
        // ✅ 关闭按钮点击事件
        if (this.ui.starredClose) {
            this.ui.starredClose.addEventListener('click', () => {
                this.hideStarredPanel();
            });
        }
        
        // ✅ 点击弹窗外部关闭
        if (this.ui.starredPanel) {
            this.ui.starredPanel.addEventListener('click', (e) => {
                if (e.target === this.ui.starredPanel) {
                    this.hideStarredPanel();
                }
            });
        }
        
        // ✅ 优化：监听主题变化，清空缓存
        this.setupThemeChangeListener();
    }
    
    /**
     * ✅ 优化：设置主题变化监听器
     * 当主题切换时，重新缓存 CSS 变量并清空截断缓存
     */
    setupThemeChangeListener() {
        // 监听 html 元素的 class 变化（dark 模式切换）
        const themeObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    this.onThemeChange();
                }
            });
        });
        
        try {
            themeObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['class']
            });
            
            // 保存引用以便在 destroy 时清理
            this.themeObserver = themeObserver;
        } catch (e) {
        }
        
        // 监听系统主题变化（prefers-color-scheme）
        try {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const mediaQueryHandler = () => {
                this.onThemeChange();
            };
            
            // 使用现代 API（如果支持）
            if (mediaQuery.addEventListener) {
                mediaQuery.addEventListener('change', mediaQueryHandler);
            } else {
                // 降级到旧 API
                mediaQuery.addListener(mediaQueryHandler);
            }
            
            // 保存引用以便在 destroy 时清理
            this.mediaQuery = mediaQuery;
            this.mediaQueryHandler = mediaQueryHandler;
        } catch (e) {
        }
    }
    
    /**
     * ✅ 优化：主题变化处理
     */
    onThemeChange() {
        // 延迟到下一帧，确保新主题的样式已应用
        requestAnimationFrame(() => {
            // 重新缓存 CSS 变量
            this.cacheTooltipConfig();
            
            // 清空截断缓存（因为颜色/字体可能变化）
            this.truncateCache.clear();
        });
    }
    
    smoothScrollTo(targetElement, duration = 600) {
        if (!targetElement || !this.scrollContainer) return;
        
        const containerRect = this.scrollContainer.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const targetPosition = targetRect.top - containerRect.top + this.scrollContainer.scrollTop;
        const startPosition = this.scrollContainer.scrollTop;
        const distance = targetPosition - startPosition;
        let startTime = null;

        const animation = (currentTime) => {
            this.isScrolling = true;
            if (startTime === null) startTime = currentTime;
            const timeElapsed = currentTime - startTime;
            const run = this.easeInOutQuad(timeElapsed, startPosition, distance, duration);
            this.scrollContainer.scrollTop = run;
            if (timeElapsed < duration) {
                requestAnimationFrame(animation);
            } else {
                this.scrollContainer.scrollTop = targetPosition;
                this.isScrolling = false;
            }
        };
        requestAnimationFrame(animation);
    }
    
    easeInOutQuad(t, b, c, d) {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t + b;
        t--;
        return -c / 2 * (t * (t - 2) - 1) + b;
    }

    updateActiveDotUI() {
        this.markers.forEach(marker => {
            marker.dotElement?.classList.toggle('active', marker.id === this.activeTurnId);
        });
    }

    debounce(func, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // Read numeric CSS var from the timeline bar element
    getCSSVarNumber(el, name, fallback) {
        const v = getComputedStyle(el).getPropertyValue(name).trim();
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    }

    getTrackPadding() {
        if (!this.ui.timelineBar) return 12;
        return this.getCSSVarNumber(this.ui.timelineBar, '--timeline-track-padding', 12);
    }

    getMinGap() {
        if (!this.ui.timelineBar) return 12;
        return this.getCSSVarNumber(this.ui.timelineBar, '--timeline-min-gap', 12);
    }

    // Enforce a minimum pixel gap between positions while staying within bounds
    applyMinGap(positions, minTop, maxTop, gap) {
        const n = positions.length;
        if (n === 0) return positions;
        const out = positions.slice();
        // Clamp first and forward pass (monotonic increasing)
        out[0] = Math.max(minTop, Math.min(positions[0], maxTop));
        for (let i = 1; i < n; i++) {
            const minAllowed = out[i - 1] + gap;
            out[i] = Math.max(positions[i], minAllowed);
        }
        // If last exceeds max, backward pass
        if (out[n - 1] > maxTop) {
            out[n - 1] = maxTop;
            for (let i = n - 2; i >= 0; i--) {
                const maxAllowed = out[i + 1] - gap;
                out[i] = Math.min(out[i], maxAllowed);
            }
            // Ensure first still within min
            if (out[0] < minTop) {
                out[0] = minTop;
                for (let i = 1; i < n; i++) {
                    const minAllowed = out[i - 1] + gap;
                    out[i] = Math.max(out[i], minAllowed);
                }
            }
        }
        // Final clamp
        for (let i = 0; i < n; i++) {
            if (out[i] < minTop) out[i] = minTop;
            if (out[i] > maxTop) out[i] = maxTop;
        }
        return out;
    }

    // Debounced scheduler: after resize/zoom settles, re-apply min-gap based on cached normalized positions
    scheduleMinGapCorrection() {
        this.resizeIdleTimer = TimelineUtils.clearTimerSafe(this.resizeIdleTimer);
        this.resizeIdleRICId = TimelineUtils.clearIdleCallbackSafe(this.resizeIdleRICId);
        
        this.resizeIdleTimer = setTimeout(() => {
            this.resizeIdleTimer = null;
            // Prefer idle callback to avoid contention; fallback to immediate
            try {
                if (typeof requestIdleCallback === 'function') {
                    this.resizeIdleRICId = requestIdleCallback(() => {
                        this.resizeIdleRICId = null;
                        this.reapplyMinGapAfterResize();
                    }, { timeout: TIMELINE_CONFIG.RESIZE_IDLE_TIMEOUT });
                    return;
                }
            } catch {}
            this.reapplyMinGapAfterResize();
        }, TIMELINE_CONFIG.RESIZE_IDLE_DELAY);
    }

    // Lightweight correction: map cached n -> pixel, apply min-gap, write back updated n
    reapplyMinGapAfterResize() {
        this.perfStart('minGapIdle');
        if (!this.ui.timelineBar || this.markers.length === 0) return;
        const barHeight = this.ui.timelineBar.clientHeight || 0;
        const trackPadding = this.getTrackPadding();
        const usable = Math.max(1, barHeight - 2 * trackPadding);
        const minTop = trackPadding;
        const maxTop = trackPadding + usable;
        const minGap = this.getMinGap();
        // Use cached normalized positions (default 0)
        const desired = this.markers.map(m => {
            const n = Math.max(0, Math.min(1, (m.n ?? 0)));
            return minTop + n * usable;
        });
        const adjusted = this.applyMinGap(desired, minTop, maxTop, minGap);
        for (let i = 0; i < this.markers.length; i++) {
            const top = adjusted[i];
            const n = (top - minTop) / Math.max(1, (maxTop - minTop));
            this.markers[i].n = Math.max(0, Math.min(1, n));
            try { this.markers[i].dotElement?.style.setProperty('--n', String(this.markers[i].n)); } catch {}
        }
        this.perfEnd('minGapIdle');
    }

    /**
     * ✅ 优化：显示 Tooltip（添加防抖避免快速移动时闪烁）
     */
    showTooltipForDot(dot) {
        if (!this.ui.tooltip || !dot) return;
        
        // ✅ 优化：防抖 - 快速移动时只显示最后停留的圆点
        this.tooltipUpdateDebounceTimer = TimelineUtils.clearTimerSafe(this.tooltipUpdateDebounceTimer);
        this.tooltipUpdateDebounceTimer = setTimeout(() => {
            this.tooltipUpdateDebounceTimer = null;
            this._showTooltipImmediate(dot);
        }, 80);
    }
    
    /**
     * ✅ 优化：立即显示 Tooltip（内部方法）
     */
    _showTooltipImmediate(dot) {
        if (!this.ui.tooltip || !dot) return;
        
        this.tooltipHideTimer = TimelineUtils.clearTimerSafe(this.tooltipHideTimer);
        
        // T0: compute + write geometry while hidden
        const tip = this.ui.tooltip;
        tip.classList.remove('visible');
        
        // 获取消息信息
        const id = dot.dataset.targetTurnId;
        const isStarred = id && this.starred.has(id);
        
        // 获取消息文本（不含星标前缀）
        const messageText = (dot.getAttribute('aria-label') || '').trim();
        
        // 计算位置和宽度
        const p = this.computePlacementInfo(dot);
        
        // 截断文本
        const layout = this.truncateToFiveLines(messageText, p.width, true);
        
        // ✅ 修改：新的 tooltip 结构（内容 + 星标，水平排列，垂直居中）
        tip.innerHTML = '';
        
        // 创建内容区
        const content = document.createElement('div');
        content.className = 'timeline-tooltip-content';
        content.textContent = layout.text;
        
        // 添加点击复制功能
        content.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copyToClipboard(messageText, content);
        });
        
        // 创建星标图标（放在内容右侧，垂直居中）
        const starSpan = document.createElement('span');
        starSpan.className = 'timeline-tooltip-star';
        starSpan.dataset.targetTurnId = id; // 保存消息 ID
        
        if (isStarred) {
            // 已收藏：橙色背景
            starSpan.setAttribute('data-tooltip', chrome.i18n.getMessage('clickToUnstar'));
        } else {
            // 未收藏：透明背景 + 灰色边框
            starSpan.classList.add('not-starred');
            starSpan.setAttribute('data-tooltip', chrome.i18n.getMessage('clickToStar'));
        }
        
        // 添加点击事件
        starSpan.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            const turnId = starSpan.dataset.targetTurnId;
            this.toggleStar(turnId); // 切换收藏状态
            
            // 立即更新样式类
            const nowStarred = this.starred.has(turnId);
            const newTooltipText = nowStarred 
                ? chrome.i18n.getMessage('clickToUnstar') 
                : chrome.i18n.getMessage('clickToStar');
            
            if (nowStarred) {
                starSpan.classList.remove('not-starred');
            } else {
                starSpan.classList.add('not-starred');
            }
            starSpan.setAttribute('data-tooltip', newTooltipText);
            
            // ✅ 修复：更新当前显示的tooltip文本（如果存在）
            const existingTooltip = document.querySelector('.timeline-starred-question-tooltip.visible');
            if (existingTooltip) {
                existingTooltip.textContent = newTooltipText;
            }
        });
        
        // 组装：content 和 star 平级，使用 flex 布局
        tip.appendChild(content);
        tip.appendChild(starSpan);
        
        // 为星标绑定快速响应的自定义tooltip
        this.bindCustomTooltip(starSpan);
        
        // ✅ 先设置宽度和基本样式，让tooltip可以正确渲染
        tip.style.maxWidth = `${Math.floor(p.width)}px`;
        tip.style.width = 'auto';
        tip.style.minWidth = '80px';
        tip.style.height = 'auto';
        tip.style.opacity = '0'; // 暂时隐藏，避免闪烁
        tip.style.visibility = 'visible'; // 但要让浏览器渲染它
        
        // ✅ 强制浏览器渲染，然后读取实际高度
        tip.offsetHeight; // 触发reflow
        const actualHeight = tip.getBoundingClientRect().height;
        
        // ✅ 使用实际高度来定位（确保箭头对齐节点中心）
        this.placeTooltipAt(dot, p.placement, p.width, actualHeight);
        tip.setAttribute('aria-hidden', 'false');
        
        // T1: next frame add visible for non-geometric animation only
        this.showRafId = TimelineUtils.clearRafSafe(this.showRafId);
        this.showRafId = requestAnimationFrame(() => {
            this.showRafId = null;
            tip.style.opacity = ''; // 恢复opacity，让CSS控制
            tip.classList.add('visible');
        });
    }
    
    /**
     * ✅ 优化：获取 Tooltip 文本（提取为独立方法）
     */
    _getTooltipText(dot) {
        let text = (dot.getAttribute('aria-label') || '').trim();
        
        try {
            const id = dot.dataset.targetTurnId;
            if (id && this.starred.has(id)) {
                text = `★ ${text}`;
            }
        } catch {}
        
        return text;
    }

    hideTooltip(immediate = false) {
        if (!this.ui.tooltip) return;
        
        // ✅ 优化：取消待处理的显示
        this.tooltipUpdateDebounceTimer = TimelineUtils.clearTimerSafe(this.tooltipUpdateDebounceTimer);
        
        const doHide = () => {
            this.ui.tooltip.classList.remove('visible');
            this.ui.tooltip.setAttribute('aria-hidden', 'true');
            this.ui.tooltip.style.opacity = '';
            this.ui.tooltip.style.visibility = '';
            this.tooltipHideTimer = null;
        };
        
        if (immediate) return doHide();
        
        this.tooltipHideTimer = TimelineUtils.clearTimerSafe(this.tooltipHideTimer);
        this.tooltipHideTimer = setTimeout(doHide, TIMELINE_CONFIG.TOOLTIP_HIDE_DELAY);
    }

    placeTooltipAt(dot, placement, width, height) {
        if (!this.ui.tooltip) return;
        const tip = this.ui.tooltip;
        const dotRect = dot.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        
        // ✅ 优化：使用缓存的 CSS 变量（如果有）
        const config = this.tooltipConfigCache || {};
        const arrowOut = config.arrowOut ?? this.getCSSVarNumber(tip, '--timeline-tooltip-arrow-outside', 6);
        const baseGap = config.baseGap ?? this.getCSSVarNumber(tip, '--timeline-tooltip-gap-visual', 12);
        const boxGap = config.boxGap ?? this.getCSSVarNumber(tip, '--timeline-tooltip-gap-box', 8);
        const gap = baseGap + Math.max(0, arrowOut) + Math.max(0, boxGap);
        const viewportPad = 8;

        let left;
        if (placement === 'left') {
            left = Math.round(dotRect.left - gap - width);
            if (left < viewportPad) {
                // Clamp within viewport: switch to right if impossible
                const altLeft = Math.round(dotRect.right + gap);
                if (altLeft + width <= vw - viewportPad) {
                    placement = 'right';
                    left = altLeft;
                } else {
                    // shrink width to fit
                    const fitWidth = Math.max(120, vw - viewportPad - altLeft);
                    left = altLeft;
                    width = fitWidth;
                }
            }
        } else {
            left = Math.round(dotRect.right + gap);
            if (left + width > vw - viewportPad) {
                const altLeft = Math.round(dotRect.left - gap - width);
                if (altLeft >= viewportPad) {
                    placement = 'left';
                    left = altLeft;
                } else {
                    const fitWidth = Math.max(120, vw - viewportPad - left);
                    width = fitWidth;
                }
            }
        }

        // ✅ 修复：使用实际高度来垂直居中
        // height参数是tooltip的实际渲染高度（包括padding、border等）
        let top = Math.round(dotRect.top + dotRect.height / 2 - height / 2);
        top = Math.max(viewportPad, Math.min(vh - height - viewportPad, top));
        
        // 设置tooltip的top位置
        tip.style.top = `${top}px`;
        
        // ✅ 需求2：短文本时保持右侧对齐
        // 左侧显示：使用 right 属性，保持右边缘对齐（靠近圆点）
        // 右侧显示：使用 left 属性，保持左边缘对齐（靠近圆点）
        if (placement === 'left') {
            // 清除left，使用right
            tip.style.left = '';
            tip.style.right = `${vw - dotRect.left + gap}px`;
        } else {
            // 清除right，使用left
            tip.style.right = '';
            tip.style.left = `${left}px`;
        }
        
        tip.setAttribute('data-placement', placement);
    }

    /**
     * ✅ 优化：只更新星标图标，避免重新构建整个 tooltip（防止抖动）
     */
    refreshTooltipForDot(dot) {
        if (!this.ui?.tooltip || !dot) return;
        const tip = this.ui.tooltip;
        
        // Only update when tooltip is currently visible
        const isVisible = tip.classList.contains('visible');
        if (!isVisible) return;

        // ✅ 优化：只更新星标图标的 CSS 类，不重新构建整个 tooltip
        const id = dot.dataset.targetTurnId;
        const isStarred = id && this.starred.has(id);
        
        // 查找现有的星标元素
        const starSpan = tip.querySelector('.timeline-tooltip-star');
        if (!starSpan) return;
        
        // 只更新 CSS 类和 data-tooltip，避免重排（无需移除 visible，无需重建）
        if (isStarred) {
            starSpan.classList.remove('not-starred');
            starSpan.setAttribute('data-tooltip', chrome.i18n.getMessage('clickToUnstar'));
        } else {
            starSpan.classList.add('not-starred');
            starSpan.setAttribute('data-tooltip', chrome.i18n.getMessage('clickToStar'));
        }
    }

    // --- Long-canvas geometry and virtualization (Linked mode) ---
    updateTimelineGeometry() {
        if (!this.ui.timelineBar || !this.ui.trackContent) return;
        const H = this.ui.timelineBar.clientHeight || 0;
        const pad = this.getTrackPadding();
        const minGap = this.getMinGap();
        const N = this.markers.length;
        // Content height ensures minGap between consecutive dots
        const desired = Math.max(H, (N > 0 ? (2 * pad + Math.max(0, N - 1) * minGap) : H));
        this.contentHeight = Math.ceil(desired);
        this.scale = (H > 0) ? (this.contentHeight / H) : 1;
        try { this.ui.trackContent.style.height = `${this.contentHeight}px`; } catch {}

        // Precompute desired Y from normalized baseN and enforce min-gap
        const usableC = Math.max(1, this.contentHeight - 2 * pad);
        const desiredY = this.markers.map(m => pad + Math.max(0, Math.min(1, (m.baseN ?? m.n ?? 0))) * usableC);
        const adjusted = this.applyMinGap(desiredY, pad, pad + usableC, minGap);
        this.yPositions = adjusted;
        // Update normalized n for CSS positioning
        for (let i = 0; i < N; i++) {
            const top = adjusted[i];
            const n = (top - pad) / usableC;
            this.markers[i].n = Math.max(0, Math.min(1, n));
            if (this.markers[i].dotElement && !this.usePixelTop) {
                try { this.markers[i].dotElement.style.setProperty('--n', String(this.markers[i].n)); } catch {}
            }
        }
        if (this._cssVarTopSupported === null) {
            this._cssVarTopSupported = this.detectCssVarTopSupport(pad, usableC);
            this.usePixelTop = !this._cssVarTopSupported;
        }
        this.updateSlider();
        // First-time nudge: if content is scrollable, briefly reveal slider
        const barH = this.ui.timelineBar?.clientHeight || 0;
        if (this.contentHeight > barH + 1) {
            this.sliderAlwaysVisible = true;
            this.showSlider();
        } else {
            this.sliderAlwaysVisible = false;
        }
    }

    detectCssVarTopSupport(pad, usableC) {
        try {
            if (!this.ui.trackContent) return false;
            const test = document.createElement('button');
            test.className = 'timeline-dot';
            test.style.visibility = 'hidden';
            test.style.pointerEvents = 'none';
            test.setAttribute('aria-hidden', 'true');
            const expected = pad + 0.5 * usableC;
            test.style.setProperty('--n', '0.5');
            this.ui.trackContent.appendChild(test);
            const cs = getComputedStyle(test);
            const topStr = cs.top || '';
            const px = parseFloat(topStr);
            test.remove();
            if (!Number.isFinite(px)) return false;
            return Math.abs(px - expected) <= TIMELINE_CONFIG.CSS_VAR_DETECTION_TOLERANCE;
        } catch {
            return false;
        }
    }

    syncTimelineTrackToMain() {
        if (this.sliderDragging) return; // do not override when user drags slider
        if (!this.ui.track || !this.scrollContainer || !this.contentHeight) return;
        const scrollTop = this.scrollContainer.scrollTop;
        const ref = scrollTop + this.scrollContainer.clientHeight * 0.45;
        const span = Math.max(1, this.contentSpanPx || 1);
        const r = Math.max(0, Math.min(1, (ref - (this.firstUserTurnOffset || 0)) / span));
        const maxScroll = Math.max(0, this.contentHeight - (this.ui.track.clientHeight || 0));
        const target = Math.round(r * maxScroll);
        if (Math.abs((this.ui.track.scrollTop || 0) - target) > 1) {
            this.ui.track.scrollTop = target;
        }
    }

    updateVirtualRangeAndRender() {
        const localVersion = this.markersVersion;
        if (!this.ui.track || !this.ui.trackContent || this.markers.length === 0) return;
        const st = this.ui.track.scrollTop || 0;
        const vh = this.ui.track.clientHeight || 0;
        const buffer = Math.max(TIMELINE_CONFIG.VIRTUAL_BUFFER_MIN, vh);
        const minY = st - buffer;
        const maxY = st + vh + buffer;
        const start = this.lowerBound(this.yPositions, minY);
        const end = Math.max(start - 1, this.upperBound(this.yPositions, maxY));

        let prevStart = this.visibleRange.start;
        let prevEnd = this.visibleRange.end;
        const len = this.markers.length;
        // Clamp previous indices into current bounds to avoid undefined access
        if (len > 0) {
            prevStart = Math.max(0, Math.min(prevStart, len - 1));
            prevEnd = Math.max(-1, Math.min(prevEnd, len - 1));
        }
        if (prevEnd >= prevStart) {
            for (let i = prevStart; i < Math.min(start, prevEnd + 1); i++) {
                const m = this.markers[i];
                if (m && m.dotElement) { try { m.dotElement.remove(); } catch {} m.dotElement = null; }
            }
            for (let i = Math.max(end + 1, prevStart); i <= prevEnd; i++) {
                const m = this.markers[i];
                if (m && m.dotElement) { try { m.dotElement.remove(); } catch {} m.dotElement = null; }
            }
        } else {
            (this.ui.trackContent || this.ui.timelineBar).querySelectorAll('.timeline-dot').forEach(n => n.remove());
            this.markers.forEach(m => { m.dotElement = null; });
        }

        const frag = document.createDocumentFragment();
        for (let i = start; i <= end; i++) {
            const marker = this.markers[i];
            if (!marker) continue;
            if (!marker.dotElement) {
                const dot = document.createElement('button');
                dot.className = 'timeline-dot';
                dot.dataset.targetTurnId = marker.id;
                dot.setAttribute('aria-label', marker.summary);
                dot.setAttribute('tabindex', '0');
                try { dot.setAttribute('aria-describedby', 'chat-timeline-tooltip'); } catch {}
                try { dot.style.setProperty('--n', String(marker.n || 0)); } catch {}
                if (this.usePixelTop) {
                    dot.style.top = `${Math.round(this.yPositions[i])}px`;
                }
                // Apply active state immediately if this is the active marker
                try { dot.classList.toggle('active', marker.id === this.activeTurnId); } catch {}
                // ✅ 添加：如果已收藏，添加 starred 类（标记点变橙金色）
                try { dot.classList.toggle('starred', this.starred.has(marker.id)); } catch {}
                marker.dotElement = dot;
                frag.appendChild(dot);
            } else {
                try { marker.dotElement.style.setProperty('--n', String(marker.n || 0)); } catch {}
                if (this.usePixelTop) {
                    marker.dotElement.style.top = `${Math.round(this.yPositions[i])}px`;
                }
                // ✅ 移除：不再更新圆点的 starred 类
            }
        }
        if (localVersion !== this.markersVersion) return; // stale pass, abort
        if (frag.childNodes.length) this.ui.trackContent.appendChild(frag);
        this.visibleRange = { start, end };
        // keep slider in sync with timeline scroll
        this.updateSlider();
    }

    lowerBound(arr, x) {
        let lo = 0, hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] < x) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    upperBound(arr, x) {
        let lo = 0, hi = arr.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (arr[mid] <= x) lo = mid + 1; else hi = mid;
        }
        return lo - 1;
    }

    // --- Left slider helpers ---
    updateSlider() {
        if (!this.ui.slider || !this.ui.sliderHandle) return;
        if (!this.contentHeight || !this.ui.timelineBar || !this.ui.track) return;
        const barRect = this.ui.timelineBar.getBoundingClientRect();
        const barH = barRect.height || 0;
        const pad = this.getTrackPadding();
        const innerH = Math.max(0, barH - 2 * pad);
        if (this.contentHeight <= barH + 1 || innerH <= 0) {
            this.sliderAlwaysVisible = false;
            try {
                this.ui.slider.classList.remove('visible');
                this.ui.slider.style.opacity = '';
            } catch {}
            return;
        }
        this.sliderAlwaysVisible = true;
        // External slider geometry (short rail centered on inner area)
        const railLen = Math.max(120, Math.min(240, Math.floor(barH * 0.45)));
        const railTop = Math.round(barRect.top + pad + (innerH - railLen) / 2);
        const railLeftGap = 8; // px gap from bar's left edge
        const sliderWidth = 12; // matches CSS
        const left = Math.round(barRect.left - railLeftGap - sliderWidth);
        this.ui.slider.style.left = `${left}px`;
        this.ui.slider.style.top = `${railTop}px`;
        this.ui.slider.style.height = `${railLen}px`;

        const handleH = 22; // fixed concise handle
        const maxTop = Math.max(0, railLen - handleH);
        const range = Math.max(1, this.contentHeight - barH);
        const st = this.ui.track.scrollTop || 0;
        const r = Math.max(0, Math.min(1, st / range));
        const top = Math.round(r * maxTop);
        this.ui.sliderHandle.style.height = `${handleH}px`;
        this.ui.sliderHandle.style.top = `${top}px`;
        try {
            this.ui.slider.classList.add('visible');
            this.ui.slider.style.opacity = '';
        } catch {}
    }

    showSlider() {
        if (!this.ui.slider) return;
        this.ui.slider.classList.add('visible');
        this.sliderFadeTimer = TimelineUtils.clearTimerSafe(this.sliderFadeTimer);
        this.updateSlider();
    }

    hideSliderDeferred() {
        if (this.sliderDragging || this.sliderAlwaysVisible) return;
        this.sliderFadeTimer = TimelineUtils.clearTimerSafe(this.sliderFadeTimer);
        this.sliderFadeTimer = setTimeout(() => {
            this.sliderFadeTimer = null;
            TimelineUtils.removeClassSafe(this.ui.slider, 'visible');
        }, TIMELINE_CONFIG.SLIDER_FADE_DELAY);
    }

    handleSliderDrag(e) {
        if (!this.sliderDragging || !this.ui.timelineBar || !this.ui.track) return;
        const barRect = this.ui.timelineBar.getBoundingClientRect();
        const barH = barRect.height || 0;
        const railLen = parseFloat(this.ui.slider.style.height || '0') || Math.max(120, Math.min(240, Math.floor(barH * 0.45)));
        const handleH = this.ui.sliderHandle.getBoundingClientRect().height || 22;
        const maxTop = Math.max(0, railLen - handleH);
        const delta = e.clientY - this.sliderStartClientY;
        let top = Math.max(0, Math.min(maxTop, (this.sliderStartTop + delta) - (parseFloat(this.ui.slider.style.top) || 0)));
        const r = (maxTop > 0) ? (top / maxTop) : 0;
        const range = Math.max(1, this.contentHeight - barH);
        this.ui.track.scrollTop = Math.round(r * range);
        this.updateVirtualRangeAndRender();
        this.showSlider();
        this.updateSlider();
    }

    endSliderDrag(e) {
        this.sliderDragging = false;
        try { window.removeEventListener('pointermove', this.onSliderMove); } catch {}
        this.onSliderMove = null;
        this.onSliderUp = null;
        this.hideSliderDeferred();
    }

    computePlacementInfo(dot) {
        const tip = this.ui.tooltip || document.body;
        const dotRect = dot.getBoundingClientRect();
        const vw = window.innerWidth;
        
        // ✅ 优化：使用缓存的 CSS 变量（如果有）
        const config = this.tooltipConfigCache || {};
        const arrowOut = config.arrowOut ?? this.getCSSVarNumber(tip, '--timeline-tooltip-arrow-outside', 6);
        const baseGap = config.baseGap ?? this.getCSSVarNumber(tip, '--timeline-tooltip-gap-visual', 12);
        const boxGap = config.boxGap ?? this.getCSSVarNumber(tip, '--timeline-tooltip-gap-box', 8);
        const maxW = config.maxW ?? this.getCSSVarNumber(tip, '--timeline-tooltip-max', 288);
        
        const gap = baseGap + Math.max(0, arrowOut) + Math.max(0, boxGap);
        const viewportPad = 8;
        const minW = 160;
        const leftAvail = Math.max(0, dotRect.left - gap - viewportPad);
        const rightAvail = Math.max(0, vw - dotRect.right - gap - viewportPad);
        let placement = (rightAvail > leftAvail) ? 'right' : 'left';
        let avail = placement === 'right' ? rightAvail : leftAvail;
        // choose width tier for determinism
        const tiers = [280, 240, 200, 160];
        const hardMax = Math.max(minW, Math.min(maxW, Math.floor(avail)));
        let width = tiers.find(t => t <= hardMax) || Math.max(minW, Math.min(hardMax, 160));
        // if no tier fits (very tight), try switching side
        if (width < minW && placement === 'left' && rightAvail > leftAvail) {
            placement = 'right';
            avail = rightAvail;
            const hardMax2 = Math.max(minW, Math.min(maxW, Math.floor(avail)));
            width = tiers.find(t => t <= hardMax2) || Math.max(120, Math.min(hardMax2, minW));
        } else if (width < minW && placement === 'right' && leftAvail >= rightAvail) {
            placement = 'left';
            avail = leftAvail;
            const hardMax2 = Math.max(minW, Math.min(maxW, Math.floor(avail)));
            width = tiers.find(t => t <= hardMax2) || Math.max(120, Math.min(hardMax2, minW));
        }
        width = Math.max(120, Math.min(width, maxW));
        return { placement, width };
    }

    /**
     * ✅ 优化：截断文本为 5 行（添加缓存 + Emoji 安全截断）
     */
    truncateToFiveLines(text, targetWidth, wantLayout = false) {
        try {
            if (!this.measureEl || !this.ui.tooltip) {
                return wantLayout ? { text, height: 0 } : text;
            }
            
            // ✅ 优化：检查缓存
            const cacheKey = `${text}|${targetWidth}|${wantLayout}`;
            if (this.truncateCache.has(cacheKey)) {
                return this.truncateCache.get(cacheKey);
            }
            
            const tip = this.ui.tooltip;
            
            // ✅ 优化：使用缓存的 CSS 变量
            const config = this.tooltipConfigCache || {};
            const lineH = config.lineH ?? this.getCSSVarNumber(tip, '--timeline-tooltip-lh', 18);
            const padY = config.padY ?? this.getCSSVarNumber(tip, '--timeline-tooltip-pad-y', 10);
            
            // ✅ 重新设计：maxH 应该是内容区的最大高度（5行 + padding）
            // measureEl 已经模拟了内容区的样式（有 padding），所以不需要加 border
            const maxH = Math.round(5 * lineH + 2 * padY);
            const ell = '…';
            const el = this.measureEl;
            el.style.width = `${Math.max(0, Math.floor(targetWidth))}px`;

            // fast path: full text fits within 5 lines
            el.textContent = String(text || '').replace(/\s+/g, ' ').trim();
            let h = el.offsetHeight;
            if (h <= maxH) {
                const result = wantLayout ? { text: el.textContent, height: h } : el.textContent;
                // ✅ 优化：存入缓存（限制大小避免内存泄漏）
                this._addToTruncateCache(cacheKey, result);
                return result;
            }

            // binary search longest prefix that fits
            const raw = el.textContent;
            let lo = 0, hi = raw.length, ans = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                // ✅ 优化：使用 Emoji 安全截断
                const slice = this._safeSlice(raw, mid);
                el.textContent = slice.trimEnd() + ell;
                h = el.offsetHeight;
                if (h <= maxH) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
            }
            
            // ✅ 优化：最终截断也使用安全方法
            const out = (ans >= raw.length) ? raw : (this._safeSlice(raw, ans).trimEnd() + ell);
            el.textContent = out;
            h = el.offsetHeight;
            
            const result = wantLayout ? { text: out, height: Math.min(h, maxH) } : out;
            // ✅ 优化：存入缓存
            this._addToTruncateCache(cacheKey, result);
            return result;
        } catch (e) {
            return wantLayout ? { text, height: 0 } : text;
        }
    }
    
    /**
     * ✅ 优化：安全截断字符串（避免破坏 Emoji/代理对）
     */
    _safeSlice(text, end) {
        if (end >= text.length) return text;
        if (end <= 0) return '';
        
        // 检查是否在代理对中间截断（Emoji 等多字节字符）
        const charCode = text.charCodeAt(end - 1);
        
        // 高代理对范围 0xD800-0xDBFF
        if (charCode >= 0xD800 && charCode <= 0xDBFF) {
            // 向前退一位，避免截断代理对
            return text.slice(0, end - 1);
        }
        
        return text.slice(0, end);
    }
    
    /**
     * ✅ 优化：添加到截断缓存（LRU 策略，限制大小）
     */
    _addToTruncateCache(key, value) {
        const MAX_CACHE_SIZE = 100;
        
        // 如果缓存已满，删除最旧的条目（Map 的第一个）
        if (this.truncateCache.size >= MAX_CACHE_SIZE) {
            const firstKey = this.truncateCache.keys().next().value;
            this.truncateCache.delete(firstKey);
        }
        
        this.truncateCache.set(key, value);
    }

    scheduleScrollSync() {
        if (this.scrollRafId !== null) return;
        this.scrollRafId = requestAnimationFrame(() => {
            this.scrollRafId = null;
            // Sync long-canvas scroll and virtualized dots before computing active
            this.syncTimelineTrackToMain();
            this.updateVirtualRangeAndRender();
            this.computeActiveByScroll();
            this.updateSlider();
        });
    }

    computeActiveByScroll() {
        if (!this.scrollContainer || this.markers.length === 0) return;
        
        const scrollTop = this.scrollContainer.scrollTop;
        const scrollHeight = this.scrollContainer.scrollHeight;
        const clientHeight = this.scrollContainer.clientHeight;
        const containerRect = this.scrollContainer.getBoundingClientRect();
        
        // ========== 优先检测：是否在顶部或底部 ==========
        // 如果滚动到顶部（距离顶部 < 10px），强制激活第一个节点
        if (scrollTop < 10) {
            const firstId = this.markers[0].id;
            if (this.activeTurnId !== firstId) {
                this.activeTurnId = firstId;
                this.updateActiveDotUI();
                this.lastActiveChangeTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            }
            return;
        }
        
        // 如果滚动到底部（距离底部 < 10px），强制激活最后一个节点
        if (scrollTop + clientHeight >= scrollHeight - 10) {
            const lastId = this.markers[this.markers.length - 1].id;
            if (this.activeTurnId !== lastId) {
                this.activeTurnId = lastId;
                this.updateActiveDotUI();
                this.lastActiveChangeTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            }
            return;
        }
        
        // ========== 常规情况：使用参考点计算 ==========
        // 参考点：容器顶部向下 45% 的位置
        const referencePoint = containerRect.top + clientHeight * 0.45;
        
        // 常规情况：找到最接近参考点的消息
        let activeId = this.markers[0].id;
        
        for (let i = 0; i < this.markers.length; i++) {
            const m = this.markers[i];
            const elRect = m.element.getBoundingClientRect();
            const elTop = elRect.top;
            
            // 找到参考点之上最靠近的消息
            if (elTop <= referencePoint) {
                activeId = m.id;
            } else {
                break;
            }
        }
        
        if (this.activeTurnId !== activeId) {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const since = now - this.lastActiveChangeTime;
            if (since < TIMELINE_CONFIG.MIN_ACTIVE_CHANGE_INTERVAL) {
                // Coalesce rapid changes during fast scrolling/layout shifts
                this.pendingActiveId = activeId;
                if (!this.activeChangeTimer) {
                    const delay = Math.max(TIMELINE_CONFIG.MIN_ACTIVE_CHANGE_INTERVAL - since, 0);
                    this.activeChangeTimer = setTimeout(() => {
                        this.activeChangeTimer = null;
                        if (this.pendingActiveId && this.pendingActiveId !== this.activeTurnId) {
                            this.activeTurnId = this.pendingActiveId;
                            this.updateActiveDotUI();
                            this.lastActiveChangeTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                        }
                        this.pendingActiveId = null;
                    }, delay);
                }
            } else {
                this.activeTurnId = activeId;
                this.updateActiveDotUI();
                this.lastActiveChangeTime = now;
            }
        }
    }

    waitForElement(selector) {
        return new Promise((resolve) => {
            const element = document.querySelector(selector);
            if (element) return resolve(element);
            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    try { observer.disconnect(); } catch {}
                    resolve(el);
                }
            });
            try { observer.observe(document.body, { childList: true, subtree: true }); } catch {}
            // Guard against long-lived observers on wrong pages
            setTimeout(() => { TimelineUtils.disconnectObserverSafe(observer); resolve(null); }, TIMELINE_CONFIG.OBSERVER_TIMEOUT);
        });
    }

    destroy() {
        // Disconnect observers
        TimelineUtils.disconnectObserverSafe(this.mutationObserver);
        TimelineUtils.disconnectObserverSafe(this.resizeObserver);
        TimelineUtils.disconnectObserverSafe(this.intersectionObserver);
        TimelineUtils.disconnectObserverSafe(this.themeObserver); // ✅ 优化：清理主题监听器
        this.visibleUserTurns.clear();
        
        // ✅ 优化：清理媒体查询监听器
        if (this.mediaQuery && this.mediaQueryHandler) {
            try {
                if (this.mediaQuery.removeEventListener) {
                    this.mediaQuery.removeEventListener('change', this.mediaQueryHandler);
                } else {
                    this.mediaQuery.removeListener(this.mediaQueryHandler);
                }
            } catch {}
        }
        
        // Remove event listeners
        TimelineUtils.removeEventListenerSafe(this.ui.timelineBar, 'click', this.onTimelineBarClick);
        // ✅ 正确清理存储监听器（使用 StorageAdapter）
        try {
            if (this.onStorage) {
                StorageAdapter.removeChangeListener(this.onStorage);
            }
        } catch {}
        // ✅ 移除：长按相关的事件监听器已删除
        TimelineUtils.removeEventListenerSafe(this.scrollContainer, 'scroll', this.onScroll, { passive: true });
        TimelineUtils.removeEventListenerSafe(this.ui.timelineBar, 'mouseover', this.onTimelineBarOver);
        TimelineUtils.removeEventListenerSafe(this.ui.timelineBar, 'mouseout', this.onTimelineBarOut);
        TimelineUtils.removeEventListenerSafe(this.ui.timelineBar, 'focusin', this.onTimelineBarFocusIn);
        TimelineUtils.removeEventListenerSafe(this.ui.timelineBar, 'focusout', this.onTimelineBarFocusOut);
        // ✅ 需求2：清理 tooltip 事件监听器
        TimelineUtils.removeEventListenerSafe(this.ui.tooltip, 'mouseenter', this.onTooltipEnter);
        TimelineUtils.removeEventListenerSafe(this.ui.tooltip, 'mouseleave', this.onTooltipLeave);
        TimelineUtils.removeEventListenerSafe(this.ui.timelineBar, 'wheel', this.onTimelineWheel);
        TimelineUtils.removeEventListenerSafe(this.ui.timelineBar, 'pointerenter', this.onBarEnter);
        TimelineUtils.removeEventListenerSafe(this.ui.timelineBar, 'pointerleave', this.onBarLeave);
        TimelineUtils.removeEventListenerSafe(this.ui.slider, 'pointerenter', this.onSliderEnter);
        TimelineUtils.removeEventListenerSafe(this.ui.slider, 'pointerleave', this.onSliderLeave);
        TimelineUtils.removeEventListenerSafe(this.ui.sliderHandle, 'pointerdown', this.onSliderDown);
        TimelineUtils.removeEventListenerSafe(window, 'pointermove', this.onSliderMove);
        TimelineUtils.removeEventListenerSafe(window, 'resize', this.onWindowResize);
        TimelineUtils.removeEventListenerSafe(window.visualViewport, 'resize', this.onVisualViewportResize);
        
        // Clear timers and RAF
        this.scrollRafId = TimelineUtils.clearRafSafe(this.scrollRafId);
        this.activeChangeTimer = TimelineUtils.clearTimerSafe(this.activeChangeTimer);
        this.tooltipHideTimer = TimelineUtils.clearTimerSafe(this.tooltipHideTimer);
        this.tooltipUpdateDebounceTimer = TimelineUtils.clearTimerSafe(this.tooltipUpdateDebounceTimer);
        this.resizeIdleTimer = TimelineUtils.clearTimerSafe(this.resizeIdleTimer);
        this.resizeIdleRICId = TimelineUtils.clearIdleCallbackSafe(this.resizeIdleRICId);
        this.sliderFadeTimer = TimelineUtils.clearTimerSafe(this.sliderFadeTimer);
        // ✅ 移除：longPressTimer 已删除
        this.zeroTurnsTimer = TimelineUtils.clearTimerSafe(this.zeroTurnsTimer);
        this.showRafId = TimelineUtils.clearRafSafe(this.showRafId);
        
        // Remove DOM elements
        TimelineUtils.removeElementSafe(this.ui.timelineBar);
        TimelineUtils.removeElementSafe(this.ui.tooltip);
        TimelineUtils.removeElementSafe(this.measureEl);
        
        // Ensure external left slider is fully removed
        if (this.ui.slider) {
            try { this.ui.slider.style.pointerEvents = 'none'; } catch {}
            TimelineUtils.removeElementSafe(this.ui.slider);
        }
        const straySlider = document.querySelector('.timeline-left-slider');
        if (straySlider) {
            try { straySlider.style.pointerEvents = 'none'; } catch {}
            TimelineUtils.removeElementSafe(straySlider);
        }
        
        // ✅ 修复：清理收藏按钮和面板
        TimelineUtils.removeElementSafe(this.ui.starredBtn);
        TimelineUtils.removeElementSafe(this.ui.starredPanel);
        
        // Clear references
        this.ui = { timelineBar: null, tooltip: null, track: null, trackContent: null, slider: null, sliderHandle: null };
        this.markers = [];
        this.activeTurnId = null;
        this.scrollContainer = null;
        this.conversationContainer = null;
        this.onTimelineBarClick = null;
        this.onTimelineBarOver = null;
        this.onTimelineBarOut = null;
        this.onTimelineBarFocusIn = null;
        this.onTimelineBarFocusOut = null;
        this.onTooltipEnter = null; // ✅ 需求2：清理 tooltip 事件引用
        this.onTooltipLeave = null; // ✅ 需求2：清理 tooltip 事件引用
        this.onScroll = null;
        this.onWindowResize = null;
        this.onBarEnter = this.onBarLeave = this.onSliderEnter = this.onSliderLeave = null;
        this.onVisualViewportResize = null;
        // ✅ 移除：长按相关的引用已删除
        this.onSliderDown = this.onSliderMove = this.onSliderUp = null;
        this.pendingActiveId = null;
    }

    // --- Star/Highlight helpers ---
    async loadStars() {
        this.starred.clear();
        this.starredIndexes.clear();
        try {
            // 使用完整 URL（去掉协议）作为前缀
            const url = location.href.replace(/^https?:\/\//, '');
            const prefix = `chatTimelineStar:${url}:`;
            
            // 使用 StorageAdapter 获取所有匹配的收藏
            const items = await StorageAdapter.getAllByPrefix(prefix);
            
            // 提取 index
            Object.keys(items).forEach(key => {
                const indexStr = key.substring(prefix.length);
                const index = parseInt(indexStr, 10);
                if (!isNaN(index)) {
                    this.starredIndexes.add(index);
                }
            });
        } catch (e) {
            // Silently fail
        }
    }

    async saveStarItem(index, question) {
        try {
            const urlWithoutProtocol = location.href.replace(/^https?:\/\//, '');
            const key = `chatTimelineStar:${urlWithoutProtocol}:${index}`;
            const value = { 
                url: location.href,
                urlWithoutProtocol: urlWithoutProtocol,
                index: index,
                question: question || '',
                timestamp: Date.now()
            };
            await StorageAdapter.set(key, value);
        } catch (e) {
            // Silently fail
        }
    }
    
    // ✅ 从 URL 获取网站信息（名称和颜色）
    getSiteInfoFromUrl(url) {
        try {
            // 提取域名
            let hostname = url;
            if (url.startsWith('http://') || url.startsWith('https://')) {
                hostname = new URL(url).hostname;
            } else {
                // 如果是 url without protocol，取第一个 / 之前的部分
                hostname = url.split('/')[0];
            }
            
            // 遍历映射字典，查找匹配的域名
            for (const [domain, info] of Object.entries(this.siteNameMap)) {
                if (hostname.includes(domain)) {
                    return info;
                }
            }
            
            // 如果没有匹配，返回域名的主要部分和默认颜色
            const parts = hostname.split('.');
            if (parts.length >= 2) {
                return { 
                    name: parts[parts.length - 2], 
                    color: '#6B7280' // 默认灰色
                };
            }
            return { name: '未知网站', color: '#6B7280' };
        } catch {
            return { name: '未知网站', color: '#6B7280' };
        }
    }
    
    // ✅ 从 URL 获取网站名称
    getSiteNameFromUrl(url) {
        return this.getSiteInfoFromUrl(url).name;
    }
    
    // ✅ 从 URL 获取网站颜色
    getSiteColorFromUrl(url) {
        return this.getSiteInfoFromUrl(url).color;
    }

    async removeStarItem(index) {
        try {
            const url = location.href.replace(/^https?:\/\//, '');
            const key = `chatTimelineStar:${url}:${index}`;
            await StorageAdapter.remove(key);
        } catch (e) {
            // Silently fail
        }
    }

    toggleStar(turnId) {
        const id = String(turnId || '');
        if (!id) return;
        
        const m = this.markerMap.get(id);
        if (!m) return;
        
        const index = this.markers.indexOf(m);
        if (index === -1) return;
        
        // 切换收藏状态
        if (this.starred.has(id)) {
            this.starred.delete(id);
            this.starredIndexes.delete(index);
            this.removeStarItem(index);
        } else {
            this.starred.add(id);
            this.starredIndexes.add(index);
            this.saveStarItem(index, m.summary);
        }
        
        m.starred = this.starred.has(id);
        
        // ✅ 更新圆点样式：添加或移除 starred 类（变橙金色）
        if (m.dotElement) {
            try {
                m.dotElement.classList.toggle('starred', this.starred.has(id));
                // If tooltip is visible and anchored to this dot, update immediately
                this.refreshTooltipForDot(m.dotElement);
            } catch {}
        }
        
        // 更新收藏列表 UI
        this.updateStarredListUI();
        // 更新收藏按钮显示状态
        this.updateStarredBtnVisibility();
    }
    
    // 获取所有收藏的消息（所有网站的收藏，不限于当前网站）
    async getStarredMessages() {
        const starredMessages = [];
        try {
            // ✅ 使用 StorageAdapter 获取所有网站的收藏（跨网站共享）
            // 注意：这里不过滤当前网站，获取所有以 'chatTimelineStar:' 开头的条目
            const items = await StorageAdapter.getAllByPrefix('chatTimelineStar:');
            
            Object.keys(items).forEach(key => {
                try {
                    const data = items[key];
                    
                    // 优先使用存储的字段，如果没有则从 key 中解析（兼容旧数据）
                    // 从 key 中提取 url 和 index（用于兼容旧数据）
                    const parts = key.split(':');
                    
                    const urlWithoutProtocol = data.urlWithoutProtocol || parts.slice(1, -1).join(':');
                    const index = data.index !== undefined ? data.index : parseInt(parts[parts.length - 1], 10);
                    const fullUrl = data.url || `https://${urlWithoutProtocol}`;
                    
                    if (isNaN(index)) return;
                    
                    // ✅ 添加所有收藏，不过滤网站
                    const siteInfo = this.getSiteInfoFromUrl(fullUrl);
                    starredMessages.push({
                        index: index,
                        question: data.question || '',
                        url: fullUrl,
                        urlWithoutProtocol: urlWithoutProtocol,
                        siteName: siteInfo.name,
                        siteColor: siteInfo.color,
                        timestamp: data.timestamp || 0,
                        isCurrentPage: urlWithoutProtocol === location.href.replace(/^https?:\/\//, '')
                    });
                } catch (e) {
                    // 忽略解析错误的条目
                }
            });
        } catch (e) {
            // Silently fail
        }
        
        // 按时间倒序排序（最新的在前）
        return starredMessages.sort((a, b) => b.timestamp - a.timestamp);
    }
    
    // 切换收藏面板显示/隐藏
    toggleStarredPanel() {
        if (!this.ui.starredPanel) return;
        const isVisible = this.ui.starredPanel.classList.contains('visible');
        if (isVisible) {
            this.hideStarredPanel();
        } else {
            this.showStarredPanel();
        }
    }
    
    // 显示收藏面板
    async showStarredPanel() {
        if (!this.ui.starredPanel) return;
        await this.updateStarredListUI();
        this.ui.starredPanel.classList.add('visible');
    }
    
    // 隐藏收藏面板
    hideStarredPanel() {
        if (!this.ui.starredPanel) return;
        this.ui.starredPanel.classList.remove('visible');
    }
    
    // 更新收藏列表UI
    async updateStarredListUI() {
        if (!this.ui.starredList) return;
        
        const starredMessages = await this.getStarredMessages();
        
        if (starredMessages.length === 0) {
            this.ui.starredList.innerHTML = `<div class="timeline-starred-empty">${chrome.i18n.getMessage('noStarredItems')}</div>`;
            return;
        }
        
        const itemsHTML = starredMessages.map((item) => {
            return `
                <div class="timeline-starred-item" data-url="${this.escapeHTML(item.urlWithoutProtocol)}" data-index="${item.index}">
                    <span class="timeline-starred-item-tag" style="background-color: #000000; color: #FFFFFF;">${this.escapeHTML(item.siteName)}</span>
                    <span class="timeline-starred-item-question" data-full-text="${this.escapeHTML(item.question)}">${this.escapeHTML(item.question)}</span>
                    <div class="timeline-starred-item-actions">
                        <button class="timeline-starred-item-star" data-url="${this.escapeHTML(item.urlWithoutProtocol)}" data-index="${item.index}" data-tooltip="${this.escapeHTML(chrome.i18n.getMessage('clickToUnstar'))}">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 26 26"><path fill="rgb(255, 125, 3)" stroke="rgb(255, 125, 3)" stroke-width="0.5" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                        </button>
                        <span class="timeline-starred-item-goto" data-url="${this.escapeHTML(item.url)}" data-index="${item.index}" data-is-current="${item.isCurrentPage}" data-tooltip="${this.escapeHTML(chrome.i18n.getMessage('goToTooltip'))}">${chrome.i18n.getMessage('goTo')}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        this.ui.starredList.innerHTML = itemsHTML;
        
        // 绑定五角星点击事件（取消收藏）
        this.ui.starredList.querySelectorAll('.timeline-starred-item-star').forEach(btn => {
            // 添加自定义tooltip
            this.bindCustomTooltip(btn);
            
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                
                // ✅ 修复：立即移除当前tooltip，避免残留
                const existingTooltip = document.querySelector('.timeline-starred-question-tooltip.visible');
                if (existingTooltip) {
                    existingTooltip.classList.remove('visible');
                    setTimeout(() => {
                        if (existingTooltip && existingTooltip.parentNode) {
                            existingTooltip.parentNode.removeChild(existingTooltip);
                        }
                    }, 150);
                }
                
                const url = btn.dataset.url;
                const index = parseInt(btn.dataset.index, 10);
                if (!isNaN(index)) {
                    // 直接删除存储条目
                    try {
                        const key = `chatTimelineStar:${url}:${index}`;
                        await StorageAdapter.remove(key);
                        
                        // 如果是当前页面，同步更新状态
                        if (url === location.href.replace(/^https?:\/\//, '')) {
                            this.starredIndexes.delete(index);
                            const marker = this.markers[index];
                            if (marker && marker.id) {
                                this.starred.delete(marker.id);
                                marker.starred = false;
                                if (marker.dotElement) {
                                    marker.dotElement.classList.remove('starred');
                                    this.refreshTooltipForDot(marker.dotElement);
                                }
                            }
                        }
                        
                        // 重新渲染列表
                        await this.updateStarredListUI();
                        // 更新收藏按钮显示状态
                        await this.updateStarredBtnVisibility();
                    } catch (e) {
                        // Silently fail
                    }
                }
            });
        });
        
        // 绑定问题文本的tooltip事件（即时显示完整文本）
        this.ui.starredList.querySelectorAll('.timeline-starred-item-question').forEach(questionEl => {
            let tooltipEl = null;
            
            questionEl.addEventListener('mouseenter', (e) => {
                const fullText = questionEl.getAttribute('data-full-text');
                if (!fullText) return;
                
                // 创建tooltip元素
                tooltipEl = document.createElement('div');
                tooltipEl.className = 'timeline-starred-question-tooltip';
                tooltipEl.textContent = fullText;
                document.body.appendChild(tooltipEl);
                
                // 计算位置
                const rect = questionEl.getBoundingClientRect();
                const tooltipRect = tooltipEl.getBoundingClientRect();
                
                let left = rect.left;
                let top = rect.top - tooltipRect.height - 8;
                let placement = 'top'; // 默认显示在上方
                
                // 防止超出视口
                if (left + tooltipRect.width > window.innerWidth - 20) {
                    left = window.innerWidth - tooltipRect.width - 20;
                }
                if (left < 20) {
                    left = 20;
                }
                if (top < 20) {
                    top = rect.bottom + 8; // 显示在下方
                    placement = 'bottom';
                }
                
                tooltipEl.style.left = `${left}px`;
                tooltipEl.style.top = `${top}px`;
                tooltipEl.setAttribute('data-placement', placement); // 设置位置属性，用于箭头定位
                
                // 计算箭头的水平位置（指向元素左侧起点）
                const elementLeftX = rect.left + 20; // 箭头指向问题文本的左侧偏移一点
                const arrowLeft = elementLeftX - left;
                tooltipEl.style.setProperty('--arrow-left', `${arrowLeft}px`);
                
                // 触发显示动画
                setTimeout(() => tooltipEl.classList.add('visible'), 10);
            });
            
            questionEl.addEventListener('mouseleave', () => {
                if (tooltipEl) {
                    tooltipEl.classList.remove('visible');
                    setTimeout(() => {
                        if (tooltipEl && tooltipEl.parentNode) {
                            tooltipEl.parentNode.removeChild(tooltipEl);
                        }
                        tooltipEl = null;
                    }, 150);
                }
            });
            
            // ✅ 添加点击复制功能
            questionEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const fullText = questionEl.getAttribute('data-full-text');
                if (fullText) {
                    this.copyToClipboard(fullText, questionEl);
                }
            });
        });
        
        // 绑定前往按钮点击事件
        this.ui.starredList.querySelectorAll('.timeline-starred-item-goto').forEach(btn => {
            // 添加自定义tooltip
            this.bindCustomTooltip(btn);
            
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const targetUrl = btn.dataset.url;
                const index = parseInt(btn.dataset.index, 10);
                const isCurrentPage = btn.dataset.isCurrent === 'true';
                
                if (isNaN(index)) return;
                
                if (isCurrentPage) {
                    // 当前页面，直接定位
                    const marker = this.markers[index];
                    if (marker && marker.element) {
                        this.smoothScrollTo(marker.element);
                        this.hideStarredPanel();
                    }
                } else {
                    // 跨页面跳转
                    // 判断是否跨网站（比较域名）
                    const currentHostname = location.hostname;
                    let targetHostname = currentHostname;
                    
                    try {
                        const url = new URL(targetUrl);
                        targetHostname = url.hostname;
                    } catch (e) {
                        // 如果解析失败，假设是同一网站
                    }
                    
                    const isCrossSite = currentHostname !== targetHostname;
                    
                    // 保存导航数据
                    await this.setNavigateData('targetIndex', index);
                    
                    if (isCrossSite) {
                        // 跨网站：在新标签页打开
                        window.open(targetUrl, '_blank', 'noopener,noreferrer');
                        // 关闭收藏面板
                        this.hideStarredPanel();
                    } else {
                        // 同一网站：当前标签页跳转
                        window.location.href = targetUrl;
                    }
                }
            });
        });
    }
    
    // ✅ 复制文本到剪贴板并显示反馈
    async copyToClipboard(text, targetElement) {
        try {
            // 使用现代 Clipboard API
            await navigator.clipboard.writeText(text);
            
            // 显示复制成功提示
            this.showCopyFeedback(targetElement);
        } catch (err) {
            // 降级方案：使用传统方法
            try {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                
                // 显示复制成功提示
                this.showCopyFeedback(targetElement);
            } catch (e) {
                console.error('复制失败:', e);
            }
        }
    }
    
    // ✅ 显示复制成功的反馈提示
    showCopyFeedback(targetElement) {
        // 创建提示元素
        const feedback = document.createElement('div');
        feedback.className = 'timeline-copy-feedback';
        feedback.textContent = chrome.i18n.getMessage('copied');
        document.body.appendChild(feedback);
        
        // 计算位置（显示在内容区上方居中）
        const targetRect = targetElement.getBoundingClientRect();
        const feedbackRect = feedback.getBoundingClientRect();
        
        // 水平居中对齐内容区
        const x = targetRect.left + (targetRect.width - feedbackRect.width) / 2;
        // 显示在内容区上方10px处
        const y = targetRect.top - feedbackRect.height - 10;
        
        feedback.style.left = `${x}px`;
        feedback.style.top = `${y}px`;
        
        // 显示动画
        requestAnimationFrame(() => {
            feedback.classList.add('visible');
        });
        
        // 1秒后隐藏并移除
        setTimeout(() => {
            feedback.classList.remove('visible');
            setTimeout(() => {
                if (feedback.parentNode) {
                    feedback.parentNode.removeChild(feedback);
                }
            }, 150);
        }, 1000);
    }
    
    // ✅ 为元素绑定自定义tooltip（快速响应，无延迟，带箭头）
    bindCustomTooltip(element) {
        if (!element) return;
        
        let tooltipEl = null;
        
        element.addEventListener('mouseenter', (e) => {
            const tooltipText = element.getAttribute('data-tooltip');
            if (!tooltipText) return;
            
            // 创建tooltip元素
            tooltipEl = document.createElement('div');
            tooltipEl.className = 'timeline-starred-question-tooltip';
            tooltipEl.textContent = tooltipText;
            document.body.appendChild(tooltipEl);
            
            // 计算位置
            const rect = element.getBoundingClientRect();
            const tooltipRect = tooltipEl.getBoundingClientRect();
            
            let left = rect.left + (rect.width - tooltipRect.width) / 2; // 水平居中
            let top = rect.top - tooltipRect.height - 8; // 显示在上方
            let placement = 'top'; // 默认显示在上方
            
            // 防止超出视口
            if (left + tooltipRect.width > window.innerWidth - 20) {
                left = window.innerWidth - tooltipRect.width - 20;
            }
            if (left < 20) {
                left = 20;
            }
            if (top < 20) {
                top = rect.bottom + 8; // 显示在下方
                placement = 'bottom';
            }
            
            tooltipEl.style.left = `${left}px`;
            tooltipEl.style.top = `${top}px`;
            tooltipEl.setAttribute('data-placement', placement); // 设置位置属性，用于箭头定位
            
            // 计算箭头的水平位置（指向元素中心）
            const elementCenterX = rect.left + rect.width / 2;
            const arrowLeft = elementCenterX - left;
            tooltipEl.style.setProperty('--arrow-left', `${arrowLeft}px`);
            
            // 立即显示（无延迟）
            requestAnimationFrame(() => {
                if (tooltipEl) {
                    tooltipEl.classList.add('visible');
                }
            });
        });
        
        element.addEventListener('mouseleave', () => {
            if (tooltipEl) {
                tooltipEl.classList.remove('visible');
                setTimeout(() => {
                    if (tooltipEl && tooltipEl.parentNode) {
                        tooltipEl.parentNode.removeChild(tooltipEl);
                    }
                    tooltipEl = null;
                }, 150);
            }
        });
    }
    
    // HTML 转义（防止XSS）
    // ✅ 设置导航数据（用于跨页面导航）
    // ✅ 检查是否有收藏数据
    async hasStarredData() {
        try {
            const items = await StorageAdapter.getAllByPrefix('chatTimelineStar:');
            return Object.keys(items).length > 0;
        } catch (e) {
            return false;
        }
    }
    
    // ✅ 更新收藏按钮显示状态
    async updateStarredBtnVisibility() {
        if (!this.ui.starredBtn) return;
        
        const hasData = await this.hasStarredData();
        if (hasData) {
            this.ui.starredBtn.style.display = 'flex';
        } else {
            this.ui.starredBtn.style.display = 'none';
        }
    }
    
    // ✅ 设置导航数据（用于跨页面导航）
    async setNavigateData(key, value) {
        try {
            await StorageAdapter.set(`chatTimelineNavigate:${key}`, value);
        } catch (e) {
            // Silently fail
        }
    }
    
    // ✅ 获取并删除导航数据
    async getNavigateData(key) {
        try {
            const fullKey = `chatTimelineNavigate:${key}`;
            const value = await StorageAdapter.get(fullKey);
            if (value !== undefined) {
                await StorageAdapter.remove(fullKey);
                return value;
            }
        } catch (e) {
            // Silently fail
        }
        return null;
    }
    
    escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ✅ 移除：cancelLongPress 方法已删除，长按收藏功能已移除
}

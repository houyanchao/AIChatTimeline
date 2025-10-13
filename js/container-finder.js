/**
 * Container Finder - 容器查找策略
 * 
 * 提供统一的对话容器查找逻辑，用于所有 AI 平台适配器
 * 
 * 核心策略：
 * 1. 优先查找可滚动容器（确保能监听到新消息）
 * 2. 如果找不到，使用固定深度向上查找
 * 3. 兜底机制：返回合理的父容器
 */

const ContainerFinder = {
    /**
     * 智能查找对话容器
     * 
     * @param {HTMLElement} firstMessage - 第一个用户消息元素
     * @param {Object} options - 配置选项
     * @param {number} options.maxDepth - 最大向上查找深度，默认 15
     * @param {number} options.fallbackDepth - 兜底查找深度，默认 10
     * @returns {HTMLElement|null} 找到的容器元素
     */
    findConversationContainer(firstMessage, options = {}) {
        if (!firstMessage) return null;
        
        const {
            maxDepth = 15,
            fallbackDepth = 10
        } = options;
        
        let container = firstMessage;
        let scrollableContainer = null;
        let depth = 0;
        
        // 第一步：优先查找可滚动容器
        while (container && container !== document.body && depth < maxDepth) {
            container = container.parentElement;
            depth++;
            
            if (!container) break;
            
            // 检查是否为可滚动容器
            const style = window.getComputedStyle(container);
            const isScrollable = style.overflow === 'auto' || 
                               style.overflow === 'scroll' || 
                               style.overflowY === 'auto' || 
                               style.overflowY === 'scroll';
            
            // 确认容器真的可以滚动（内容高度 > 可见高度）
            if (isScrollable && container.scrollHeight > container.clientHeight) {
                scrollableContainer = container;
                break;
            }
        }
        
        // 第二步：如果找到可滚动容器，直接返回
        if (scrollableContainer) {
            return scrollableContainer;
        }
        
        // 第三步：兜底策略 - 向上查找固定深度的父容器
        let fallbackContainer = firstMessage;
        for (let i = 0; i < fallbackDepth && fallbackContainer && fallbackContainer.parentElement; i++) {
            fallbackContainer = fallbackContainer.parentElement;
            // 避免返回 body
            if (fallbackContainer === document.body) {
                break;
            }
        }
        
        return fallbackContainer || firstMessage.parentElement;
    },
    
    /**
     * 验证容器是否有效（可选的验证方法）
     * 
     * @param {HTMLElement} container - 待验证的容器
     * @param {string} messageSelector - 消息元素的选择器
     * @param {number} minMessages - 容器中应该至少包含的消息数量，默认 1
     * @returns {boolean} 容器是否有效
     */
    validateContainer(container, messageSelector, minMessages = 1) {
        if (!container || !messageSelector) return false;
        
        try {
            const messages = container.querySelectorAll(messageSelector);
            return messages.length >= minMessages;
        } catch {
            return false;
        }
    }
};


/**
 * Gemini Adapter
 * 
 * Supports: gemini.google.com
 * Features: Angular custom element, index-based ID, filters Angular comment nodes
 */

class GeminiAdapter extends SiteAdapter {
    constructor() {
        super();
    }

    matches(url) {
        return url.includes('gemini.google.com');
    }

    getUserMessageSelector() {
        return 'user-query';
    }

    generateTurnId(element, index) {
        return `gemini-${index}`;
    }

    extractText(element) {
        // Extract from .query-text-line elements
        const lines = element.querySelectorAll('.query-text-line');
        const texts = Array.from(lines).map(line => {
            // Filter out Angular comment nodes and get text
            return Array.from(line.childNodes)
                .filter(node => node.nodeType === Node.TEXT_NODE)
                .map(node => node.textContent)
                .join('');
        });
        return texts.join(' ').replace(/\s+/g, ' ').trim();
    }

    isConversationRoute(pathname) {
        // Gemini conversation URLs: /app/xxx
        return pathname.includes('/app/');
    }

    extractConversationId(pathname) {
        try {
            // Extract conversation ID from /app/xxx pattern
            const match = pathname.match(/\/app\/([A-Za-z0-9_-]+)/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    findConversationContainer(firstMessage) {
        // 使用统一的容器查找策略
        return ContainerFinder.findConversationContainer(firstMessage);
    }

    getTimelinePosition() {
        // Gemini 需要更大的边距，避开顶部工具栏
        return {
            top: '120px',      // 避开顶部导航栏
            right: '22px',    // 右侧边距
            bottom: '120px',   // 避开底部输入框
        };
    }
    
    getStarChatButtonTarget() {
        // Gemini 页面布局复杂，暂时禁用原生插入，避免影响页面布局
        return null;
    }
    
    getStarChatButtonPosition() {
        // Gemini 使用固定定位，显示在右上角
        return {
            top: '20px',
            right: '70px'  // 避开右侧的其他按钮
        };
    }
    
    getDefaultChatTheme() {
        // Gemini 从特定 DOM 结构中提取对话标题
        try {
            // 1. 找到 data-test-id="conversation" 且 class 中包含 selected 的元素
            const conversations = document.querySelectorAll('[data-test-id="conversation"]');
            let selectedConversation = null;
            
            for (const conv of conversations) {
                if (conv.className.includes('selected')) {
                    selectedConversation = conv;
                    break;
                }
            }
            
            if (!selectedConversation) return '';
            
            // 2. 找到 conversation-title 元素
            const titleElement = selectedConversation.querySelector('.conversation-title');
            if (!titleElement) return '';
            
            // 3. 提取直接文本节点（排除其他元素节点）
            let textContent = '';
            for (const node of titleElement.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    textContent += node.textContent || '';
                }
            }
            
            return textContent.trim();
        } catch {
            return '';
        }
    }
}


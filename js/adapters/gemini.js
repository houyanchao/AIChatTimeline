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
            top: '100px',      // 避开顶部导航栏
            right: '20px',    // 右侧边距
            bottom: '100px',   // 避开底部输入框
        };
    }
}


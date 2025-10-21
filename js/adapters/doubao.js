/**
 * Doubao (豆包) Adapter
 * 
 * Supports: doubao.com
 * Features: Uses data-testid for selection, index-based ID, extracts from message_text_content
 */

class DoubaoAdapter extends SiteAdapter {
    constructor() {
        super();
    }

    matches(url) {
        return url.includes('doubao.com');
    }

    getUserMessageSelector() {
        return '[data-testid="send_message"]';
    }

    generateTurnId(element, index) {
        return `doubao-${index}`;
    }

    extractText(element) {
        // Extract from message_text_content element
        const textEl = element.querySelector('[data-testid="message_text_content"]');
        return textEl?.textContent?.trim() || '';
    }

    isConversationRoute(pathname) {
        // Doubao conversation URLs: /chat/数字ID
        return pathname.includes('/chat/');
    }

    extractConversationId(pathname) {
        try {
            // Extract conversation ID from /chat/数字 pattern
            const match = pathname.match(/\/chat\/(\d+)/);
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
        // Doubao 位置配置（可根据实际情况调整）
        return {
            top: '120px',      // 避开顶部导航栏
            right: '22px',    // 右侧边距
            bottom: '120px',   // 避开底部输入框
        };
    }
    
    getStarChatButtonTarget() {
        // 返回分享按钮，收藏按钮将插入到它前面
        return document.querySelector('[data-testid="thread_share_btn_right_side"]');
    }
    
    getDefaultChatTheme() {
        // 豆包使用页面标题作为默认主题，并过滤尾部的 " - 豆包"
        const title = document.title || '';
        return title.replace(/\s*-\s*豆包\s*$/i, '').trim();
    }
}


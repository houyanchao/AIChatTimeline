/**
 * ChatGPT Adapter
 * 
 * Supports: chatgpt.com, chat.openai.com
 * Features: Uses native data-message-id when available, falls back to index
 */

class ChatGPTAdapter extends SiteAdapter {
    constructor() {
        super();
    }

    matches(url) {
        return url.includes('chatgpt.com') || url.includes('chat.openai.com');
    }

    getUserMessageSelector() {
        return '[data-message-author-role="user"]';
    }

    generateTurnId(element, index) {
        // Try to use native message-id if available, fallback to index
        const nativeId = element.getAttribute('data-message-id');
        return nativeId || `chatgpt-${index}`;
    }

    extractText(element) {
        // 从 whitespace-pre-wrap 类的元素中提取文本内容
        const textElement = element.querySelector('.whitespace-pre-wrap');
        return (textElement?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    isConversationRoute(pathname) {
        const segs = pathname.split('/').filter(Boolean);
        const i = segs.indexOf('c');
        if (i === -1) return false;
        const slug = segs[i + 1];
        return typeof slug === 'string' && slug.length > 0 && /^[A-Za-z0-9_-]+$/.test(slug);
    }

    extractConversationId(pathname) {
        try {
            const segs = pathname.split('/').filter(Boolean);
            const i = segs.indexOf('c');
            if (i === -1) return null;
            const slug = segs[i + 1];
            if (slug && /^[A-Za-z0-9_-]+$/.test(slug)) return slug;
            return null;
        } catch {
            return null;
        }
    }

    findConversationContainer(firstMessage) {
        // 使用统一的容器查找策略
        return ContainerFinder.findConversationContainer(firstMessage);
    }

    getTimelinePosition() {
        // ChatGPT 默认位置
        return {
            top: '120px',      // 避开顶部导航栏
            right: '20px',    // 右侧边距
            bottom: '120px',   // 避开底部输入框
        };
    }
    
    getStarChatButtonTarget() {
        // 返回分享按钮，收藏按钮将插入到它前面
        return document.querySelector('[data-testid="share-chat-button"]');
    }
    
    getDefaultChatTheme() {
        // ChatGPT 使用页面标题作为默认主题
        return document.title || '';
    }
}


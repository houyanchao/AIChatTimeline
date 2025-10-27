/**
 * ChatGPT Adapter
 * 
 * Supports: chatgpt.com, chat.openai.com, chatgpt.com/share/e/*
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
        
        // 检查普通对话路径: /c/{id}
        const cIndex = segs.indexOf('c');
        if (cIndex !== -1) {
            const slug = segs[cIndex + 1];
            if (typeof slug === 'string' && slug.length > 0 && /^[A-Za-z0-9_-]+$/.test(slug)) {
                return true;
            }
        }
        
        // 检查分享页面路径: /share/e/{id}
        const shareIndex = segs.indexOf('share');
        if (shareIndex !== -1 && segs[shareIndex + 1] === 'e') {
            const shareId = segs[shareIndex + 2];
            if (typeof shareId === 'string' && shareId.length > 0 && /^[A-Za-z0-9_-]+$/.test(shareId)) {
                return true;
            }
        }
        
        return false;
    }

    extractConversationId(pathname) {
        try {
            const segs = pathname.split('/').filter(Boolean);
            
            // 尝试提取普通对话 ID: /c/{id}
            const cIndex = segs.indexOf('c');
            if (cIndex !== -1) {
                const slug = segs[cIndex + 1];
                if (slug && /^[A-Za-z0-9_-]+$/.test(slug)) return slug;
            }
            
            // 尝试提取分享页面 ID: /share/e/{id}
            const shareIndex = segs.indexOf('share');
            if (shareIndex !== -1 && segs[shareIndex + 1] === 'e') {
                const shareId = segs[shareIndex + 2];
                if (shareId && /^[A-Za-z0-9_-]+$/.test(shareId)) return shareId;
            }
            
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
            right: '22px',    // 右侧边距
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


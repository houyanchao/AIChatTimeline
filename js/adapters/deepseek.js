/**
 * DeepSeek Adapter
 * 
 * Supports: chat.deepseek.com, chat.deepseek.com/share/*
 * Features: 动态检测用户消息 class（每次加载可能不同）
 */

class DeepSeekAdapter extends SiteAdapter {
    constructor() {
        super();
        this.userMessageBodyClass = null; // 动态检测的用户消息内容体 class
    }

    matches(url) {
        return url.includes('chat.deepseek.com');
    }

    getUserMessageSelector() {
        // 动态检测用户消息内容体的 class
        if (!this.userMessageBodyClass) {
            const firstMessage = document.querySelector('.ds-message');
            if (firstMessage) {
                const firstChild = firstMessage.querySelector('div');
                if (firstChild) {
                    this.userMessageBodyClass = firstChild.className;
                }
            }
        }
        
        // 返回包含该 class 子元素的 .ds-message 选择器
        if (this.userMessageBodyClass) {
            return `.ds-message:has(> .${this.userMessageBodyClass})`;
        }
        
        // 备用：如果检测失败，返回所有 ds-message（会包含 AI 回复，但至少能工作）
        return '.ds-message';
    }

    generateTurnId(element, index) {
        return `deepseek-${index}`;
    }

    extractText(element) {
        // 从第一个子 div 提取文本
        const firstDiv = element.querySelector('div');
        return firstDiv?.textContent?.trim() || '';
    }

    isConversationRoute(pathname) {
        // DeepSeek 对话 URL: /a/chat/s/{id} 或分享页面 /share/{id}
        return pathname.includes('/a/chat/s/') || pathname.includes('/share/');
    }

    extractConversationId(pathname) {
        try {
            // 从 /a/chat/s/fb39afdf-... 或 /share/xxx 提取对话 ID
            const chatMatch = pathname.match(/\/a\/chat\/s\/([^\/]+)/);
            if (chatMatch) return chatMatch[1];
            
            const shareMatch = pathname.match(/\/share\/([^\/]+)/);
            if (shareMatch) return shareMatch[1];
            
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
        // DeepSeek 位置配置
        return {
            top: '120px',       // 避开顶部导航栏
            right: '22px',     // 右侧边距
            bottom: '120px',    // 避开底部输入框
        };
    }
    
    getStarChatButtonTarget() {
        // 不使用原生插入，返回 null
        return null;
    }
    
    getStarChatButtonPosition() {
        // DeepSeek 使用固定定位，返回自定义位置
        return {
            top: '12px',
            right: '60px'
        };
    }
    
    getDefaultChatTheme() {
        // DeepSeek 使用页面标题作为默认主题，并过滤尾部的 " - DeepSeek"
        const title = document.title || '';
        return title.replace(/\s*-\s*DeepSeek\s*$/i, '').trim();
    }
}


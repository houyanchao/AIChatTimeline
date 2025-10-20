/**
 * Tongyi (通义千问) Adapter
 * 
 * Supports: tongyi.com
 * Features: 使用 class 前缀识别用户消息和文本内容
 */

class TongyiAdapter extends SiteAdapter {
    constructor() {
        super();
    }

    matches(url) {
        return url.includes('tongyi.com');
    }

    getUserMessageSelector() {
        // 基于 class 前缀 "questionItem" 识别用户消息容器
        return '[class*="questionItem"]';
    }

    generateTurnId(element, index) {
        return `tongyi-${index}`;
    }

    extractText(element) {
        // 文本在 bubble-- 开头的 class 中
        const bubble = element.querySelector('[class*="bubble"]');
        return bubble?.textContent?.trim() || element.textContent?.trim() || '';
    }

    isConversationRoute(pathname) {
        // 通义千问对话 URL: /?sessionId={id}
        return location.search.includes('sessionId=');
    }

    extractConversationId(pathname) {
        try {
            // 从 URL 参数中提取 sessionId
            const params = new URLSearchParams(location.search);
            return params.get('sessionId');
        } catch {
            return null;
        }
    }

    findConversationContainer(firstMessage) {
        // 使用统一的容器查找策略
        return ContainerFinder.findConversationContainer(firstMessage);
    }

    getTimelinePosition() {
        // 通义千问位置配置
        return {
            top: '120px',       // 避开顶部导航栏
            right: '20px',     // 右侧边距
            bottom: '120px',    // 避开底部输入框
        };
    }
    
    getStarChatButtonTarget() {
        // 返回 notifyContent 元素，收藏按钮将插入到它前面（左边）
        return document.querySelector('[class*="notifyContent"]');
    }
    
    getDefaultChatTheme() {
        // 通义千问默认主题为空
        return '';
    }
}


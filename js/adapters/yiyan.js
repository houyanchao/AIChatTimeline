/**
 * Yiyan (文心一言) Adapter
 * 
 * Supports: yiyan.baidu.com
 * Features: 使用 class 前缀识别用户消息
 */

class YiyanAdapter extends SiteAdapter {
    constructor() {
        super();
    }

    matches(url) {
        return url.includes('yiyan.baidu.com');
    }

    getUserMessageSelector() {
        // 基于 class 前缀 "questionText" 识别用户消息
        return '[class*="questionText"]';
    }

    generateTurnId(element, index) {
        return `yiyan-${index}`;
    }

    extractText(element) {
        // 文本在 span 子元素中
        const span = element.querySelector('span');
        return span?.textContent?.trim() || element.textContent?.trim() || '';
    }

    isConversationRoute(pathname) {
        // 文心一言对话 URL: /chat/{id}
        return pathname.includes('/chat/');
    }

    extractConversationId(pathname) {
        try {
            // 从 /chat/MjM2MDc0MjI2Mjo1MDU4NDg3MjI 提取对话 ID
            const match = pathname.match(/\/chat\/([^\/]+)/);
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
        // 文心一言位置配置
        return {
            top: '80px',       // 避开顶部导航栏
            right: '20px',     // 右侧边距
            bottom: '80px',    // 避开底部输入框
        };
    }
}


/**
 * Kimi Adapter
 * 
 * Supports: kimi.com
 * Features: 固定 class 名 user-content
 */

class KimiAdapter extends SiteAdapter {
    constructor() {
        super();
    }

    matches(url) {
        return url.includes('kimi.com');
    }

    getUserMessageSelector() {
        // Kimi 使用固定的 class 名
        return '.user-content';
    }

    generateTurnId(element, index) {
        return `kimi-${index}`;
    }

    extractText(element) {
        // 文本直接在元素中
        return element.textContent?.trim() || '';
    }

    isConversationRoute(pathname) {
        // Kimi 对话 URL: /chat/{id}
        return pathname.includes('/chat/');
    }

    extractConversationId(pathname) {
        try {
            // 从 /chat/cuq3h25m2citjh45prb0 提取对话 ID
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
        // Kimi 位置配置
        return {
            top: '80px',       // 避开顶部导航栏
            right: '20px',     // 右侧边距
            bottom: '80px',    // 避开底部输入框
        };
    }
}


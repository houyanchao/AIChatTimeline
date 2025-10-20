/**
 * Yuanbao (元宝) Adapter
 * 
 * Supports: yuanbao.tencent.com
 * Features: 使用 class 后缀匹配，URL 格式特殊
 */

class YuanbaoAdapter extends SiteAdapter {
    constructor() {
        super();
    }

    matches(url) {
        return url.includes('yuanbao.tencent.com');
    }

    getUserMessageSelector() {
        // 使用属性选择器匹配 class 以 "-content-text" 结尾的元素
        // 例如：hyc-content-text, abc-content-text 等
        return '[class$="-content-text"]';
    }

    generateTurnId(element, index) {
        return `yuanbao-${index}`;
    }

    extractText(element) {
        // 文本直接在元素中
        return element.textContent?.trim() || '';
    }

    isConversationRoute(pathname) {
        // 元宝对话 URL: /chat/{variable}/{id}
        return pathname.includes('/chat/');
    }

    extractConversationId(pathname) {
        try {
            // 从 /chat/naQivTmsDa/21187e6f-054c-4fee-b92b-c2386be40b65 提取最后一段作为对话 ID
            const segments = pathname.split('/').filter(Boolean);
            // 假设格式为 ['chat', 'variable', 'id']
            if (segments.length >= 3 && segments[0] === 'chat') {
                return segments[segments.length - 1]; // 返回最后一段
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
        // 元宝位置配置
        return {
            top: '120px',       // 避开顶部导航栏
            right: '20px',     // 右侧边距
            bottom: '120px',    // 避开底部输入框
        };
    }
    
    getStarChatButtonTarget() {
        // 返回 header__name 元素，收藏按钮将插入到它前面（左边）
        return document.querySelector('[class*="agent-dialogue__content--common__header__name"]');
    }
    
    getDefaultChatTheme() {
        // 元宝使用页面标题作为默认主题
        return document.title || '';
    }
}


/**
 * Adapter Registry
 * 
 * Manages all site adapters and provides auto-detection
 */

class SiteAdapterRegistry {
    constructor() {
        this.adapters = [
            new ChatGPTAdapter(),
            new GeminiAdapter(),
            new DoubaoAdapter(),
            new DeepSeekAdapter(),
            new YiyanAdapter(),
            new TongyiAdapter(),
            new KimiAdapter(),
            new YuanbaoAdapter(),
            // Add more adapters here in the future
        ];
    }

    /**
     * Detect and return the appropriate adapter for current site
     * @returns {SiteAdapter|null}
     */
    detectAdapter() {
        const url = location.href;
        for (const adapter of this.adapters) {
            if (adapter.matches(url)) {
                return adapter;
            }
        }
        return null;
    }

    /**
     * Check if current site is supported
     * @returns {boolean}
     */
    isSupportedSite() {
        return this.detectAdapter() !== null;
    }
}


/**
 * Flow Kit Extension Configuration
 *
 * Centralizes all configurable URLs and settings.
 * In single-VPS mode: defaults to localhost.
 * In split-VPS mode: configure via chrome.storage.local.
 */

const FlowConfig = {
  // Defaults (single VPS mode)
  defaults: {
    wsUrl: 'ws://127.0.0.1:9222',
    httpCallbackUrl: 'http://127.0.0.1:8100/api/ext/callback',
    authToken: null,  // Optional auth token for WS handshake
  },

  // Chrome Manager URL for Docker mode (port 8200)
  _chromeManagerUrl: 'http://127.0.0.1:8200',

  // Loaded values (from storage or defaults)
  _loaded: null,

  /**
   * Load configuration.
   * In Docker mode: fetches from Chrome Manager API first.
   * Falls back to chrome.storage.local, then defaults.
   */
  async load() {
    if (this._loaded) return this._loaded;

    // Try Chrome Manager config endpoint first (Docker mode)
    try {
      const resp = await fetch(`${this._chromeManagerUrl}/config`);
      if (resp.ok) {
        const remoteConfig = await resp.json();
        this._loaded = {
          wsUrl: remoteConfig.ws_url || this.defaults.wsUrl,
          httpCallbackUrl: remoteConfig.http_callback_url || this.defaults.httpCallbackUrl,
          authToken: remoteConfig.auth_token || this.defaults.authToken,
        };
        console.log('[FlowConfig] Loaded from Chrome Manager:', this._loaded.wsUrl);
        return this._loaded;
      }
    } catch (e) {
      // Chrome Manager not available — single VPS mode, fall through
    }

    // Fall back to chrome.storage.local (single VPS or split-VPS mode)
    try {
      const stored = await chrome.storage.local.get([
        'config_ws_url',
        'config_http_callback_url',
        'config_auth_token',
      ]);

      this._loaded = {
        wsUrl: stored.config_ws_url || this.defaults.wsUrl,
        httpCallbackUrl: stored.config_http_callback_url || this.defaults.httpCallbackUrl,
        authToken: stored.config_auth_token || this.defaults.authToken,
      };
    } catch (e) {
      console.warn('[FlowConfig] Failed to load from storage, using defaults:', e);
      this._loaded = { ...this.defaults };
    }

    return this._loaded;
  },

  /**
   * Save configuration to chrome.storage.local.
   * Triggers reload on next access.
   */
  async save(config) {
    const toStore = {};
    if (config.wsUrl !== undefined) toStore.config_ws_url = config.wsUrl;
    if (config.httpCallbackUrl !== undefined) toStore.config_http_callback_url = config.httpCallbackUrl;
    if (config.authToken !== undefined) toStore.config_auth_token = config.authToken;

    await chrome.storage.local.set(toStore);
    this._loaded = null; // Force reload on next access
  },

  /**
   * Get current config (sync, uses cached values).
   * Must call load() first.
   */
  get() {
    return this._loaded || { ...this.defaults };
  },

  /**
   * Reset to defaults.
   */
  async reset() {
    await chrome.storage.local.remove([
      'config_ws_url',
      'config_http_callback_url',
      'config_auth_token',
    ]);
    this._loaded = null;
  },

  /**
   * Get WebSocket URL (sync, uses cached).
   */
  getWsUrl() {
    return (this._loaded || this.defaults).wsUrl;
  },

  /**
   * Get HTTP callback URL (sync, uses cached).
   */
  getHttpCallbackUrl() {
    return (this._loaded || this.defaults).httpCallbackUrl;
  },

  /**
   * Get auth token (sync, uses cached).
   */
  getAuthToken() {
    return (this._loaded || this.defaults).authToken;
  },
};

// Make available globally for service worker
if (typeof globalThis !== 'undefined') {
  globalThis.FlowConfig = FlowConfig;
}

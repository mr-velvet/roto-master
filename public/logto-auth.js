class LogtoAuthClient {
  constructor(config) {
    this.endpoint = config.endpoint;
    this.appId = config.appId;
    this.client = null;
    this._readyPromise = this._init();
  }
  async _init() {
    const { default: LogtoClient } = await import('https://cdn.jsdelivr.net/npm/@logto/browser@3/+esm');
    this.client = new LogtoClient({
      endpoint: this.endpoint,
      appId: this.appId,
      scopes: ['email', 'profile'],
    });
  }
  async waitReady() { return this._readyPromise; }
  async signIn() {
    await this.waitReady();
    await this.client.signIn(window.location.origin + '/callback');
  }
  async handleCallback() {
    await this.waitReady();
    if (window.location.pathname === '/callback') {
      await this.client.handleSignInCallback(window.location.href);
      window.history.replaceState({}, '', '/');
    }
  }
  async isAuthenticated() {
    await this.waitReady();
    return this.client.isAuthenticated;
  }
  async getAccessToken() {
    await this.waitReady();
    try { return await this.client.getAccessToken(); } catch { return null; }
  }
  async signOut() {
    await this.waitReady();
    await this.client.signOut(window.location.origin);
  }
}
window.LogtoAuthClient = LogtoAuthClient;

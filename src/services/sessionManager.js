/**
 * Persistent Session Manager with Automatic Background Re-Authentication.
 * Fixes the issue: "siempre se sale de la sesion"
 */

import { Preferences } from '@capacitor/preferences';
import { login, updateSession } from './mideaApi';

const STORAGE_KEYS = {
  CREDENTIALS: 'mirage_credentials',
  SESSION: 'mirage_session',
  SETTINGS: 'mirage_settings',
  LOGGED_OUT: 'mirage_logged_out'
};

class SessionManager {
  constructor() {
    this.session = null;
    this.credentials = null;
    this.isReauthenticating = false;
    this.reauthPromise = null;
    this.keepAliveInterval = null;
    this.listeners = [];
  }

  // Subscribe to session state changes
  onStateChange(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  notifyStateChange() {
    for (const listener of this.listeners) {
      try {
        listener({
          isAuthenticated: this.isAuthenticated(),
          session: this.session,
          email: this.credentials?.email || this.session?.email
        });
      } catch (e) {
        console.error('Error in state listener:', e);
      }
    }
  }

  // Safe get from Preferences with localStorage fallback
  async getItem(key) {
    try {
      const res = await Preferences.get({ key });
      if (res && res.value) return JSON.parse(res.value);
    } catch {
      // Ignore Preferences error and fallback
    }
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : null;
  }

  // Safe set to Preferences with localStorage backup
  async setItem(key, value) {
    const serialized = JSON.stringify(value);
    try {
      await Preferences.set({ key, value: serialized });
    } catch {
      // Ignore
    }
    localStorage.setItem(key, serialized);
  }

  // Safe remove
  async removeItem(key) {
    try {
      await Preferences.remove({ key });
    } catch {
      // Ignore
    }
    localStorage.removeItem(key);
  }

  // Initialize session on app startup
  async init() {
    this.credentials = await this.getItem(STORAGE_KEYS.CREDENTIALS);
    this.session = await this.getItem(STORAGE_KEYS.SESSION);
    const loggedOut = await this.getItem(STORAGE_KEYS.LOGGED_OUT);
    const settings = await this.getSettings();

    // Explicit logout stays logged out until the user taps login again,
    // but saved credentials remain for prefill.
    if (loggedOut) {
      this.notifyStateChange();
      return false;
    }

    // "Auto login" off: stay on the login screen (prefill still applies).
    if (settings.autoLogin === false) {
      this.session = null;
      this.notifyStateChange();
      return false;
    }

    if (this.session && this.session.sessionId) {
      console.log('Session restored from persistent storage:', this.session.email);
      this.startKeepAlive();
      // If the stored token is old (> 15 min), refresh it proactively so the
      // app never works with a stale session. Failures are ignored (offline fallback).
      const ageMs = Date.now() - (this.session.loginTimestamp || 0);
      if (this.credentials?.email && this.credentials?.password && ageMs > 15 * 60 * 1000) {
        try {
          console.log('[SessionManager] Sesión guardada tiene más de 15 min. Renovando antes de continuar...');
          await this.silentRelogin();
        } catch (err) {
          console.warn('Background session refresh failed, keeping stored session:', err?.message);
        }
      }
    } else if (this.credentials && this.credentials.email && this.credentials.password) {
      // We have credentials but no active session, auto-login silently
      console.log('Credentials found, performing automatic silent login...');
      await this.silentRelogin().catch((err) => {
        console.warn('Initial silent login failed, will retry on demand:', err);
      });
    }

    this.notifyStateChange();
    return this.isAuthenticated();
  }

  // Method to check and refresh session proactively (e.g. on app resume or manual refresh)
  async ensureFreshSession() {
    if (!this.credentials?.email || !this.credentials?.password) {
      return this.session;
    }
    const ageMs = Date.now() - (this.session?.loginTimestamp || 0);
    if (!this.isAuthenticated() || ageMs > 15 * 60 * 1000) {
      try {
        console.log('[SessionManager] Renovando sesión proactivamente...');
        await this.silentRelogin();
      } catch (err) {
        console.warn('[SessionManager] Error al renovar sesión:', err?.message);
      }
    }
    return this.session;
  }

  isAuthenticated() {
    return !!(this.session && this.session.sessionId);
  }

  // Returns saved credentials (when "save access" is on) so the login
  // form can prefill them and the user doesn't have to type them again.
  async getSavedCredentials() {
    if (!this.credentials) {
      this.credentials = await this.getItem(STORAGE_KEYS.CREDENTIALS);
    }
    return this.credentials;
  }

  // Login screen preferences: auto-login at startup and credential saving.
  async getSettings() {
    const saved = await this.getItem(STORAGE_KEYS.SETTINGS);
    return {
      autoLogin: saved?.autoLogin !== false,
      saveCreds: saved?.saveCreds !== false
    };
  }

  async saveSettings(settings) {
    const merged = {
      ...(await this.getSettings()),
      ...(settings || {})
    };
    await this.setItem(STORAGE_KEYS.SETTINGS, merged);
    return merged;
  }

  getSessionId() {
    return this.session?.sessionId || '';
  }

  getUserEmail() {
    return this.credentials?.email || this.session?.email || '';
  }

  // Store successful session. Credentials are kept only when "save access"
  // is on; otherwise any previously saved ones are removed.
  // Logout only clears the session (never the saved access).
  async saveLogin(email, password, sessionData, options = {}) {
    const saveCreds = options.saveCreds !== false;
    this.credentials = saveCreds ? { email, password } : null;
    this.session = {
      ...sessionData,
      loginTimestamp: Date.now()
    };

    if (saveCreds) {
      await this.setItem(STORAGE_KEYS.CREDENTIALS, this.credentials);
    } else {
      await this.removeItem(STORAGE_KEYS.CREDENTIALS);
    }
    await this.setItem(STORAGE_KEYS.SESSION, this.session);
    await this.removeItem(STORAGE_KEYS.LOGGED_OUT);

    this.startKeepAlive();
    this.notifyStateChange();
  }

  // Perform silent relogin with saved credentials
  async silentRelogin() {
    if (!this.credentials || !this.credentials.email || !this.credentials.password) {
      throw new Error('No hay credenciales guardadas para reautenticar.');
    }

    // Mutex: Avoid duplicate simultaneous login requests
    if (this.isReauthenticating && this.reauthPromise) {
      return this.reauthPromise;
    }

    this.isReauthenticating = true;
    this.reauthPromise = (async () => {
      try {
        console.log('[SessionManager] Reautenticando sesión silenciosamente...');
        const sessionData = await login(this.credentials.email, this.credentials.password);
        this.session = {
          ...sessionData,
          loginTimestamp: Date.now()
        };
        await this.setItem(STORAGE_KEYS.SESSION, this.session);
        console.log('[SessionManager] Sesión renovada con éxito.');
        this.notifyStateChange();
        return this.session;
      } finally {
        this.isReauthenticating = false;
        this.reauthPromise = null;
      }
    })();

    return this.reauthPromise;
  }

  /**
   * Execute an API action with automatic retry and re-login on session failure.
   * This is the silver bullet against session dropouts!
   */
  async executeWithAutoRelogin(actionFn) {
    if (!this.isAuthenticated() && this.credentials) {
      await this.silentRelogin().catch(() => {});
    }

    try {
      return await actionFn(this.session);
    } catch (err) {
      const msg = err?.message || '';
      const code = err?.errorCode;
      const isSessionError =
        code === 3101 ||
        code === 3102 ||
        code === 3106 ||
        code === '3101' ||
        code === '3102' ||
        code === '3106' ||
        // HTTP 401/403 from the cloud also mean the token died, as do the
        // classic invalidSession/token messages.
        (/session|login|token|auth|expir|invalid|unauthori|401|403/i.test(msg));

      if (isSessionError && this.credentials) {
        console.warn('[SessionManager] La sesión expiró durante la petición. Renovando y reintentando automáticamente...');
        await this.silentRelogin();
        // Retry action with fresh session
        return await actionFn(this.session);
      }

      // Transient network failure (not a session problem): wait a moment and
      // retry the action once before surfacing the error.
      const isNetworkError =
        !isSessionError &&
        (/fetch|network|timeout|abort|econn|socket|5\d\d|offline|failed/i.test(msg));
      if (isNetworkError) {
        console.warn('[SessionManager] Fallo de red transitorio. Reintentando una vez...', msg);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return await actionFn(this.session);
      }

      throw err;
    }
  }

  // Start background keep-alive ping (every 10 minutes)
  startKeepAlive() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = setInterval(async () => {
      if (this.isAuthenticated()) {
        try {
          await updateSession(this.getSessionId());
          console.log('[SessionManager] Keep-alive ping sent.');
        } catch {
          // If ping fails due to session expiry, silently renew
          this.silentRelogin().catch(() => {});
        }
      }
    }, 10 * 60 * 1000);
  }

  // Explicit user logout: clears the session but KEEPS saved credentials
  // so the login form stays prefilled. Sets a flag so startup doesn't
  // auto-login until the user explicitly taps login again.
  async logout() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.session = null;
    await this.removeItem(STORAGE_KEYS.SESSION);
    await this.setItem(STORAGE_KEYS.LOGGED_OUT, true);
    this.notifyStateChange();
  }
}

export const sessionManager = new SessionManager();

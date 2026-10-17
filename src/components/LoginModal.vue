<script setup>
import { ref, onMounted } from 'vue';
import { login } from '../services/mideaApi';
import { sessionManager } from '../services/sessionManager';
import { LogIn, Sparkles, ShieldCheck, AlertCircle, Eye, EyeOff } from 'lucide-vue-next';

const emit = defineEmits(['login-success']);

const email = ref('');
const password = ref('');
const showPassword = ref(false);
const autoLogin = ref(true);
const saveCreds = ref(true);
const isLoading = ref(false);
const errorMessage = ref('');

// Prefill saved credentials and saved checkbox states
onMounted(async () => {
  try {
    const settings = await sessionManager.getSettings();
    autoLogin.value = settings.autoLogin !== false;
    saveCreds.value = settings.saveCreds !== false;
  } catch {
    // Keep defaults
  }
  try {
    const saved = await sessionManager.getSavedCredentials();
    if (saved?.email) email.value = saved.email;
    if (saved?.password) password.value = saved.password;
  } catch {
    // No saved credentials, leave the form empty
  }
});

async function handleLogin() {
  if (!email.value || !password.value) {
    errorMessage.value = 'Por favor ingresa tu correo y contraseña.';
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';

  try {
    const sessionData = await login(email.value, password.value);
    // Persist the checkbox choices first, then the session. Credentials are
    // only stored when "save access" is on; logout only clears the session.
    await sessionManager.saveSettings({ autoLogin: autoLogin.value, saveCreds: saveCreds.value });
    await sessionManager.saveLogin(email.value, password.value, sessionData, {
      saveCreds: saveCreds.value
    });
    emit('login-success', sessionData);
  } catch (err) {
    console.error('Error durante inicio de sesión:', err);
    errorMessage.value =
      err.message || 'Error al conectar con el servidor Mirage. Verifica tus datos.';
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="login-overlay">
    <div class="login-card glass-panel">
      <!-- App Header / Logo -->
      <div class="login-header">
        <div class="logo-badge">
          <Sparkles class="icon-sparkle" :size="28" />
        </div>
        <h2>Mirage Smart AC</h2>
        <p class="subtitle">Control Inteligente Mejorado</p>
      </div>

      <!-- Error alert -->
      <div v-if="errorMessage" class="error-banner">
        <AlertCircle :size="18" class="error-icon" />
        <span>{{ errorMessage }}</span>
      </div>

      <!-- Login Form -->
      <form @submit.prevent="handleLogin" class="login-form">
        <div class="input-group">
          <label>Correo Electrónico</label>
          <input
            v-model="email"
            type="email"
            placeholder="ejemplo@correo.com"
            required
            autocomplete="email"
            class="app-input"
          />
        </div>

        <div class="input-group">
          <label>Contraseña</label>
          <div class="password-wrapper">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="••••••••"
              required
              autocomplete="current-password"
              class="app-input"
            />
            <button
              type="button"
              class="toggle-eye"
              @click="showPassword = !showPassword"
              tabindex="-1"
            >
              <EyeOff v-if="showPassword" :size="18" />
              <Eye v-else :size="18" />
            </button>
          </div>
        </div>

        <div class="prefs-rows">
          <label class="checkbox-label">
            <input v-model="autoLogin" type="checkbox" />
            <span class="label-text">Iniciar sesión automáticamente</span>
          </label>
          <label class="checkbox-label">
            <input v-model="saveCreds" type="checkbox" />
            <span class="label-text">Guardar acceso (no volver a escribir)</span>
          </label>
        </div>

        <button
          type="submit"
          class="touch-btn primary-login-btn"
          :disabled="isLoading"
        >
          <LogIn v-if="!isLoading" :size="20" class="btn-icon" />
          <span v-if="!isLoading">Iniciar Sesión</span>
          <span v-else class="loader-text">Conectando...</span>
        </button>
      </form>

      <!-- Trust note -->
      <div class="trust-badge">
        <ShieldCheck :size="16" class="trust-icon" />
        <span>Conexión cifrada directa con servidor Mirage IoT (Sin intermediarios)</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-overlay {
  position: fixed;
  inset: 0;
  background: radial-gradient(circle at center, #111827 0%, #030712 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 1000;
}

.login-card {
  width: 100%;
  max-width: 420px;
  padding: 32px 28px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
}

.login-header {
  text-align: center;
  margin-bottom: 24px;
}

.logo-badge {
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, #0ea5e9, #3b82f6);
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  box-shadow: 0 10px 25px rgba(14, 165, 233, 0.4);
}

.icon-sparkle {
  color: white;
}

.login-header h2 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.subtitle {
  font-size: 14px;
  color: var(--text-muted);
  margin-top: 4px;
}

.error-banner {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 13px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.input-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}

.app-input {
  width: 100%;
  height: 48px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 0 16px;
  color: white;
  font-size: 15px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.app-input:focus {
  border-color: #38bdf8;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25);
}

.password-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.toggle-eye {
  position: absolute;
  right: 12px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.primary-login-btn {
  width: 100%;
  height: 50px;
  background: linear-gradient(135deg, #0284c7, #2563eb);
  color: white;
  font-weight: 600;
  font-size: 16px;
  border-radius: 14px;
  margin-top: 8px;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.35);
}

.primary-login-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.btn-icon {
  margin-right: 8px;
}

.trust-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 11px;
  color: #64748b;
  margin-top: 18px;
  text-align: center;
}

.trust-icon {
  color: #10b981;
}

.prefs-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 2px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #cbd5e1;
  cursor: pointer;
}

.checkbox-label input {
  accent-color: #0ea5e9;
  width: 16px;
  height: 16px;
}
</style>

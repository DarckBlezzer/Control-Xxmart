<script setup>
import { ref, onMounted, onUnmounted, reactive } from 'vue';
import { App as CapApp } from '@capacitor/app';
import LoginModal from './components/LoginModal.vue';
import AirConditioner from './components/AirConditioner.vue';
import { sessionManager } from './services/sessionManager';
import { getDeviceList, sendTransparentCmd } from './services/mideaApi';
import {
  buildQueryPacket,
  parseResponsePacket,
  buildGetPropertyPacket,
  parsePropertyReply,
  vaneValueToIndex,
  PropId,
  ACMode,
  ACFanSpeed
} from './services/mideaProtocol';
import { commandQueue } from './services/commandQueue';

const isAuthenticated = ref(false);
const isDemoMode = ref(false);
const isLoading = ref(true);
const isSyncing = ref(false);
const appliances = ref([]);
const activeApplianceIndex = ref(0);

// Synchronization watchdog
let lastSyncStartTime = 0;

// Toast system
const toastMessage = ref('');
const toastType = ref('info');
let toastTimer = null;

function showToast(msg, type = 'info', duration = 3000) {
  toastMessage.value = msg;
  toastType.value = type;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage.value = '';
  }, duration);
}

// Default/Initial AC state: starts as OFF until real device telemetry is loaded
const acState = reactive({
  power: false,
  mode: ACMode.COOL,
  targetTemperature: 24,
  indoorTemperature: null,
  outdoorTemperature: null,
  fanSpeed: ACFanSpeed.AUTO,
  swingVertical: false,
  swingHorizontal: false,
  swingVPos: null, // fixed vane position 1..5 (null = unknown)
  swingHPos: null,
  eco: false,
  turbo: false,
  sleep: false,
  screenDisplay: true
});

// Staged settings chosen by the user while the unit is off (remote LCD pattern)
const stagedPowerOffSettings = reactive({});

let pollingTimer = null;
let consecutivePollFailures = 0;
let lastVanePollTime = 0;
let capAppStateListener = null;
let capResumeListener = null;

onMounted(async () => {
  // Setup CommandQueue confirmed callbacks
  commandQueue.onStateConfirmed = (stateSent, replyHex) => {
    if (replyHex) {
      const parsed = parseResponsePacket(replyHex);
      if (parsed) {
        Object.assign(acState, parsed);
      }
    }
    const currentAppliance = appliances.value[activeApplianceIndex.value];
    if (currentAppliance) {
      currentAppliance.online = true;
      currentAppliance.onlineStatus = '1';
      consecutivePollFailures = 0;
    }
    showToast('Comando aplicado por el dispositivo', 'success', 2000);
  };

  commandQueue.onError = (err) => {
    showToast(`Error al enviar: ${err.message}`, 'error', 4000);
  };

  // Check saved session
  const hasSession = await sessionManager.init();
  isAuthenticated.value = hasSession;

  if (hasSession) {
    await fetchAppliances();
  }

  isLoading.value = false;

  // Listeners for mobile app lifecycle and network recovery
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', handleOnline);
  window.addEventListener('focus', handleFocus);

  // Native Capacitor lifecycle listeners (Android Activity onResume / appStateChange)
  try {
    capAppStateListener = await CapApp.addListener('appStateChange', async ({ isActive }) => {
      if (isActive) {
        console.log('[App] Capacitor appStateChange -> Activa. Verificando estado...');
        await handleResume();
      }
    });
    capResumeListener = await CapApp.addListener('resume', async () => {
      console.log('[App] Capacitor resume -> Reanudada. Verificando estado...');
      await handleResume();
    });
  } catch (err) {
    console.warn('[App] Capacitor App listener no soportado en web:', err?.message);
  }
});

onUnmounted(() => {
  if (pollingTimer) clearInterval(pollingTimer);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('focus', handleFocus);
  if (capAppStateListener?.remove) capAppStateListener.remove();
  if (capResumeListener?.remove) capResumeListener.remove();
});

// App resume / focus / network recovery handler
async function handleResume() {
  if (!isAuthenticated.value || isDemoMode.value) return;
  console.log('[App] App reanudada o red recuperada. Verificando sesión y estado...');

  // Reset stuck syncing flag if previous request timed out or was suspended by OS
  if (isSyncing.value && Date.now() - lastSyncStartTime > 6000) {
    console.warn('[App] Reseteando isSyncing colgado al reanudar.');
    isSyncing.value = false;
  }
  commandQueue.resetIfStuck();

  // Proactively guarantee fresh session before polling
  await sessionManager.ensureFreshSession().catch(() => {});

  startPolling();
  if (appliances.value.length === 0) {
    await fetchAppliances(true);
  } else {
    await pollApplianceStatus(true);
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    handleResume();
  }
}

function handleOnline() {
  showToast('Conexión de red restablecida', 'info', 2000);
  handleResume();
}

function handleFocus() {
  handleResume();
}

async function fetchAppliances(isSilent = false) {
  isSyncing.value = true;
  lastSyncStartTime = Date.now();
  try {
    const list = await sessionManager.executeWithAutoRelogin(async (session) => {
      return await getDeviceList(session);
    });

    if (list && list.length > 0) {
      appliances.value = list;
      if (!isSilent) {
        showToast(`Se encontró ${appliances.value[0].name || 'tu aire acondicionado'}`, 'success', 2500);
      }
      await pollApplianceStatus(true);
      startPolling();
      return true;
    } else {
      if (!isSilent) {
        showToast('No se encontraron aires acondicionados en tu cuenta Mirage.', 'info', 4000);
      }
      return false;
    }
  } catch (err) {
    console.error('Error al cargar dispositivos:', err);
    if (!isSilent) {
      showToast(`Error al obtener dispositivos: ${err.message || 'Error de conexión'}`, 'error', 4000);
    }
    return false;
  } finally {
    isSyncing.value = false;
  }
}

// Query device real-time status
async function pollApplianceStatus(force = false) {
  const currentAppliance = appliances.value[activeApplianceIndex.value];
  if (!currentAppliance || isDemoMode.value) return false;

  // Skip background poll if user has pending unsent clicks in the queue
  if (commandQueue.hasPendingCommands()) {
    console.log('[App] Omitiendo sondeo de estado porque hay comandos de usuario en espera.');
    return false;
  }

  // Prevent overlap unless forced or stuck (> 6s)
  if (isSyncing.value && !force) {
    if (Date.now() - lastSyncStartTime < 6000) {
      return false;
    }
    console.warn('[App] Reseteando sincronización previa atascada en pollApplianceStatus.');
  }

  isSyncing.value = true;
  lastSyncStartTime = Date.now();
  try {
    const queryHex = buildQueryPacket();
    const replyHex = await sessionManager.executeWithAutoRelogin(async (session) => {
      return await sendTransparentCmd(session, currentAppliance.id, queryHex);
    });

    if (replyHex) {
      const parsed = parseResponsePacket(replyHex);
      if (parsed) {
        // If the AC is off and user has staged settings in the UI, do NOT overwrite
        // the user's staged mode/temp/fan/vanes with the AC's old off-state memory
        if (!parsed.power && Object.keys(stagedPowerOffSettings).length > 0) {
          acState.indoorTemperature = parsed.indoorTemperature;
          acState.outdoorTemperature = parsed.outdoorTemperature;
          acState.power = false;
        } else {
          if (parsed.power) {
            for (const k in stagedPowerOffSettings) delete stagedPowerOffSettings[k];
          }
          Object.assign(acState, parsed);
        }
        // Valid response received: confirm device online
        currentAppliance.online = true;
        currentAppliance.onlineStatus = '1';
        consecutivePollFailures = 0;
      }
    }

    // Query vane angles only once every 60s to minimize network overhead
    const now = Date.now();
    if (now - lastVanePollTime > 60000 || force) {
      lastVanePollTime = now;
      await pollVanePositions(currentAppliance);
    }
    return true;
  } catch (err) {
    console.warn('Fallo al consultar estado:', err);
    consecutivePollFailures++;
    // If multiple consecutive polls fail, mark offline
    if (consecutivePollFailures >= 2) {
      currentAppliance.online = false;
      currentAppliance.onlineStatus = '0';
    }
    return false;
  } finally {
    isSyncing.value = false;
  }
}

// Manual user refresh handler (triggered by refresh icon or status tap)
async function handleManualRefresh() {
  // If a sync was triggered less than 2s ago, avoid double-click hammering
  if (isSyncing.value && Date.now() - lastSyncStartTime < 2000) {
    showToast('Actualización en curso...', 'info', 1200);
    return;
  }

  // Force reset stuck locks
  isSyncing.value = false;
  commandQueue.resetIfStuck();

  // Clear staged settings so manual refresh always pulls the real device telemetry
  for (const k in stagedPowerOffSettings) delete stagedPowerOffSettings[k];

  showToast('Actualizando estado...', 'info', 1500);

  // Proactively ensure fresh session before calling the transparent command
  await sessionManager.ensureFreshSession().catch(() => {});

  // If no appliances are loaded or current is not available, do a full fetch
  if (appliances.value.length === 0 || !appliances.value[activeApplianceIndex.value]) {
    const ok = await fetchAppliances();
    if (ok) {
      showToast('Aire acondicionado conectado', 'success', 2500);
    }
    return;
  }

  const currentAppliance = appliances.value[activeApplianceIndex.value];

  // If the appliance was marked offline, refresh cloud device list as well
  if (!currentAppliance.online && currentAppliance.onlineStatus !== '1') {
    await fetchAppliances(true);
  }

  // Force poll state and vane positions
  lastVanePollTime = 0;
  const pollOk = await pollApplianceStatus(true);

  if (pollOk) {
    showToast('Estado actualizado y en línea', 'success', 2000);
  } else {
    // If poll failed, try re-fetching appliances to see if cloud session/token or status updated
    const listOk = await fetchAppliances(true);
    if (!listOk && !currentAppliance.online) {
      showToast('El aire no responde. Revisa que esté encendido y conectado al WiFi.', 'error', 4000);
    } else if (listOk) {
      showToast('Datos de dispositivo sincronizados', 'info', 2000);
    }
  }
}

// Query vertical/horizontal louver fixed positions (0xB1 properties)
async function pollVanePositions(appliance) {
  const targets = [
    { propId: PropId.SWING_UD_ANGLE, key: 'swingVPos' },
    { propId: PropId.SWING_LR_ANGLE, key: 'swingHPos' }
  ];
  for (const { propId, key } of targets) {
    try {
      const getHex = buildGetPropertyPacket(propId);
      const replyHex = await sessionManager.executeWithAutoRelogin(async (session) => {
        return await sendTransparentCmd(session, appliance.id, getHex);
      });
      if (replyHex) {
        const parsed = parsePropertyReply(replyHex);
        const entry = parsed?.[propId];
        if (entry && !entry.error && typeof entry.value === 'number') {
          const idx = vaneValueToIndex(entry.value);
          if (idx) acState[key] = idx;
        }
      }
    } catch (err) {
      console.warn(`Fallo al consultar posición de ventila 0x${propId.toString(16)}:`, err);
    }
  }
}

function startPolling() {
  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = setInterval(() => {
    pollApplianceStatus();
  }, 10000);
}

// Handle instant user button action
function handleStateUpdate(partialState) {
  // 1. Optimistic instant local update
  Object.assign(acState, partialState);

  // If in demo mode, no network packet required
  if (isDemoMode.value) {
    commandQueue.triggerHaptic();
    showToast('Ajuste aplicado (Demo)', 'info', 1500);
    return;
  }

  // Pre-configuration staging:
  // If the AC is currently OFF and this update is NOT turning it ON:
  if (!acState.power && !partialState.power) {
    commandQueue.triggerHaptic();
    Object.assign(stagedPowerOffSettings, partialState);
    return;
  }

  // If turning ON: merge any staged settings into partialState so commandQueue transmits everything
  if (partialState.power) {
    Object.assign(partialState, stagedPowerOffSettings);
    // Clear staged settings once consumed
    for (const k in stagedPowerOffSettings) delete stagedPowerOffSettings[k];
  } else if (partialState.power === false) {
    // Turning OFF: clear staged settings
    for (const k in stagedPowerOffSettings) delete stagedPowerOffSettings[k];
  }

  // 2. Dispatch through resilient command queue.
  const currentAppliance = appliances.value[activeApplianceIndex.value];
  if (currentAppliance) {
    commandQueue.queueCommand(currentAppliance, acState, partialState);
  } else {
    // If no appliance loaded, trigger connection fetch automatically
    showToast('Buscando conexión con tu aire acondicionado...', 'info', 2000);
    fetchAppliances();
  }
}

function handleLoginSuccess() {
  isAuthenticated.value = true;
  isDemoMode.value = false;
  showToast('¡Sesión iniciada con éxito! Reconexión automática activa.', 'success');
  fetchAppliances();
}

function enableDemoMode() {
  isDemoMode.value = true;
  isAuthenticated.value = true;
  appliances.value = [
    {
      id: 'DEMO-MIRAGE-01',
      name: 'Mirage Inverter V30 (Demo)',
      type: '0xAC',
      modelNumber: 'MIR-INV-12K',
      onlineStatus: '1',
      online: true
    }
  ];
  showToast('Modo Demostración activado.', 'info');
}

async function handleLogout() {
  if (pollingTimer) clearInterval(pollingTimer);
  await sessionManager.logout();
  isAuthenticated.value = false;
  isDemoMode.value = false;
  appliances.value = [];
  showToast('Sesión cerrada.', 'info');
}
</script>

<template>
  <main class="app-root">
    <!-- Toast message overlay -->
    <transition name="fade">
      <div v-if="toastMessage" class="toast-bubble" :class="toastType">
        {{ toastMessage }}
      </div>
    </transition>

    <!-- Loading Screen -->
    <div v-if="isLoading" class="loading-container">
      <div class="spinner"></div>
      <p>Cargando Mirage Smart AC...</p>
    </div>

    <!-- Login Modal if unauthenticated -->
    <LoginModal
      v-else-if="!isAuthenticated"
      @login-success="handleLoginSuccess"
      @start-demo="enableDemoMode"
    />

    <!-- Main Controller Screen -->
    <AirConditioner
      v-else
      :appliance="appliances[activeApplianceIndex] || { name: 'Mirage Smart AC', id: '0' }"
      :state="acState"
      :is-demo="isDemoMode"
      :is-syncing="isSyncing"
      :all-appliances="appliances"
      @update-state="handleStateUpdate"
      @refresh-status="handleManualRefresh"
      @switch-appliance="(idx) => { activeApplianceIndex = idx; pollApplianceStatus(); }"
      @logout="handleLogout"
      @show-toast="showToast"
    />
  </main>
</template>

<style scoped>
.app-root {
  height: 100vh;
  height: 100dvh;
  width: 100%;
  display: flex;
  flex-direction: column;
  /* Dedicated vertical scroller so all sections (including bottom buttons)
     are reachable on small screens, above the Android navigation bar. */
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  scroll-padding-bottom: 24px;
}

.toast-bubble {
  position: fixed;
  top: max(env(safe-area-inset-top, 16px), 16px);
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 18px;
  border-radius: 24px;
  font-size: 13px;
  font-weight: 600;
  z-index: 9999;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
  max-width: 90vw;
  text-align: center;
}

.toast-bubble.info {
  background: rgba(30, 41, 59, 0.95);
  border: 1px solid rgba(56, 189, 248, 0.4);
  color: #38bdf8;
}

.toast-bubble.success {
  background: rgba(6, 78, 59, 0.95);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #34d399;
}

.toast-bubble.error {
  background: rgba(127, 29, 29, 0.95);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -10px);
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 16px;
  color: var(--text-muted);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #38bdf8;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

<script setup>
import { ref, computed } from 'vue';
import {
  Plus,
  Minus,
  Snowflake,
  Sun,
  Droplets,
  Wind,
  RotateCw,
  Moon,
  Zap,
  Leaf,
  Sliders,
  ChevronDown,
  RefreshCw,
  LogOut,
  Info,
  Tv,
  Volume2,
  VolumeX,
  Sparkles,
  ChevronsUp,
  ChevronUp,
  ChevronsDown,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight
} from 'lucide-vue-next';
import { ACMode, ACFanSpeed } from '../services/mideaProtocol';

const props = defineProps({
  appliance: {
    type: Object,
    required: true
  },
  state: {
    type: Object,
    required: true
  },
  isDemo: {
    type: Boolean,
    default: false
  },
  isSyncing: {
    type: Boolean,
    default: false
  },
  allAppliances: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits([
  'update-state',
  'refresh-status',
  'switch-appliance',
  'logout',
  'show-toast'
]);

const showDebugDrawer = ref(false);
const showSoundModal = ref(false);

// Vertical vane: single horizontal row [Auto | 1 2 3 4 5].
// Position icons read top-to-bottom: far-up, up, middle, down, far-down.
const VANE_BTNS = [
  { pos: 1, label: 'Arriba', icon: ChevronsUp },
  { pos: 2, label: 'Media-alta', icon: ChevronUp },
  { pos: 3, label: 'Media', icon: Minus },
  { pos: 4, label: 'Media-baja', icon: ChevronDown },
  { pos: 5, label: 'Abajo', icon: ChevronsDown }
];

// Current vane state labels for the section titles
const vaneStateLabel = computed(() => {
  if (props.state.swingVertical) return 'Auto';
  const p = props.state.swingVPos;
  return p >= 1 && p <= 5 ? `Pos ${p}` : 'Fija';
});

const vaneHStateLabel = computed(() => {
  if (props.state.swingHorizontal) return 'Auto';
  const p = props.state.swingHPos;
  return p >= 1 && p <= 5 ? `Pos ${p}` : 'Fija';
});

// Mode definitions with icons and colors
const modes = [
  { id: ACMode.COOL, name: 'Frío', icon: Snowflake, glowClass: 'glow-cool', color: '#38bdf8' },
  { id: ACMode.HEAT, name: 'Calor', icon: Sun, glowClass: 'glow-heat', color: '#fb923c' },
  { id: ACMode.DRY, name: 'Seco', icon: Droplets, glowClass: 'glow-dry', color: '#2dd4bf' },
  { id: ACMode.FAN, name: 'Vent.', icon: Wind, glowClass: 'glow-fan', color: '#a78bfa' },
  { id: ACMode.AUTO, name: 'Auto', icon: RotateCw, glowClass: 'glow-auto', color: '#4ade80' }
];

// Current mode metadata
const currentModeMeta = computed(() => {
  return modes.find((m) => m.id === props.state.mode) || modes[0];
});

// In FAN (ventilation) mode the target temperature is meaningless: the unit
// reports a frozen value, so temperature editing is disabled.
const isFanMode = computed(() => props.state.mode === ACMode.FAN);
const isCoolMode = computed(() => props.state.mode === ACMode.COOL);
const tempEditable = computed(() => !isFanMode.value);

// Turbo is only available in COOL (Frío) mode on this unit.
const isTurboActive = computed(() => {
  return Boolean(props.state.turbo && isCoolMode.value);
});

// Fan slider: manual speeds Bajo (0), Medio (1), Alto (2), plus Turbo Boost (3).
// "Máximo" was removed in favor of Turbo Boost.
// Silent (20) and Auto (102) live on the side buttons; while one of those is
// active the slider parks on Medio as neutral reference.
const FAN_SLIDER_VALUES = [ACFanSpeed.LOW, ACFanSpeed.MEDIUM, ACFanSpeed.HIGH];
const fanSliderIndex = computed(() => {
  if (isTurboActive.value) {
    return 3;
  }
  const idx = FAN_SLIDER_VALUES.indexOf(props.state.fanSpeed);
  if (idx === -1) {
    if (props.state.fanSpeed === ACFanSpeed.FULL) return 2; // Map 100 to Alto
    return 1;
  }
  return idx;
});
const fanCurrentName = computed(() => {
  if (isTurboActive.value) {
    return '';
  }
  const names = {
    [ACFanSpeed.SILENT]: 'Silencio',
    [ACFanSpeed.LOW]: 'Bajo',
    [ACFanSpeed.MEDIUM]: 'Medio',
    [ACFanSpeed.HIGH]: 'Alto',
    [ACFanSpeed.FULL]: 'Alto',
    [ACFanSpeed.AUTO]: 'Auto'
  };
  return names[props.state.fanSpeed] || 'Auto';
});

// Handlers for instant optimistic button updates
function togglePower() {
  emit('update-state', { power: !props.state.power });
}

function adjustTemp(delta) {
  if (!tempEditable.value) return;
  const current = props.state.targetTemperature || 24;
  const next = Math.max(16, Math.min(30, Math.round((current + delta) * 2) / 2));
  emit('update-state', { targetTemperature: next });
}

function setMode(modeId) {
  // Turbo only works in COOL (frío) mode.
  // When leaving COOL (or changing mode): Turbo turns off and fan speed reverts to / stays at Alto.
  if (modeId !== ACMode.COOL) {
    if (props.state.turbo) {
      emit('update-state', { mode: modeId, turbo: false, fanSpeed: ACFanSpeed.HIGH });
    } else {
      emit('update-state', { mode: modeId });
    }
  } else {
    emit('update-state', { mode: modeId });
  }
}

function setFanSpeed(speedId) {
  // Selecting Silent or Auto deactivates Turbo
  emit('update-state', { fanSpeed: speedId, turbo: false });
}

function onFanSlider(event) {
  const idx = Number(event.target.value);
  if (idx === 3) {
    if (isCoolMode.value) {
      emit('update-state', { turbo: true, fanSpeed: ACFanSpeed.HIGH });
    } else {
      // Turbo only works in Cool mode: snap back to Alto (2)
      event.target.value = '2';
      emit('update-state', { turbo: false, fanSpeed: ACFanSpeed.HIGH });
    }
  } else {
    const speed = FAN_SLIDER_VALUES[idx];
    if (speed !== undefined) {
      emit('update-state', { fanSpeed: speed, turbo: false });
    }
  }
}

function onFanSliderChange(event) {
  if (!isCoolMode.value && Number(event.target.value) === 3) {
    event.target.value = '2';
  }
}

function setFanSliderStop(idx) {
  if (idx === 3) {
    if (!isCoolMode.value) return;
    emit('update-state', { turbo: true, fanSpeed: ACFanSpeed.HIGH });
  } else {
    const speed = FAN_SLIDER_VALUES[idx];
    if (speed !== undefined) {
      emit('update-state', { fanSpeed: speed, turbo: false });
    }
  }
}

function toggleFeature(featureKey) {
  emit('update-state', { [featureKey]: !props.state[featureKey] });
}

function handleSoundBadgeClick() {
  if (props.state.screenDisplay) {
    emit(
      'show-toast',
      '🔇 Para silenciar los pitidos del aire acondicionado, debes apagar la Pantalla LED.',
      'info',
      4500
    );
  } else {
    emit(
      'show-toast',
      'El aire está en Modo Silencioso (sin ruido porque la Pantalla LED está apagada).',
      'success',
      3500
    );
  }
  showSoundModal.value = true;
}
function setSwingAuto() {
  emit('update-state', { swingVertical: !props.state.swingVertical });
}

// Vane position buttons 1..5: fix the vane there (stops sweep)
function setVanePosition(pos) {
  emit('update-state', { swingVertical: false, swingVPos: pos });
}

// Horizontal vane: same single-row pattern (Auto + 5 fixed positions)
const H_VANE_BTNS = [
  { pos: 1, label: 'Izquierda', icon: ChevronsLeft },
  { pos: 2, label: 'Media-izquierda', icon: ChevronLeft },
  { pos: 3, label: 'Centro', icon: Minus },
  { pos: 4, label: 'Media-derecha', icon: ChevronRight },
  { pos: 5, label: 'Derecha', icon: ChevronsRight }
];

function setSwingHAuto() {
  emit('update-state', { swingHorizontal: !props.state.swingHorizontal });
}

function setHVanePosition(pos) {
  emit('update-state', { swingHorizontal: false, swingHPos: pos });
}
</script>

<template>
  <div class="ac-container">
    <!-- Top Navigation Bar -->
    <header class="top-bar glass-panel">
      <div class="device-info">
        <div class="device-picker">
          <span class="device-name">{{ appliance.name || 'Mirage Inverter' }}</span>
          <span v-if="allAppliances.length > 1" class="picker-icon"><ChevronDown :size="14" /></span>
        </div>
        <div class="status-row clickable" @click="emit('refresh-status')" title="Toca para reconectar / actualizar">
          <span class="status-dot" :class="{ online: isDemo || appliance.online || appliance.onlineStatus === '1', demo: isDemo }"></span>
          <span class="status-text">{{ isDemo ? 'Modo Demo' : (appliance.online || appliance.onlineStatus === '1' ? 'En línea' : 'Desconectado (Toca para reconectar)') }}</span>
          <span v-if="isSyncing" class="syncing-indicator">
            <RefreshCw :size="11" class="spin-icon" /> Sincronizando
          </span>
        </div>
      </div>

      <div class="top-actions">
        <button
          type="button"
          class="touch-btn icon-action-btn"
          @click="emit('refresh-status')"
          title="Actualizar estado"
        >
          <RefreshCw :size="16" :class="{ 'spin-icon': isSyncing }" />
        </button>
        <button
          type="button"
          class="touch-btn icon-action-btn"
          @click="showDebugDrawer = !showDebugDrawer"
          title="Diagnóstico"
        >
          <Info :size="16" />
        </button>
        <button
          type="button"
          class="touch-btn icon-action-btn danger"
          @click="emit('logout')"
          title="Cerrar sesión"
        >
          <LogOut :size="16" />
        </button>
      </div>
    </header>

    <!-- Main Thermostat Dial Section (tap = power on/off) -->
    <section class="dial-section">
      <div
        class="thermostat-dial"
        :class="[
          { 'is-off': !state.power, 'power-on': state.power },
          state.power ? currentModeMeta.glowClass : ''
        ]"
        @click="togglePower"
        role="button"
        :aria-label="state.power ? 'Apagar aire' : 'Encender aire'"
        title="Toca para encender / apagar"
      >
        <div class="dial-inner glass-panel">
          <!-- Room & Outdoor Temperature Pills -->
          <div class="ambient-pill">
            <span class="ambient-label">Interior:</span>
            <span class="ambient-val">{{ state.indoorTemperature ? state.indoorTemperature + '°C' : '--' }}</span>
            <span v-if="state.outdoorTemperature" class="ambient-divider">|</span>
            <span v-if="state.outdoorTemperature" class="ambient-label">Exterior:</span>
            <span v-if="state.outdoorTemperature" class="ambient-val">{{ state.outdoorTemperature }}°C</span>
          </div>

          <!-- Main Target Temp Display -->
          <div class="temp-readout" :class="{ 'temp-locked': !tempEditable }">
            <span class="temp-number">{{ state.targetTemperature }}</span>
            <span class="temp-unit">°C</span>
          </div>

          <!-- Mode & Status Label -->
          <div class="dial-mode-status" :class="state.power ? currentModeMeta.glowClass : ''">
            <component :is="currentModeMeta.icon" :size="15" class="mode-mini-icon" />
            <span v-if="!state.power">Apagado · {{ currentModeMeta.name }}</span>
            <span v-else-if="isFanMode" class="status-alert-fan">Ventilación (Sin frío)</span>
            <span v-else-if="isCoolMode">Modo Frío · Aire Acondicionado</span>
            <span v-else>{{ currentModeMeta.name }}</span>
          </div>
          <div class="dial-hint">{{ state.power ? 'Toca para apagar' : 'Toca para encender' }}</div>
        </div>

        <!-- Floating - / + controls (stop prevents power toggle) -->
        <button
          type="button"
          class="touch-btn dial-btn btn-minus"
          :disabled="!tempEditable || state.targetTemperature <= 16"
          @click.stop="adjustTemp(-1)"
          aria-label="Disminuir temperatura"
        >
          <Minus :size="22" />
        </button>

        <button
          type="button"
          class="touch-btn dial-btn btn-plus"
          :disabled="!tempEditable || state.targetTemperature >= 30"
          @click.stop="adjustTemp(1)"
          aria-label="Aumentar temperatura"
        >
          <Plus :size="22" />
        </button>
      </div>
    </section>

    <!-- Fan Mode Notice / Quick Switch to Cool -->
    <div v-if="state.power && isFanMode" class="fan-notice-card glass-panel">
      <div class="fan-notice-content">
        <Wind :size="18" class="fan-notice-icon" />
        <div class="fan-notice-text">
          <span class="fan-notice-title">Solo Ventilación Activa</span>
          <span class="fan-notice-desc">El compresor está inactivo (solo circula aire ambiental).</span>
        </div>
      </div>
      <button type="button" class="touch-btn fan-notice-action" @click="setMode(ACMode.COOL)">
        <Snowflake :size="14" /> Poner en Frío
      </button>
    </div>

    <!-- Mode Selector -->
    <section class="section-card glass-panel">
      <div class="section-title">Modo de Operación</div>
      <div class="mode-grid">
        <button
          v-for="m in modes"
          :key="m.id"
          type="button"
          class="touch-btn mode-item"
          :class="{ active: state.mode === m.id }"
          @click="setMode(m.id)"
        >
          <component :is="m.icon" :size="18" class="mode-icon" />
          <span class="mode-label">{{ m.name }}</span>
        </button>
      </div>
    </section>

    <!-- Fan Speed Selector: side buttons + slider in a single row -->
    <section class="section-card glass-panel">
      <div class="section-title">
        Velocidad de Abanico <span class="fan-current" :class="{ 'turbo-glow': isTurboActive }">
          <Zap v-if="isTurboActive" :size="13" class="turbo-badge-icon" />
          <span v-else>{{ fanCurrentName }}</span>
        </span>
      </div>
      <div class="fan-row">
        <button
          type="button"
          class="touch-btn fan-side"
          :class="{ active: !isTurboActive && state.fanSpeed === ACFanSpeed.SILENT }"
          @click="setFanSpeed(ACFanSpeed.SILENT)"
          aria-label="Modo silencio"
        >
          <VolumeX :size="16" />
          <span>Silencio</span>
        </button>

        <div class="fan-slider-wrap">
          <input
            type="range"
            class="fan-slider"
            :class="{ 'slider-turbo': isTurboActive }"
            min="0"
            max="3"
            step="1"
            :value="fanSliderIndex"
            aria-label="Velocidad del abanico"
            @input="onFanSlider($event)"
            @change="onFanSliderChange($event)"
          />
          <div class="fan-ticks">
            <span class="tick-label" @click="setFanSliderStop(0)">Bajo</span>
            <span class="tick-label" @click="setFanSliderStop(1)">Medio</span>
            <span class="tick-label" @click="setFanSliderStop(2)">Alto</span>
            <span
              class="tick-label fan-tick-turbo"
              :class="{ 'tick-disabled': !isCoolMode, 'tick-active': isTurboActive }"
              :title="isCoolMode ? '' : 'Solo disponible en modo Frío'"
              @click="setFanSliderStop(3)"
            >
              <Zap :size="13" class="turbo-mini-icon" />
            </span>
          </div>
        </div>

        <button
          type="button"
          class="touch-btn fan-side"
          :class="{ active: !isTurboActive && state.fanSpeed === ACFanSpeed.AUTO }"
          @click="setFanSpeed(ACFanSpeed.AUTO)"
          aria-label="Velocidad automática"
        >
          <Sparkles :size="16" />
          <span>Auto</span>
        </button>
      </div>
    </section>

    <!-- Smart Functions Grid -->
    <section class="section-card glass-panel">
      <div class="section-title">Funciones Especiales</div>
      <div class="feature-grid">
        <!-- Eco Mode -->
        <button
          type="button"
          class="touch-btn feature-card"
          :class="{ active: state.eco }"
          @click="toggleFeature('eco')"
        >
          <Leaf :size="18" class="feature-icon" />
          <div class="feature-text">
            <span class="feat-name">Modo Eco</span>
            <span class="feat-state">{{ state.eco ? 'Activado' : 'Desactivado' }}</span>
          </div>
        </button>

        <!-- Sleep Mode -->
        <button
          type="button"
          class="touch-btn feature-card"
          :class="{ active: state.sleep }"
          @click="toggleFeature('sleep')"
        >
          <Moon :size="18" class="feature-icon" />
          <div class="feature-text">
            <span class="feat-name">Modo Noche</span>
            <span class="feat-state">{{ state.sleep ? 'Activado' : 'Desactivado' }}</span>
          </div>
        </button>

        <!-- Display Screen with Sound Corner Badge -->
        <button
          type="button"
          class="touch-btn feature-card display-feature-card"
          :class="{ active: state.screenDisplay }"
          @click="toggleFeature('screenDisplay')"
          :title="state.screenDisplay ? 'Pantalla encendida. Toca para apagar.' : 'Pantalla apagada. Toca para encender.'"
        >
          <!-- Corner Sound Indicator Badge (Clickable for info) -->
          <div
            class="sound-corner-badge"
            :class="{ silent: !state.screenDisplay, noisy: state.screenDisplay }"
            @click.stop="handleSoundBadgeClick"
            role="button"
            tabindex="0"
            :title="state.screenDisplay ? 'Sonido activo (hace ruido al configurar). Toca para ver cómo silenciar.' : 'Modo Silencioso activo (sin ruido al configurar). Toca para info.'"
            :aria-label="state.screenDisplay ? 'Sonido activo (hace ruido). Toca para info.' : 'Modo silencioso (sin ruido). Toca para info.'"
          >
            <component :is="state.screenDisplay ? Volume2 : VolumeX" :size="12" />
          </div>

          <Tv :size="18" class="feature-icon" />
          <div class="feature-text">
            <span class="feat-name">Pantalla LED</span>
            <span class="feat-state">{{ state.screenDisplay ? 'Encendida' : 'Apagada' }}</span>
          </div>
        </button>

        <!-- Vertical vane: Auto + 5 fixed positions in one horizontal row -->
        <div class="vane-block">
          <div class="vane-block-label">Ventila vertical <span class="fan-current">{{ vaneStateLabel }}</span></div>
          <div class="vane-row">
            <button
              type="button"
              class="touch-btn vane-btn vane-auto"
              :class="{ active: state.swingVertical }"
              @click="setSwingAuto"
              aria-label="Oscilación automática"
              title="Automático"
            >
              <Sliders :size="16" />
              <span>Auto</span>
            </button>
            <button
              v-for="opt in VANE_BTNS"
              :key="opt.pos"
              type="button"
              class="touch-btn vane-btn"
              :class="{ active: !state.swingVertical && state.swingVPos === opt.pos }"
              @click="setVanePosition(opt.pos)"
              :aria-label="opt.label"
              :title="opt.label"
            >
              <component :is="opt.icon" :size="16" />
              <span>{{ opt.pos }}</span>
            </button>
          </div>
        </div>

        <!-- Horizontal vane: Auto + 5 fixed positions in one horizontal row -->
        <div class="vane-block">
          <div class="vane-block-label">Ventila horizontal <span class="fan-current">{{ vaneHStateLabel }}</span></div>
          <div class="vane-row">
            <button
              type="button"
              class="touch-btn vane-btn vane-auto"
              :class="{ active: state.swingHorizontal }"
              @click="setSwingHAuto"
              aria-label="Oscilación horizontal automática"
              title="Automático"
            >
              <Sliders :size="16" />
              <span>Auto</span>
            </button>
            <button
              v-for="opt in H_VANE_BTNS"
              :key="opt.pos"
              type="button"
              class="touch-btn vane-btn"
              :class="{ active: !state.swingHorizontal && state.swingHPos === opt.pos }"
              @click="setHVanePosition(opt.pos)"
              :aria-label="opt.label"
              :title="opt.label"
            >
              <component :is="opt.icon" :size="16" />
              <span>{{ opt.pos }}</span>
            </button>
          </div>
        </div>

      </div>
    </section>

    <!-- Diagnostics / Debug Drawer -->
    <div v-if="showDebugDrawer" class="debug-drawer glass-panel">
      <div class="debug-header">
        <h4>Diagnóstico del Dispositivo</h4>
        <button type="button" class="close-debug" @click="showDebugDrawer = false">✕</button>
      </div>
      <div class="debug-content">
        <p><strong>ID Dispositivo:</strong> {{ appliance.id }}</p>
        <p><strong>Tipo:</strong> {{ appliance.type || '0xAC' }}</p>
        <p><strong>Modelo:</strong> {{ appliance.modelNumber || 'Mirage Inverter' }}</p>
        <p><strong>Estado Recibido:</strong></p>
        <pre>{{ JSON.stringify(state, null, 2) }}</pre>
      </div>
    </div>

    <!-- Sound / Silent Mode Info Modal -->
    <transition name="fade">
      <div v-if="showSoundModal" class="modal-backdrop" @click="showSoundModal = false">
        <div class="sound-modal glass-panel" @click.stop>
          <div class="sound-modal-header">
            <div class="sound-badge-icon" :class="{ silent: !state.screenDisplay }">
              <component :is="state.screenDisplay ? Volume2 : VolumeX" :size="24" />
            </div>
            <div class="sound-header-text">
              <h4>Sonido de Configuración</h4>
              <span class="sound-status-tag" :class="{ silent: !state.screenDisplay }">
                {{ state.screenDisplay ? '🔊 Hace ruido (Pitidos activos)' : '🔇 Sin ruido (Modo silencioso activo)' }}
              </span>
            </div>
          </div>

          <div class="sound-modal-body">
            <p v-if="state.screenDisplay">
              En este aire acondicionado, para que <strong>no haga ruido (sin pitidos)</strong> al cambiar la configuración, 
              <strong>debes apagar la Pantalla LED</strong>.
            </p>
            <p v-else>
              El aire acondicionado está en <strong>Modo Silencioso</strong>. No emite pitidos de confirmación al cambiar la configuración porque la <strong>Pantalla LED física está apagada</strong>.
            </p>
            <div class="sound-tip-box">
              <Info :size="15" class="tip-icon" />
              <span>La placa física del aire acondicionado desactiva automáticamente el zumbador mientras la pantalla LED permanezca apagada.</span>
            </div>
          </div>

          <div class="sound-modal-footer">
            <button
              v-if="state.screenDisplay"
              type="button"
              class="touch-btn modal-btn primary"
              @click="toggleFeature('screenDisplay'); showSoundModal = false"
            >
              <Tv :size="16" />
              <span>Apagar Pantalla (Silenciar)</span>
            </button>
            <button
              v-else
              type="button"
              class="touch-btn modal-btn primary"
              @click="toggleFeature('screenDisplay'); showSoundModal = false"
            >
              <Tv :size="16" />
              <span>Encender Pantalla (Con sonido)</span>
            </button>
            <button
              type="button"
              class="touch-btn modal-btn secondary"
              @click="showSoundModal = false"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.ac-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 440px;
  margin: 0 auto;
  /* Respect Android status bar (top) and navigation bar (bottom) so the
     lowest buttons are never hidden behind system gestures/buttons. */
  padding: max(12px, env(safe-area-inset-top, 0px)) 12px calc(72px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  overflow-x: hidden;
}

/* Top Nav */
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
}

.device-name {
  font-size: 15px;
  font-weight: 700;
  color: white;
}

.device-picker {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
}

.status-row.clickable {
  cursor: pointer;
  user-select: none;
  border-radius: 6px;
  padding: 2px 4px;
  margin-left: -4px;
  transition: background-color 0.15s ease, opacity 0.15s ease;
}

.status-row.clickable:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.status-row.clickable:active {
  opacity: 0.65;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: #64748b;
}

.status-dot.online {
  background-color: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.status-dot.demo {
  background-color: #f59e0b;
  box-shadow: 0 0 6px #f59e0b;
}

.status-text {
  font-size: 11px;
  color: var(--text-muted);
}

.syncing-indicator {
  font-size: 11px;
  color: #38bdf8;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-action-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.icon-action-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: white;
}

.icon-action-btn.danger:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.4);
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Dial Section */
.dial-section {
  display: flex;
  justify-content: center;
  margin: 4px 0;
  width: 100%;
}

.thermostat-dial {
  position: relative;
  width: min(220px, 62vw);
  height: min(220px, 62vw);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  background: radial-gradient(circle, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%);
  border: 2px solid rgba(255, 255, 255, 0.1);
  transition: all 0.35s ease;
  box-sizing: border-box;
  cursor: pointer;
}

/* Power ON: soft green ring (kept subtle so text stays readable) */
.thermostat-dial.power-on {
  border-color: rgba(52, 211, 153, 0.55);
  box-shadow: 0 0 26px rgba(16, 185, 129, 0.22), inset 0 0 18px rgba(16, 185, 129, 0.07);
}

.thermostat-dial.power-on .temp-number {
  color: #d1fae5;
}

/* Power ON: Specific Mode Glows */
.thermostat-dial.power-on.glow-cool {
  border-color: rgba(56, 189, 248, 0.75);
  box-shadow: 0 0 32px rgba(56, 189, 248, 0.35), inset 0 0 20px rgba(56, 189, 248, 0.1);
}
.thermostat-dial.power-on.glow-cool .temp-number {
  color: #e0f2fe;
  text-shadow: 0 0 24px rgba(56, 189, 248, 0.4);
}

.thermostat-dial.power-on.glow-fan {
  border-color: rgba(167, 139, 250, 0.75);
  box-shadow: 0 0 32px rgba(167, 139, 250, 0.35), inset 0 0 20px rgba(167, 139, 250, 0.1);
}
.thermostat-dial.power-on.glow-fan .temp-number {
  color: #ede9fe;
  text-shadow: 0 0 24px rgba(167, 139, 250, 0.4);
}

.thermostat-dial.power-on.glow-heat {
  border-color: rgba(251, 146, 60, 0.75);
  box-shadow: 0 0 32px rgba(251, 146, 60, 0.35), inset 0 0 20px rgba(251, 146, 60, 0.1);
}
.thermostat-dial.power-on.glow-heat .temp-number {
  color: #ffedd5;
}

.thermostat-dial.power-on.glow-dry {
  border-color: rgba(45, 212, 191, 0.75);
  box-shadow: 0 0 32px rgba(45, 212, 191, 0.35), inset 0 0 20px rgba(45, 212, 191, 0.1);
}
.thermostat-dial.power-on.glow-dry .temp-number {
  color: #ccfbf1;
}

.thermostat-dial.power-on.glow-auto {
  border-color: rgba(74, 222, 128, 0.75);
  box-shadow: 0 0 32px rgba(74, 222, 128, 0.35), inset 0 0 20px rgba(74, 222, 128, 0.1);
}
.thermostat-dial.power-on.glow-auto .temp-number {
  color: #dcfce7;
}

/* Power OFF: standby LCD look */
.thermostat-dial.is-off {
  opacity: 0.85;
  border-color: rgba(148, 163, 184, 0.25);
  box-shadow: none;
  cursor: pointer;
}

.dial-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}

.ambient-pill {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 3px 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  margin-bottom: 4px;
}

.ambient-label {
  color: var(--text-muted);
}

.ambient-divider {
  color: rgba(255, 255, 255, 0.2);
}

.ambient-val {
  font-weight: 600;
  color: #e2e8f0;
}

.temp-readout {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  line-height: 1;
}

.temp-number {
  font-size: clamp(48px, 14vw, 64px);
  font-weight: 800;
  letter-spacing: -2px;
  color: white;
}

.temp-readout.temp-locked .temp-number {
  color: #64748b;
}

.temp-unit {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-muted);
  margin-top: 6px;
  margin-left: 2px;
}

.dial-mode-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
  margin-top: 4px;
}

.dial-mode-status.glow-cool { color: #38bdf8; font-weight: 600; }
.dial-mode-status.glow-fan { color: #a78bfa; font-weight: 600; }
.dial-mode-status.glow-heat { color: #fb923c; font-weight: 600; }
.dial-mode-status.glow-dry { color: #2dd4bf; font-weight: 600; }
.dial-mode-status.glow-auto { color: #4ade80; font-weight: 600; }

.status-alert-fan {
  color: #ede9fe;
  background: rgba(167, 139, 250, 0.25);
  padding: 2px 7px;
  border-radius: 8px;
  font-size: 11px;
}

.dial-hint {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.75;
  margin-top: 3px;
}

/* Dial Buttons - / + */
.dial-btn {
  position: absolute;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #1e293b;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: white;
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.4);
}

.dial-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.btn-minus {
  left: -8px;
}

.btn-plus {
  right: -8px;
}

/* Fan single-row: side buttons + slider */
.fan-current {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-left: 6px;
  color: #a78bfa;
  font-weight: 700;
  transition: color 0.2s ease, text-shadow 0.2s ease;
}

.fan-current.turbo-glow {
  color: #38bdf8;
  filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.7));
}

.turbo-badge-icon {
  display: inline-block;
  vertical-align: middle;
}

.fan-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
}

.fan-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  flex: 0 0 auto;
  min-width: 64px;
  padding: 8px 10px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  transition: all 0.2s;
}

.fan-side.active {
  background: rgba(167, 139, 250, 0.2);
  border-color: #a78bfa;
  color: #a78bfa;
  box-shadow: 0 3px 12px rgba(167, 139, 250, 0.25);
}

.fan-slider-wrap {
  flex: 1 1 auto;
  min-width: 0;
  padding: 2px 2px 0;
}

.fan-slider {
  width: 100%;
  height: 28px;
  accent-color: #a78bfa;
  cursor: pointer;
  touch-action: pan-x;
  background: transparent;
  transition: accent-color 0.2s ease;
}

.fan-slider:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.fan-slider::-webkit-slider-thumb {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #a78bfa;
  border: 2px solid #ede9fe;
  box-shadow: 0 2px 8px rgba(167, 139, 250, 0.5);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.fan-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #a78bfa;
  border: 2px solid #ede9fe;
  box-shadow: 0 2px 8px rgba(167, 139, 250, 0.5);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.fan-slider.slider-turbo {
  accent-color: #38bdf8;
}

.fan-slider.slider-turbo::-webkit-slider-thumb {
  background: #38bdf8;
  border-color: #e0f2fe;
  box-shadow: 0 2px 10px rgba(56, 189, 248, 0.7);
}

.fan-slider.slider-turbo::-moz-range-thumb {
  background: #38bdf8;
  border-color: #e0f2fe;
  box-shadow: 0 2px 10px rgba(56, 189, 248, 0.7);
}

.fan-slider::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
}

.fan-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 0 2px;
}

.tick-label {
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease, opacity 0.15s ease;
}

.tick-label:hover {
  color: #f1f5f9;
}

.fan-tick-turbo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  transition: all 0.2s ease;
}

.turbo-mini-icon {
  flex-shrink: 0;
}

.fan-tick-turbo.tick-active {
  color: #38bdf8;
  font-weight: 700;
  filter: drop-shadow(0 0 5px rgba(56, 189, 248, 0.7));
}

.fan-tick-turbo.tick-active .turbo-mini-icon {
  color: #38bdf8;
  filter: drop-shadow(0 0 4px #38bdf8);
}

.fan-tick-turbo.tick-disabled {
  opacity: 0.25;
  color: #64748b;
  cursor: not-allowed;
  pointer-events: none;
}

/* Section Cards */
.section-card {
  padding: 12px 14px;
  width: 100%;
  box-sizing: border-box;
  transition: opacity 0.3s ease;
}

.section-card.disabled {
  opacity: 0.45;
  pointer-events: none;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

/* Mode Grid */
.mode-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
}

.mode-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 2px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  min-width: 0;
  transition: all 0.2s;
}

.mode-item.active {
  background: rgba(56, 189, 248, 0.18);
  border-color: #38bdf8;
  color: #38bdf8;
  box-shadow: 0 3px 12px rgba(56, 189, 248, 0.25);
}

.mode-label {
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

/* Fan Notice Card */
.fan-notice-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(167, 139, 250, 0.12);
  border: 1px solid rgba(167, 139, 250, 0.35);
  border-radius: 14px;
  width: 100%;
  box-sizing: border-box;
}

.fan-notice-content {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.fan-notice-icon {
  color: #a78bfa;
  flex-shrink: 0;
}

.fan-notice-text {
  display: flex;
  flex-direction: column;
}

.fan-notice-title {
  font-size: 12px;
  font-weight: 700;
  color: #ede9fe;
}

.fan-notice-desc {
  font-size: 10px;
  color: #c4b5fd;
}

.fan-notice-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  background: #38bdf8;
  color: #0f172a;
  font-size: 11px;
  font-weight: 700;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
  transition: transform 0.15s ease, background-color 0.15s ease;
}

.fan-notice-action:hover {
  background: #7dd3fc;
  transform: translateY(-1px);
}

/* Feature Grid: 3 columns for Eco, Noche, Pantalla LED */
.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
}

.feature-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 10px 4px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  text-align: center;
  min-width: 0;
  transition: all 0.2s;
}

.feature-card.active {
  background: rgba(16, 185, 129, 0.15);
  border-color: #10b981;
  color: white;
  box-shadow: 0 3px 12px rgba(16, 185, 129, 0.2);
}

.feature-card.active .feature-icon {
  color: #10b981;
}

.feature-card:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.feature-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.feat-name {
  font-size: 11px;
  font-weight: 600;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feat-state {
  font-size: 10px;
  color: var(--text-muted);
}

/* Vertical vane single-row control: Auto + 5 fixed positions */
.vane-block {
  grid-column: 1 / -1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 10px;
  min-width: 0;
}

.vane-block-label {
  font-size: 12px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
}

.vane-row {
  display: flex;
  gap: 4px;
  width: 100%;
  box-sizing: border-box;
}

.vane-btn {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 7px 2px;
  font-size: 9px;
  font-weight: 600;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  transition: all 0.2s;
}

.vane-btn.active {
  background: rgba(16, 185, 129, 0.15);
  border-color: #10b981;
  color: #10b981;
  box-shadow: 0 3px 12px rgba(16, 185, 129, 0.25);
}

/* Debug Drawer */
.debug-drawer {
  padding: 14px;
  margin-top: 6px;
  border-color: rgba(56, 189, 248, 0.3);
}

.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.close-debug {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 15px;
}

.debug-content {
  font-size: 11px;
  color: #cbd5e1;
  line-height: 1.5;
}

.debug-content pre {
  background: rgba(0, 0, 0, 0.4);
  padding: 8px;
  border-radius: 8px;
  overflow-x: auto;
  margin-top: 6px;
  font-size: 10px;
}

/* Display Feature Card & Corner Sound Badge */
.display-feature-card {
  position: relative;
}

.sound-corner-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 5;
}

.sound-corner-badge:hover,
.sound-corner-badge:active {
  transform: scale(1.18);
}

.sound-corner-badge.noisy {
  background: rgba(245, 158, 11, 0.2);
  border-color: rgba(245, 158, 11, 0.45);
  color: #fbbf24;
}

.sound-corner-badge.silent {
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.45);
  color: #38bdf8;
}

/* Contrast when the parent card is active (Pantalla LED encendida) */
.feature-card.active .sound-corner-badge.noisy {
  background: rgba(0, 0, 0, 0.35);
  border-color: rgba(255, 255, 255, 0.3);
  color: #fef08a;
}

/* Sound Help Modal Backdrop & Dialog */
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
}

.sound-modal {
  width: 100%;
  max-width: 360px;
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 20px;
  padding: 22px 20px;
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: white;
}

.sound-modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sound-badge-icon {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.3);
  flex-shrink: 0;
}

.sound-badge-icon.silent {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.3);
}

.sound-header-text h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: white;
}

.sound-status-tag {
  display: inline-block;
  margin-top: 3px;
  font-size: 11px;
  font-weight: 600;
  color: #fbbf24;
}

.sound-status-tag.silent {
  color: #34d399;
}

.sound-modal-body {
  font-size: 13px;
  line-height: 1.5;
  color: #cbd5e1;
}

.sound-modal-body p {
  margin: 0 0 10px 0;
}

.sound-modal-body strong {
  color: #f8fafc;
}

.sound-tip-box {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: #94a3b8;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.sound-tip-box .tip-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: #38bdf8;
}

.sound-modal-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.modal-btn {
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.modal-btn.primary {
  background: linear-gradient(135deg, #0284c7, #2563eb);
  color: white;
  box-shadow: 0 4px 15px rgba(37, 99, 235, 0.35);
}

.modal-btn.primary:active {
  transform: scale(0.98);
}

.modal-btn.secondary {
  background: rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-btn.secondary:active {
  background: rgba(255, 255, 255, 0.12);
  color: white;
}
</style>

/**
 * Command Queue & Optimistic UI Dispatcher
 * Fixes the issue: "a veces no funcionan los botones"
 *
 * Provides:
 * 1. Instant optimistic UI feedback with haptic vibration.
 * 2. Debouncing of rapid button clicks (e.g. rapid temp +/-) to prevent packet collisions.
 * 3. Sequential single-flight transmission to prevent Midea cloud packet drops.
 * 4. Automatic retry on network drops.
 */

import { Haptics, ImpactStyle } from '@capacitor/haptics';
import {
  buildControlPacket,
  buildToggleDisplayPacket,
  buildSetPropertyPacket,
  parsePropertyReply,
  vaneIndexToValue,
  PropId
} from './mideaProtocol';
import { sendTransparentCmd } from './mideaApi';
import { sessionManager } from './sessionManager';

class CommandQueue {
  constructor() {
    this.pendingState = null;
    this.pendingDelta = null;
    this.pendingDisplayFlips = 0;
    this.debounceTimer = null;
    this.isTransmitting = false;
    this.queuedPromise = null;
    this.onStateConfirmed = null;
    this.onError = null;
  }

  // Check if queue is actively processing or waiting to send commands
  isBusy() {
    return this.isTransmitting || Boolean(this.debounceTimer) || Boolean(this.pendingState);
  }

  // Returns true only if there are pending user commands waiting in the debouncer/queue
  hasPendingCommands() {
    return Boolean(this.debounceTimer) || Boolean(this.pendingState);
  }

  // Reset stuck transmitting lock if no user commands are pending
  resetIfStuck() {
    if (this.isTransmitting && !this.pendingState && !this.debounceTimer) {
      console.warn('[CommandQueue] Reseteando estado isTransmitting posiblemente atascado.');
      this.isTransmitting = false;
    }
  }

  // Trigger haptic click feedback on mobile devices
  triggerHaptic() {
    try {
      Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Haptics not available on desktop browser, harmless ignore
    }
  }

  /**
   * Queue a state change with debouncing.
   * @param {Object} appliance Device to control
   * @param {Object} nextState The full target state (frame needs all fields)
   * @param {Object|null} delta Only the fields the user just changed (for
   * toggle decisions). If omitted, no toggle is ever sent.
   * @param {number} debounceMs Time to wait before dispatching (default: 300ms)
   */
  queueCommand(appliance, nextState, delta = null, debounceMs = 300) {
    this.triggerHaptic();

    // Accumulate target state
    this.pendingState = {
      ...(this.pendingState || {}),
      ...nextState
    };

    // Accumulate the real user delta. Display taps are counted as flips:
    // two rapid taps cancel out (net zero change -> no toggle sent).
    if (delta && typeof delta === 'object') {
      this.pendingDelta = {
        ...(this.pendingDelta || {}),
        ...delta
      };
      if (Object.prototype.hasOwnProperty.call(delta, 'screenDisplay')) {
        this.pendingDisplayFlips += 1;
      }
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    return new Promise((resolve, reject) => {
      this.debounceTimer = setTimeout(async () => {
        try {
          const res = await this.dispatch(appliance);
          resolve(res);
        } catch (err) {
          reject(err);
        }
      }, debounceMs);
    });
  }

  /**
   * Dispatch the aggregated command packet to the cloud / appliance
   */
  async dispatch(appliance) {
    if (!this.pendingState || !appliance) return;

    const stateToSend = { ...this.pendingState };
    const deltaKeys = this.pendingDelta ? Object.keys(this.pendingDelta) : [];
    // Odd flip count = net display change; even = tapped twice = no-op.
    const displayFlips = this.pendingDisplayFlips % 2 === 1;
    this.pendingState = null;
    this.pendingDelta = null;
    this.pendingDisplayFlips = 0;

    // If already transmitting another packet, wait for it to finish first (with watchdog safety)
    const waitStart = Date.now();
    while (this.isTransmitting) {
      if (Date.now() - waitStart > 15000) {
        console.warn('[CommandQueue] Watchdog timeout esperando transmisión previa. Forzando desbloqueo.');
        this.isTransmitting = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    this.isTransmitting = true;

    try {
      // The LED display has no absolute on/off in this protocol: it is a
      // dedicated TOGGLE frame (QUERY-type 0x41, verified live), sent ONLY
      // when the user really changed it (odd flip count). Anything else goes
      // in the full state frame (new format with msgId + CRC8).
      const onlyDisplayToggle = displayFlips && deltaKeys.length === 1;

      // Louver fixed positions travel via 0xB0 property frames
      // (UD=0x0009, LR=0x000A; values [1,25,50,75,100], verified live).
      // The state frame carries sweep on/off; the property frame carries
      // the fixed angle. Steps run in order; only the LAST frame beeps so
      // a combined action (e.g. fix vane position) sounds a single beep.
      const steps = [];
      if (!onlyDisplayToggle) {
        steps.push({ kind: 'state' });
      }
      if (displayFlips) {
        steps.push({ kind: 'toggle' });
      }
      const vaneTargets = [
        { key: 'swingVPos', propId: PropId.SWING_UD_ANGLE, name: 'vertical' },
        { key: 'swingHPos', propId: PropId.SWING_LR_ANGLE, name: 'horizontal' }
      ];
      for (const { key, propId, name } of vaneTargets) {
        // Only send the property frame when the position really changed
        // (delta), using the consolidated target value from the full state.
        if (deltaKeys.includes(key) && stateToSend[key] != null) {
          const value = vaneIndexToValue(stateToSend[key]);
          if (value == null) {
            throw new Error(`Posición de ventila ${name} inválida (${stateToSend[key]}). Usa 1 a 5.`);
          }
          steps.push({ kind: 'prop', propId, value });
        }
      }

      let reply = '';
      let stateReply = '';
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const last = i === steps.length - 1;
        let hexOrder;
        if (step.kind === 'state') {
          hexOrder = buildControlPacket(stateToSend, { beep: last });
        } else if (step.kind === 'toggle') {
          hexOrder = buildToggleDisplayPacket(last);
        } else {
          hexOrder = buildSetPropertyPacket(step.propId, [step.value]);
        }
        console.log(`[CommandQueue] Enviando paquete a dispositivo ${appliance.id}:`, hexOrder);

        // Execute via sessionManager with automatic re-login on token expiry
        const currentReply = await sessionManager.executeWithAutoRelogin(async (session) => {
          return await sendTransparentCmd(session, appliance.id, hexOrder);
        });
        reply = currentReply;
        if (step.kind === 'state') {
          stateReply = currentReply;
        }

        if (step.kind === 'prop') {
          const parsed = parsePropertyReply(reply);
          const entry = parsed?.[step.propId];
          if (!entry || entry.error) {
            throw new Error(
              `La ventila no aceptó la posición (prop 0x${step.propId.toString(16)}). Reintenta.`
            );
          }
        }
      }

      console.log('[CommandQueue] Comando ejecutado exitosamente por el AC:', reply);
      if (this.onStateConfirmed) {
        this.onStateConfirmed(stateToSend, stateReply || reply);
      }
      return reply;
    } catch (err) {
      console.error('[CommandQueue] Error al transmitir comando al AC:', err);
      if (this.onError) {
        this.onError(err);
      }
      throw err;
    } finally {
      this.isTransmitting = false;
      // If new changes were accumulated during transmission, dispatch them now
      if (this.pendingState) {
        this.dispatch(appliance);
      }
    }
  }
}

export const commandQueue = new CommandQueue();

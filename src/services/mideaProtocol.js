/**
 * Midea / Mirage AC (Type 0xAC) Packet Encoder & Decoder
 * Reconstructed with 100% precision from Mirage AC APK (com.mirage.ac / Midea SDK)
 */

export const ACMode = {
  AUTO: 1,
  COOL: 2,
  DRY: 3,
  HEAT: 4,
  FAN: 5,
};

export const ACModeNames = {
  1: 'Automático',
  2: 'Frío',
  3: 'Seco',
  4: 'Calor',
  5: 'Ventilador',
};

export const ACFanSpeed = {
  SILENT: 20,
  LOW: 40,
  MEDIUM: 60,
  HIGH: 80,
  FULL: 100,
  AUTO: 102,
};

export const ACFanSpeedNames = {
  20: 'Silencioso',
  40: 'Bajo',
  60: 'Medio',
  80: 'Alto',
  100: 'Máximo',
  102: 'Automático',
};

// Louver (ventila) fixed positions:
// UI position N (1..5) <-> property value.
// Property IDs: SWING_UD_ANGLE = 0x0009 (vertical), SWING_LR_ANGLE = 0x000A.
// NOTE: the 0x40 state frame only supports sweep on/off; fixed positions
// travel exclusively via 0xB0 SetProperties (single-byte value).
export const VANE_POSITIONS = [1, 25, 50, 75, 100];
export const VANE_POSITION_NAMES = {
  1: 'Posición 1 (arriba)',
  2: 'Posición 2',
  3: 'Posición 3 (media)',
  4: 'Posición 4',
  5: 'Posición 5 (abajo)'
};
export const PropId = {
  SWING_UD_ANGLE: 0x0009,
  SWING_LR_ANGLE: 0x000a
};

export function vaneValueToIndex(value) {
  const idx = VANE_POSITIONS.indexOf(value);
  return idx === -1 ? null : idx + 1; // 1-based position or null
}

export function vaneIndexToValue(index) {
  if (index < 1 || index > VANE_POSITIONS.length) return null;
  return VANE_POSITIONS[index - 1];
}

/**
 * Standard Midea 8-bit Checksum (makeSum)
 * sum of bytes from index 1 to (length - 1)
 * checksum = (256 - (sum % 256)) % 256
 */
export function calculateChecksum(bytes, length) {
  let sum = 0;
  for (let i = 1; i < length - 1; i++) {
    sum += bytes[i];
  }
  return ((255 - (sum % 256)) + 1) % 256;
}

// Convert byte array to Hex String
export function bytesToHex(byteArray) {
  return Array.from(byteArray, (byte) =>
    ('0' + (byte & 0xff).toString(16)).slice(-2)
  ).join('').toUpperCase();
}

// Convert Hex String to byte array
export function hexToBytes(hexString) {
  if (!hexString || typeof hexString !== 'string') return new Uint8Array(0);
  const cleanHex = hexString.replace(/\s+/g, '');
  const bytes = [];
  for (let c = 0; c < cleanHex.length; c += 2) {
    bytes.push(parseInt(cleanHex.substr(c, 2), 16));
  }
  return new Uint8Array(bytes);
}



/**
 * Builds a Control command packet (new format, verified live 2026-10-06).
 *
 * Root cause of cloud error 3176: 2025-firmware Mirage units silently drop
 * the legacy 36-byte frame (24-byte body + plain checksum). They require the
 * current frame format (reference: midea-msmart SetStateCommand):
 *   - 24-byte extended body (timer sentinel 7F 7F, humidity, temp_alt, ...)
 *   - trailing message-ID byte + CRC8-854 over (body + msgId)
 *   - standard 10-byte header (frame type CONTROL 0x02) + frame checksum
 * Total: 37 bytes. Live-tested: fan 100->60->100 applied and confirmed.
 *
 * @param {Object} state Current state with modifications
 */
let controlMessageId = 0;

function nextControlMessageId() {
  controlMessageId = (controlMessageId + 1) & 0xff;
  return controlMessageId;
}

// CRC8-854 lookup table (reference: msmart/crc8.py)
const CRC8_854_TABLE = [
  0x00,0x5E,0xBC,0xE2,0x61,0x3F,0xDD,0x83,0xC2,0x9C,0x7E,0x20,0xA3,0xFD,0x1F,0x41,
  0x9D,0xC3,0x21,0x7F,0xFC,0xA2,0x40,0x1E,0x5F,0x01,0xE3,0xBD,0x3E,0x60,0x82,0xDC,
  0x23,0x7D,0x9F,0xC1,0x42,0x1C,0xFE,0xA0,0xE1,0xBF,0x5D,0x03,0x80,0xDE,0x3C,0x62,
  0xBE,0xE0,0x02,0x5C,0xDF,0x81,0x63,0x3D,0x7C,0x22,0xC0,0x9E,0x1D,0x43,0xA1,0xFF,
  0x46,0x18,0xFA,0xA4,0x27,0x79,0x9B,0xC5,0x84,0xDA,0x38,0x66,0xE5,0xBB,0x59,0x07,
  0xDB,0x85,0x67,0x39,0xBA,0xE4,0x06,0x58,0x19,0x47,0xA5,0xFB,0x78,0x26,0xC4,0x9A,
  0x65,0x3B,0xD9,0x87,0x04,0x5A,0xB8,0xE6,0xA7,0xF9,0x1B,0x45,0xC6,0x98,0x7A,0x24,
  0xF8,0xA6,0x44,0x1A,0x99,0xC7,0x25,0x7B,0x3A,0x64,0x86,0xD8,0x5B,0x05,0xE7,0xB9,
  0x8C,0xD2,0x30,0x6E,0xED,0xB3,0x51,0x0F,0x4E,0x10,0xF2,0xAC,0x2F,0x71,0x93,0xCD,
  0x11,0x4F,0xAD,0xF3,0x70,0x2E,0xCC,0x92,0xD3,0x8D,0x6F,0x31,0xB2,0xEC,0x0E,0x50,
  0xAF,0xF1,0x13,0x4D,0xCE,0x90,0x72,0x2C,0x6D,0x33,0xD1,0x8F,0x0C,0x52,0xB0,0xEE,
  0x32,0x6C,0x8E,0xD0,0x53,0x0D,0xEF,0xB1,0xF0,0xAE,0x4C,0x12,0x91,0xCF,0x2D,0x73,
  0xCA,0x94,0x76,0x28,0xAB,0xF5,0x17,0x49,0x08,0x56,0xB4,0xEA,0x69,0x37,0xD5,0x8B,
  0x57,0x09,0xEB,0xB5,0x36,0x68,0x8A,0xD4,0x95,0xCB,0x29,0x77,0xF4,0xAA,0x48,0x16,
  0xE9,0xB7,0x55,0x0B,0x88,0xD6,0x34,0x6A,0x2B,0x75,0x97,0xC9,0x4A,0x14,0xF6,0xA8,
  0x74,0x2A,0xC8,0x96,0x15,0x4B,0xA9,0xF7,0xB6,0xE8,0x0A,0x54,0xD7,0x89,0x6B,0x35
];

function crc8_854(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC8_854_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return crc;
}

// Frame types
export const FrameType = { QUERY: 0x03, CONTROL: 0x02 };

/**
 * Wraps body bytes into a full Midea frame:
 * header(10) + body + msgId + crc8 + checksum
 */
function buildFrame(bodyBytes, frameType) {
  const payload = Array.from(bodyBytes);
  payload.push(nextControlMessageId());
  payload.push(crc8_854(payload));
  const header = [0xaa, payload.length + 10, 0xac, 0, 0, 0, 0, 0, 0, frameType];
  const frame = header.concat(payload);
  const sum = frame.slice(1).reduce((a, b) => a + b, 0);
  frame.push((~sum + 1) & 0xff);
  return bytesToHex(new Uint8Array(frame));
}

/**
 * Builds dynamic Query Status command packet (0x41) with fresh messageId and valid CRC8-854
 */
export function buildQueryPacket() {
  const body = [
    0x41,
    0x81, 0x00, 0xff, 0x03, 0xff, 0x00,
    0x02, // Indoor temperature request
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x03
  ];
  return buildFrame(body, FrameType.QUERY);
}

export function buildControlPacket(state, options = {}) {
  const beepOn = options.beep !== false;
  const targetTemp = Math.max(16, Math.min(30, state.targetTemperature || 24));
  const tempInt = Math.floor(targetTemp);
  const isHalfDegree = (targetTemp % 1) !== 0;

  let temperature;
  let temperatureAlt = 0;
  if (tempInt >= 17 && tempInt <= 30) {
    temperature = (tempInt - 16) & 0x0f;
  } else {
    // 16 C uses the alternate encoding (reference Lua behavior)
    temperature = 0;
    temperatureAlt = (tempInt - 12) & 0x1f;
  }
  if (isHalfDegree) temperature |= 0x10;

  const modeVal = ((state.mode || ACMode.COOL) & 0x07) << 5;
  // Byte 11: app control source (0x02) | beep (0x40) | power.
  // beep can be silenced for intermediate frames of a multi-frame batch so
  // the unit beeps only once per user action.
  const beepPower = 0x02 | (beepOn ? 0x40 : 0x00) | (state.power ? 0x01 : 0x00);
  const fanVal = (state.fanSpeed !== undefined ? state.fanSpeed : ACFanSpeed.AUTO) & 0xff;

  let swingVal = 0x30;
  if (state.swingVertical) swingVal |= 0x0c;
  if (state.swingHorizontal) swingVal |= 0x03;

  const isCoolMode = ((state.mode || ACMode.COOL) & 0x07) === ACMode.COOL;
  const turboActive = Boolean(state.turbo && isCoolMode);

  const body = [
    0x40,
    beepPower,
    (temperature | modeVal) & 0xff,
    fanVal,
    0x7f, 0x7f, 0x00, // timer-off sentinel
    swingVal,
    (turboActive ? 0x20 : 0x00), // alt turbo
    (state.eco ? 0x80 : 0x00), // eco
    (state.sleep ? 0x01 : 0x00) | (turboActive ? 0x02 : 0x00), // sleep | turbo echo (Celsius)
    0x00, 0x00, 0x00, 0x00, // unknown
    0x00, 0x00, 0x00, // unknown
    temperatureAlt & 0xff,
    40 & 0x7f, // target humidity default
    0x00, // unknown
    0x00, // freeze protection off
    0x00, // independent aux heat off
    0x00 // unknown
  ];

  return buildFrame(body, FrameType.CONTROL);
}

/**
 * Builds the LED display TOGGLE packet (reference: msmart-ng ToggleDisplayCommand).
 * NOTE: the display is a toggle (no absolute on/off in this protocol), sent as a
 * QUERY-type 0x41 frame. Verified pattern against reference implementation.
 */
export function buildToggleDisplayPacket(beep = true) {
  const body = [
    0x41,
    0x02 | (beep ? 0x40 : 0x00), // control source + beep
    0x00, 0xff, 0x02,
    0x00, 0x02, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00
  ];
  return buildFrame(body, FrameType.QUERY);
}

/**
 * Parses a response packet from AC (Query reply or Control confirmation)
 * Reconstructed from APK DataResponseOld.toObject
 *
 * @param {string|Uint8Array} rawData Hex string or Uint8Array
 */
export function parseResponsePacket(rawData) {
  const bytes = typeof rawData === 'string' ? hexToBytes(rawData) : rawData;
  if (!bytes || bytes.length < 23 || bytes[0] !== 0xAA) {
    return null;
  }

  // Byte 10: Data Type / Response ID. Must be 0xC0 (State response) or 0xA0 (Legacy state response).
  // Non-state frames (e.g. 0xB0/0xB1 properties or 0xB5 capabilities) must not be parsed as AC state.
  const dataType = bytes[10];
  if (dataType !== 0xC0 && dataType !== 0xA0) {
    return null;
  }

  // Byte 11: Power status (bit 0)
  const power = (bytes[11] & 0x01) !== 0;

  // Byte 12: Mode (bits 5-7), Target Temperature (bits 0-3), Half-degree (bit 4)
  const mode = (bytes[12] >> 5) & 0x07;
  let targetTemperature = (bytes[12] & 0x0F) + 16;
  if ((bytes[12] & 0x10) !== 0) {
    targetTemperature += 0.5;
  } else if (bytes.length > 31 && (bytes[31] & 0x01) !== 0) {
    targetTemperature += 0.5;
  }

  // Byte 13: Fan speed (raw: 20/40/60/80/100/102)
  const fanSpeed = bytes[13] & 0xFF;

  // Byte 17: Swing
  const swingVertical = (bytes[17] & 0x0C) !== 0;
  const swingHorizontal = (bytes[17] & 0x03) !== 0;

  // Byte 18: Turbo (bit 5 in this byte AND bit 1 of byte 20, per reference)
  // Turbo is only valid in COOL (frío) mode on this unit
  const isCoolMode = mode === ACMode.COOL;
  const turbo = isCoolMode && ((bytes[18] & 0x20) !== 0 || (bytes.length > 20 && (bytes[20] & 0x02) !== 0));

  // Byte 19: Eco (bit 7: 0x80 or bit 4: 0x10)
  const eco = (bytes[19] & 0x80) !== 0 || (bytes[19] & 0x10) !== 0;

  // Byte 20: Sleep (bit 0)
  const sleep = (bytes[20] & 0x01) !== 0;

  // Byte 21: Indoor temperature (T1): (byte[21] - 50) / 2
  let indoorTemperature = targetTemperature;
  if (bytes.length > 21 && bytes[21] > 0 && bytes[21] < 255) {
    indoorTemperature = (bytes[21] - 50) / 2;
    if (bytes.length > 25 && (bytes[25] & 0x0F) > 0) {
      indoorTemperature += (bytes[25] & 0x0F) * 0.1;
    }
  }

  // Byte 22: Outdoor temperature (T4): (byte[22] - 50) / 2
  let outdoorTemperature = 0;
  if (bytes.length > 22 && bytes[22] > 0 && bytes[22] < 255) {
    outdoorTemperature = (bytes[22] - 50) / 2;
    if (bytes.length > 25 && ((bytes[25] >> 4) & 0x0F) > 0) {
      outdoorTemperature += ((bytes[25] >> 4) & 0x0F) * 0.1;
    }
  }

  // Screen display LED: ON when frame byte 24 != 0x70.
  // Reference (midea-msmart state_response): display_on = (payload[14] != 0x70).
  // The previous bitmask check was inverted (showed ON as OFF and vice versa).
  let screenDisplay = true;
  if (bytes.length > 24) {
    screenDisplay = bytes[24] !== 0x70;
  }
  return {
    power,
    mode: mode >= 1 && mode <= 5 ? mode : ACMode.COOL,
    targetTemperature,
    indoorTemperature: Math.round(indoorTemperature * 10) / 10,
    outdoorTemperature: Math.round(outdoorTemperature * 10) / 10,
    fanSpeed,
    swingVertical,
    swingHorizontal,
    eco,
    turbo,
    sleep,
    screenDisplay
  };
}

/**
 * Builds a SetProperties (0xB0) command frame for a single property.
 * Used for louver fixed positions (SWING_UD_ANGLE / SWING_LR_ANGLE).
 * Verified live 2026-10-07: SET UD=50 acked 0x00 and read back 50.
 *
 * @param {number} propId 16-bit property ID (little-endian on the wire)
 * @param {number[]} valueBytes raw value bytes (single byte for angles)
 */
export function buildSetPropertyPacket(propId, valueBytes) {
  const body = [
    0xb0,
    0x01, // one property
    propId & 0xff,
    (propId >> 8) & 0xff,
    valueBytes.length & 0xff,
    ...valueBytes.map((b) => b & 0xff)
  ];
  return buildFrame(body, FrameType.CONTROL);
}

/**
 * Builds a GetProperties (0xB1) query frame for a single property.
 */
export function buildGetPropertyPacket(propId) {
  const body = [0xb1, 0x01, propId & 0xff, (propId >> 8) & 0xff];
  return buildFrame(body, FrameType.QUERY);
}

/**
 * Parses a 0xB0 ack / 0xB1 properties response into { propId: { value, error } }.
 * Entry layout: [id_lo, id_hi, result, size, value...]. result bit 0x10 = error.
 * Returns null when the frame is not a properties response.
 */
export function parsePropertyReply(rawData) {
  const bytes = typeof rawData === 'string' ? hexToBytes(rawData) : rawData;
  if (!bytes || bytes.length < 14 || bytes[0] !== 0xaa) {
    return null;
  }
  const frameId = bytes[10];
  if (frameId !== 0xb0 && frameId !== 0xb1) {
    return null;
  }
  const count = bytes[11];
  const result = {};
  let p = 12;
  for (let c = 0; c < count && p + 3 < bytes.length; c++) {
    const id = bytes[p] | (bytes[p + 1] << 8);
    const resFlag = bytes[p + 2];
    const size = bytes[p + 3];
    const value = Array.from(bytes.slice(p + 4, p + 4 + size));
    result[id] = {
      value: size === 1 ? value[0] : value,
      error: (resFlag & 0x10) !== 0,
      rawResult: resFlag
    };
    p += 4 + size;
  }
  return result;
}

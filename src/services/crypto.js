/**
 * Cryptographic utilities for Mirage / Midea API communication.
 * Reverse-engineered from Mirage AC APK (OppSecurityUtils & MSmartSDK)
 */

import CryptoJS from 'crypto-js';

/**
 * Computes SHA-256 hex string for UTF-8 string
 */
export function makeSha256(text) {
  if (!text) return '';
  return CryptoJS.SHA256(String(text)).toString(CryptoJS.enc.Hex);
}

/**
 * Computes MD5 hex string
 */
export function makeMd5(text) {
  if (!text) return '';
  return CryptoJS.MD5(String(text)).toString(CryptoJS.enc.Hex);
}

/**
 * Encrypt password for login
 * Formula: SHA256( loginId + SHA256(password) + appKey )
 */
export function loginEncrypt(password, loginId, appKey) {
  const passSha = makeSha256(password);
  const combined = (loginId ? String(loginId) : '') + passSha + String(appKey);
  return makeSha256(combined);
}

/**
 * Format timestamp YYYYMMDDHHmmss
 */
export function getFormatStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const Y = date.getFullYear();
  const M = pad(date.getMonth() + 1);
  const D = pad(date.getDate());
  const h = pad(date.getHours());
  const m = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${Y}${M}${D}${h}${m}${s}`;
}

/**
 * Generates API request signature
 * Formula: SHA256( uri + queryString + appKey )
 * where queryString is sorted parameters: key=val&key2=val2...
 */
export function requestSign(urlPath, params, appKey) {
  let uri = urlPath;
  try {
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      const parsed = new URL(uri);
      uri = parsed.pathname;
    }
  } catch {
    // Keep uri as is
  }
  if (!uri.startsWith('/')) {
    uri = '/' + uri;
  }

  // Sort keys alphabetically
  const keys = Object.keys(params).sort();
  const pairs = [];
  for (const k of keys) {
    if (params[k] !== undefined && params[k] !== null && k !== 'sign') {
      pairs.push(`${k}=${params[k]}`);
    }
  }
  const queryString = pairs.join('&');
  const combined = uri + queryString + String(appKey);
  return makeSha256(combined);
}

/**
 * Derive AES Key & IV from appKey for decrypting login response tokens
 * Key = SHA256(appKey)[0..16]
 * IV  = SHA256(appKey)[16..32]
 */
function deriveLoginKeys(appKey) {
  const sha = makeSha256(appKey);
  const key = CryptoJS.enc.Utf8.parse(sha.substring(0, 16));
  const iv = CryptoJS.enc.Utf8.parse(sha.substring(16, 32));
  return { key, iv };
}

/**
 * Decrypts encrypted accessToken or randomData from login response
 * Reverse-engineered from com.midea.iot.sdk.w3.a and EncodeAndDecodeUtils:
 * 1. Primary (MSmart standard): MD5(appKey).substring(0, 16) in AES-128-ECB mode
 * 2. Fallback: SHA256(appKey) in AES-128-CBC mode
 */
export function decryptLoginField(encHex, appKey) {
  if (!encHex) return '';
  // 1. Primary: MSmart standard ECB with MD5(appKey).substring(0, 16)
  try {
    const md5Key = makeMd5(appKey).substring(0, 16);
    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: CryptoJS.enc.Hex.parse(encHex) },
      CryptoJS.enc.Utf8.parse(md5Key),
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    const token = decrypted.toString(CryptoJS.enc.Utf8);
    if (token && token.length > 0) {
      return token;
    }
  } catch {}

  // 2. Fallback: SHA-256 CBC
  try {
    const { key, iv } = deriveLoginKeys(appKey);
    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Hex.parse(encHex)
    });
    const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    const token = decrypted.toString(CryptoJS.enc.Utf8);
    if (token && token.length > 0) {
      return token;
    }
  } catch (err) {
    console.warn('[Crypto] Fallback to raw token on decrypt error:', err);
  }

  return encHex;
}

/**
 * Converts a Uint8Array / byte buffer into comma-separated signed decimal integers.
 * Reconstructed from com.midea.iot.sdk.a8.c([B):
 * In Java: sb.append((int) bytes[i]); sb.append(",");
 * In byte-to-int conversion, values >= 128 are sign-extended to negative (-128..127).
 */
export function bytesToSignedComma(buf) {
  const parts = [];
  for (let i = 0; i < buf.length; i++) {
    let b = buf[i];
    if (b > 127) b -= 256;
    parts.push(b);
  }
  return parts.join(',');
}

/**
 * Builds 8370 envelope buffer (Uint8Array) around the AC command packet
 * Reconstructed from com.midea.iot.sdk.o1
 */
export function buildEnvelopeBuffer(hexOrder, applianceIdStr, msgId = 1, msgType = 32) {
  const cleanHex = hexOrder.replace(/\s+/g, '');
  const payloadBytes = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    payloadBytes.push(parseInt(cleanHex.substring(i, i + 2), 16));
  }
  const payloadLen = payloadBytes.length;
  const totalLen = 40 + payloadLen + 16;
  const buf = new Uint8Array(totalLen);

  // Magic 0x5A 0x5A
  buf[0] = 0x5a;
  buf[1] = 0x5a;
  // Version
  buf[2] = 0x01;
  // Flags
  buf[3] = 0x00;

  // Total Length (Little-Endian Short)
  buf[4] = totalLen & 0xff;
  buf[5] = (totalLen >> 8) & 0xff;

  // Msg Type (Little-Endian Short) = 32
  buf[6] = msgType & 0xff;
  buf[7] = (msgType >> 8) & 0xff;

  // Msg ID (Little-Endian Int)
  buf[8] = msgId & 0xff;
  buf[9] = (msgId >> 8) & 0xff;
  buf[10] = (msgId >> 16) & 0xff;
  buf[11] = (msgId >> 24) & 0xff;

  // Timestamp 8 bytes
  const now = new Date();
  const yearStr = String(now.getFullYear()).padStart(4, '0');
  buf[12] = 0;
  buf[13] = now.getSeconds();
  buf[14] = now.getMinutes();
  buf[15] = now.getHours();
  buf[16] = now.getDate();
  buf[17] = now.getMonth() + 1;
  buf[18] = parseInt(yearStr.substring(2, 4), 10);
  buf[19] = parseInt(yearStr.substring(0, 2), 10);

  // Appliance ID (6 bytes Little-Endian)
  try {
    let bigId = BigInt(applianceIdStr);
    for (let i = 0; i < 6; i++) {
      buf[20 + i] = Number(bigId & 0xffn);
      bigId >>= 8n;
    }
  } catch {
    // Leave zeros if non-numeric
  }

  // Payload
  for (let i = 0; i < payloadLen; i++) {
    buf[40 + i] = payloadBytes[i];
  }

  // Trailing 16 bytes remain zero padding/checksum
  return buf;
}

/**
 * Builds 8370 envelope packet as comma-separated signed decimal string
 * (as required by Midea cloud order encryption pipeline)
 */
export function buildEnvelopePacket(hexOrder, applianceIdStr, msgId = 1, msgType = 32) {
  const buf = buildEnvelopeBuffer(hexOrder, applianceIdStr, msgId, msgType);
  return bytesToSignedComma(buf);
}

/**
 * Encrypts order/envelope using AES-128
 * Reconstructed from com.midea.iot.sdk.w3.b and EncodeAndDecodeUtils.encodeAES:
 * - Order is formatted as comma-separated signed decimals (e.g. "90,90,1,0,...")
 * - If randomData / IV is null, uses AES/ECB/PKCS5Padding
 * - If randomData is provided (>= 16 bytes), uses AES/CBC/PKCS5Padding with randomData as IV
 * - Returns lowercase Hex string
 */
export function encryptOrder(orderPayload, accessToken, randomData, encMode = 'ecb') {
  if (!orderPayload) return '';
  if (!accessToken || encMode === 'raw') {
    return String(orderPayload).toLowerCase();
  }
  try {
    let plainText = orderPayload;
    if (typeof plainText !== 'string') {
      plainText = bytesToSignedComma(plainText);
    }
    const key = CryptoJS.enc.Utf8.parse(accessToken);
    const data = CryptoJS.enc.Utf8.parse(plainText);

    const hasValidIv = randomData && typeof randomData === 'string' && randomData.trim().length >= 16;
    if (encMode === 'cbc' && hasValidIv) {
      const iv = CryptoJS.enc.Utf8.parse(randomData.trim().substring(0, 16));
      const encrypted = CryptoJS.AES.encrypt(data, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      return encrypted.ciphertext.toString(CryptoJS.enc.Hex).toLowerCase();
    } else {
      // Default: AES-128-ECB PKCS7 (Standard APK behavior)
      const encrypted = CryptoJS.AES.encrypt(data, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
      });
      return encrypted.ciphertext.toString(CryptoJS.enc.Hex).toLowerCase();
    }
  } catch (err) {
    console.warn('[Crypto] Error encrypting order:', err);
    return String(orderPayload).toLowerCase();
  }
}

/**
 * Decrypts reply hex using AES-128 and parses the comma-separated decimal or hex reply.
 * Reconstructed from com.midea.iot.sdk.w3.a and EncodeAndDecodeUtils.decodeAES.
 * Returns the inner AC frame hex string (e.g. "AA23AC...").
 */
export function decryptReply(replyHex, accessToken, randomData, encMode = null) {
  if (!replyHex) return '';
  const cleanReply = replyHex.toLowerCase().replace(/\s+/g, '');
  if (!accessToken) return replyHex;

  try {
    const key = CryptoJS.enc.Utf8.parse(accessToken);
    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Hex.parse(cleanReply)
    });

    const hasValidIv = randomData && typeof randomData === 'string' && randomData.trim().length >= 16;
    let decStr = '';

    // If CBC mode requested and IV is available
    if (encMode === 'cbc' && hasValidIv) {
      try {
        const iv = CryptoJS.enc.Utf8.parse(randomData.trim().substring(0, 16));
        decStr = CryptoJS.AES.decrypt(cipherParams, key, {
          iv: iv,
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7
        }).toString(CryptoJS.enc.Utf8);
      } catch {}
    }

    // Try ECB decryption (standard APK default)
    if (!decStr) {
      try {
        decStr = CryptoJS.AES.decrypt(cipherParams, key, {
          mode: CryptoJS.mode.ECB,
          padding: CryptoJS.pad.Pkcs7
        }).toString(CryptoJS.enc.Utf8);
      } catch {}
    }

    // Try CBC decryption if not already attempted
    if (!decStr && hasValidIv) {
      try {
        const iv = CryptoJS.enc.Utf8.parse(randomData.trim().substring(0, 16));
        decStr = CryptoJS.AES.decrypt(cipherParams, key, {
          iv: iv,
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7
        }).toString(CryptoJS.enc.Utf8);
      } catch {}
    }

    // If decrypted content is comma-separated decimal bytes (a8.a representation)
    if (decStr && decStr.includes(',')) {
      const parts = decStr.split(',').map(Number);
      const bytes = new Uint8Array(parts.length);
      for (let i = 0; i < parts.length; i++) {
        bytes[i] = parts[i] & 0xff;
      }
      let hex = '';
      for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
      }
      return extractEnvelopePayload(hex);
    }

    if (decStr) {
      return extractEnvelopePayload(decStr);
    }

    return cleanReply;
  } catch (err) {
    console.warn('[Crypto] Error decrypting reply:', err);
    return replyHex;
  }
}

/**
 * Extracts inner AC packet payload (starting with AA) from 8370 envelope
 * Reconstructed from com.midea.iot.sdk payload extraction logic.
 */
export function extractEnvelopePayload(envelopeHex) {
  if (!envelopeHex) return '';
  const clean = envelopeHex.toLowerCase().replace(/\s+/g, '');

  // 1. Direct match: packet already starts with AA and has AC at byte 2 (hex index 4)
  if (clean.startsWith('aa') && clean.length >= 6 && clean.substring(4, 6) === 'ac') {
    const len = parseInt(clean.substring(2, 4), 16);
    if (len > 0 && len <= 64) {
      const packetHexLen = (len + 1) * 2;
      if (clean.length >= packetHexLen) {
        return clean.substring(0, packetHexLen).toUpperCase();
      }
    }
    return clean.toUpperCase();
  }

  // 2. 8370 envelope: starts with 5a5a, header is 40 bytes (80 hex chars)
  if (clean.startsWith('5a5a') && clean.length >= 82) {
    const candidate = clean.substring(80);
    if (candidate.startsWith('aa') && candidate.length >= 6 && candidate.substring(4, 6) === 'ac') {
      const len = parseInt(candidate.substring(2, 4), 16);
      if (len > 0 && len <= 64) {
        const packetHexLen = (len + 1) * 2;
        if (candidate.length >= packetHexLen) {
          return candidate.substring(0, packetHexLen).toUpperCase();
        }
      }
      return candidate.toUpperCase();
    }
  }

  // 3. Search for even-byte aligned 'aa' where byte 2 is appliance type 'ac'
  for (let i = 0; i <= clean.length - 24; i += 2) {
    if (clean.substring(i, i + 2) === 'aa' && clean.substring(i + 4, i + 6) === 'ac') {
      const len = parseInt(clean.substring(i + 2, i + 4), 16);
      if (len > 0 && len <= 64) {
        const frameHexLen = (len + 1) * 2;
        if (clean.length >= i + frameHexLen) {
          return clean.substring(i, i + frameHexLen).toUpperCase();
        }
      }
      return clean.substring(i).toUpperCase();
    }
  }

  // 4. Fallback: search for any even-byte aligned 'aa'
  for (let i = 0; i <= clean.length - 20; i += 2) {
    if (clean.substring(i, i + 2) === 'aa') {
      return clean.substring(i).toUpperCase();
    }
  }

  return envelopeHex.toUpperCase();
}


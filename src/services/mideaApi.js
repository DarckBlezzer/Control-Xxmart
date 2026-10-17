/**
 * Mirage / Midea Cloud API Client
 * Reverse-engineered from Mirage AC APK (OppSecurityUtils & MSmartSDK)
 */

import {
  loginEncrypt,
  requestSign,
  getFormatStamp,
  decryptLoginField,
  buildEnvelopePacket,
  encryptOrder,
  decryptReply,
  extractEnvelopePayload
} from './crypto.js';
import { Capacitor } from '@capacitor/core';

// Cloud configuration extracted from APK
export const API_CONFIG = {
  APP_ID: '1017',
  APP_KEY: '3742e9e5842d4ad59c2db887e12449f9',
  SRC: '17',
  FORMAT: '2',
  CLIENT_TYPE: '1', // Android Client
  BASE_URL: 'https://mapp.appsmb.com/v1',
  FALLBACK_URL: 'http://mapp.appsmb.com:10050/v1'
};

/**
 * Friendly Spanish error translations for Midea / Mirage Cloud error codes
 */
const ERROR_CODE_MESSAGES = {
  '1001': 'Error de validación en el servidor Mirage (1001).',
  '1002': 'Firma de solicitud inválida (1002).',
  '1004': 'Parámetro inválido en la solicitud (1004).',
  '1011': 'El servidor Mirage no pudo procesar la función (1011). Reintentando con formato alternativo...',
  '3001': 'Faltan parámetros requeridos.',
  '3002': 'Usuario o contraseña incorrectos.',
  '3004': 'Dispositivo no encontrado en la cuenta.',
  '3101': 'La sesión ha expirado.',
  '3102': 'Token de sesión inválido.',
  '3106': 'Sesión no válida o expirada.',
  '3138': 'El aire acondicionado está ocupado procesando otro comando.',
  '3144': 'Comando no soportado por este modelo.',
  '3176': 'El aire no confirmó el comando (3176): la nube lo ve en línea pero el módulo WiFi no responde. Revisa que el LED WiFi esté fijo y reintenta; si persiste, re-vincula el WiFi del aire.',
  '-1': 'Error desconocido en la comunicación.',
  '-2': 'Error de conexión con el servidor.'
};

function translateErrorMessage(errorCode, rawMsg) {
  const codeStr = String(errorCode);
  if (ERROR_CODE_MESSAGES[codeStr]) {
    return ERROR_CODE_MESSAGES[codeStr];
  }
  // If message contains Chinese characters, return generic readable Spanish
  if (rawMsg && /[\u4e00-\u9fa5]/.test(rawMsg)) {
    return `Error del servidor Mirage (${errorCode || 'general'}). Reintentando...`;
  }
  return rawMsg || `Error en el servicio (${codeStr})`;
}

/**
 * Determine the best endpoint based on platform
 */
function getEndpointUrl(path) {
  if (typeof window !== 'undefined' && !Capacitor.isNativePlatform() && window.location.hostname === 'localhost') {
    return `/v1${path.startsWith('/') ? path : '/' + path}`;
  }
  return `${API_CONFIG.BASE_URL}${path.startsWith('/') ? path : '/' + path}`;
}

/**
 * Makes an HTTP POST request formatted as form-urlencoded (as required by Midea API)
 */
async function postForm(path, params, timeoutMs = 12000) {
  const url = getEndpointUrl(path);
  const formData = new URLSearchParams();

  for (const key of Object.keys(params)) {
    if (params[key] !== undefined && params[key] !== null) {
      formData.append(key, String(params[key]));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 10; Mobile)'
      },
      body: formData.toString(),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`HTTP Error ${response.status}: ${errorText || response.statusText}`);
    }

    const json = await response.json();
    return json;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al conectar con el servidor Mirage (timeout).');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 1. Get Login ID for user email
 * /v1/user/login/id/get
 */
export async function getLoginId(email) {
  const stamp = getFormatStamp();
  const path = '/user/login/id/get';
  const params = {
    appId: API_CONFIG.APP_ID,
    format: API_CONFIG.FORMAT,
    clientType: API_CONFIG.CLIENT_TYPE,
    src: API_CONFIG.SRC,
    stamp: stamp,
    loginAccount: email.trim(),
    language: 'en_US'
  };

  params.sign = requestSign(`/v1${path}`, params, API_CONFIG.APP_KEY);

  const res = await postForm(path, params);
  if (res.errorCode && res.errorCode !== '0' && res.errorCode !== 0) {
    const msg = translateErrorMessage(res.errorCode, res.msg);
    throw new Error(msg);
  }

  return res.result?.loginId || '';
}

/**
 * 2. Login with email & password
 * /v1/user/login
 */
export async function login(email, password) {
  const cleanEmail = email.trim();
  // loginId is required to encrypt the password. On a flaky network the
  // first attempt can fail: retry once. Never fall back to an empty loginId,
  // which would encrypt wrong and misreport "bad password".
  let loginId = '';
  try {
    loginId = await getLoginId(cleanEmail);
  } catch (firstErr) {
    console.warn('[MideaAPI] getLoginId falló, reintentando una vez...', firstErr?.message);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    loginId = await getLoginId(cleanEmail);
  }

  const encryptedPassword = loginEncrypt(password, loginId, API_CONFIG.APP_KEY);
  const stamp = getFormatStamp();
  const path = '/user/login';
  const params = {
    appId: API_CONFIG.APP_ID,
    clientType: API_CONFIG.CLIENT_TYPE,
    src: API_CONFIG.SRC,
    format: API_CONFIG.FORMAT,
    stamp: stamp,
    loginAccount: cleanEmail,
    password: encryptedPassword,
    language: 'en_US'
  };

  params.sign = requestSign(`/v1${path}`, params, API_CONFIG.APP_KEY);

  const res = await postForm(path, params);
  if (res.errorCode && res.errorCode !== '0' && res.errorCode !== 0) {
    const msg = translateErrorMessage(res.errorCode, res.msg);
    const err = new Error(msg);
    err.errorCode = res.errorCode;
    throw err;
  }

  // Decrypt accessToken and randomData using appKey
  const rawAccessToken = res.result?.accessToken || '';
  const rawRandomData = res.result?.randomData || '';

  const decryptedAccessToken = decryptLoginField(rawAccessToken, API_CONFIG.APP_KEY);
  const decryptedRandomData = decryptLoginField(rawRandomData, API_CONFIG.APP_KEY);

  return {
    sessionId: res.result?.sessionId || '',
    accessToken: decryptedAccessToken,
    randomData: decryptedRandomData,
    userId: res.result?.userId || '',
    loginId: loginId,
    email: cleanEmail
  };
}

/**
 * Helper to normalize a device object from Midea Cloud
 */
function normalizeAppliance(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || item.applianceId || item.ApplianceId || item.appliance_id || '');
  if (!id) return null;

  const isOnline = item.onlineStatus === '1' || item.onlineStatus === 1 || item.OnlineStatus === '1' || item.OnlineStatus === 1 || item.online === true;

  return {
    id: id,
    name: item.name || item.applianceName || item.Name || item.des || item.Des || 'Aire Acondicionado Mirage',
    type: item.type || item.applianceType || item.ApplianceType || '0xAC',
    sn: item.sn || item.applianceSn || item.ApplianceSN || '',
    online: isOnline,
    onlineStatus: isOnline ? '1' : '0',
    modelNumber: item.modelNumber || item.model || '',
    raw: item
  };
}

/**
 * 3. Get Device List
 * Tries multiple endpoints (/appliance/user/list/get/new, /appliance/user/list/get, /appliance/list/get, /appliance/home/list/get)
 */
export async function getDeviceList(session) {
  const sessionId = typeof session === 'string' ? session : session?.sessionId;
  if (!sessionId) {
    throw new Error('No hay sesión activa para obtener la lista de dispositivos.');
  }

  const stamp = getFormatStamp();
  const endpoints = [
    '/appliance/user/list/get/new',
    '/appliance/user/list/get',
    '/appliance/list/get/new',
    '/appliance/list/get',
    '/appliance/home/list/get/new',
    '/appliance/home/list/get'
  ];

  let lastError = null;
  for (const path of endpoints) {
    try {
      const params = {
        src: API_CONFIG.SRC,
        sessionId: sessionId,
        format: API_CONFIG.FORMAT,
        stamp: stamp,
        language: 'en_US'
      };

      params.sign = requestSign(`/v1${path}`, params, API_CONFIG.APP_KEY);
      const res = await postForm(path, params);

      if (res.errorCode && res.errorCode !== '0' && res.errorCode !== 0) {
        lastError = new Error(translateErrorMessage(res.errorCode, res.msg));
        lastError.errorCode = res.errorCode;
        const code = String(res.errorCode);
        // If session is expired, abort trying other endpoints immediately
        if (code === '3101' || code === '3102' || code === '3106') {
          throw lastError;
        }
        continue;
      }

      if (res.result) {
        let rawItems = [];
        if (Array.isArray(res.result.list)) {
          rawItems = res.result.list;
        } else if (Array.isArray(res.result.applianceList)) {
          rawItems = res.result.applianceList;
        } else if (Array.isArray(res.result.appliances)) {
          rawItems = res.result.appliances;
        } else if (Array.isArray(res.result)) {
          rawItems = res.result;
        } else if (Array.isArray(res.result.homeList)) {
          for (const home of res.result.homeList) {
            const hList = home.appliances || home.applianceList || home.list || [];
            if (Array.isArray(hList)) {
              rawItems.push(...hList);
            }
          }
        }

        const normalized = rawItems.map(normalizeAppliance).filter(Boolean);
        if (normalized.length > 0) {
          return normalized;
        }

        // If list is explicitly empty [] from a valid 0 error code response
        if (Array.isArray(rawItems)) {
          return [];
        }
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
}

let messageSequence = 1;

// Retrieve cached working strategy from localStorage if available
function getStoredStrategy() {
  try {
    const raw = localStorage.getItem('mirage_working_trans_strategy');
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function setStoredStrategy(strat) {
  try {
    localStorage.setItem('mirage_working_trans_strategy', JSON.stringify({
      path: strat.path,
      funId: strat.funId,
      encMode: strat.encMode,
      useEnvelope: strat.useEnvelope,
      includeAppId: strat.includeAppId
    }));
  } catch {}
}

let cachedTransparentStrategy = getStoredStrategy();

/**
 * 4. Send Transparent Command (AC status query or control)
 * Dispatches transparent AC packet to Midea Cloud.
 * Uses intelligent fallback across:
 * - Encryption modes: AES-128-ECB (APK default without IV), AES-128-CBC (when IV exists), and raw
 * - Endpoints: /appliance/transparent/send/new and /appliance/transparent/send
 * - Function IDs: '0008' (MSmart primary), '1000' (OEM), '0000' (legacy)
 * - Payload packaging: 8370 Envelope (V3) or Direct AC Frame (V2)
 */
export async function sendTransparentCmd(session, applianceId, hexOrder) {
  const sessionId = typeof session === 'string' ? session : session?.sessionId;
  let accessToken = session?.accessToken || '';
  const randomData = session?.randomData || '';

  if (!sessionId) {
    throw new Error('No hay sesión activa para enviar comandos al dispositivo.');
  }

  // Defensive: if token is 64-char hex, decrypt it on the fly
  if (accessToken && accessToken.length === 64) {
    accessToken = decryptLoginField(accessToken, API_CONFIG.APP_KEY);
  }

  // Base strategies to evaluate in strict order of likelihood
  const defaultStrategies = [
    // 1. Primary verified winner: 8370 Envelope + AES-ECB + /send + funId 0008 + appId
    { path: '/appliance/transparent/send', funId: '0008', encMode: 'ecb', useEnvelope: true, includeAppId: true },
    // 2. 8370 Envelope + AES-ECB + /send/new + funId 0008 + appId
    { path: '/appliance/transparent/send/new', funId: '0008', encMode: 'ecb', useEnvelope: true, includeAppId: true },
    // 3. 8370 Envelope + AES-ECB + /send + funId 0008 without appId
    { path: '/appliance/transparent/send', funId: '0008', encMode: 'ecb', useEnvelope: true, includeAppId: false },
    // 4. If randomData exists: 8370 Envelope + AES-CBC
    ...(randomData && String(randomData).trim().length >= 16 ? [
      { path: '/appliance/transparent/send', funId: '0008', encMode: 'cbc', useEnvelope: true, includeAppId: true },
      { path: '/appliance/transparent/send/new', funId: '0008', encMode: 'cbc', useEnvelope: true, includeAppId: true }
    ] : [])
  ];

  // If a previously verified working strategy is cached, prioritize it first
  const currentCached = cachedTransparentStrategy || getStoredStrategy();
  let strategies = defaultStrategies;
  if (currentCached) {
    strategies = [
      currentCached,
      ...defaultStrategies.filter(
        (s) =>
          s.path !== currentCached.path ||
          s.funId !== currentCached.funId ||
          s.encMode !== currentCached.encMode ||
          s.useEnvelope !== currentCached.useEnvelope ||
          s.includeAppId !== currentCached.includeAppId
      )
    ];
  }

  let lastError = null;

  for (const strategy of strategies) {
    try {
      // 1. Build payload packet (signed comma decimal string if envelope)
      let payload = hexOrder;
      if (strategy.useEnvelope) {
        messageSequence = (messageSequence % 65535) + 1;
        payload = buildEnvelopePacket(hexOrder, applianceId, messageSequence, 32);
      }

      // 2. Encrypt order with strategy mode
      const encryptedOrder = encryptOrder(payload, accessToken, randomData, strategy.encMode);

      const stamp = getFormatStamp();
      const params = {
        format: API_CONFIG.FORMAT,
        clientType: API_CONFIG.CLIENT_TYPE,
        src: API_CONFIG.SRC,
        stamp: stamp,
        sessionId: sessionId,
        applianceId: String(applianceId),
        funId: strategy.funId,
        order: encryptedOrder,
        language: 'es_ES'
      };

      if (strategy.includeAppId) {
        params.appId = API_CONFIG.APP_ID;
      }

      params.sign = requestSign(`/v1${strategy.path}`, params, API_CONFIG.APP_KEY);

      const res = await postForm(strategy.path, params);

      if (res.errorCode && res.errorCode !== '0' && res.errorCode !== 0) {
        const msg = translateErrorMessage(res.errorCode, res.msg);
        const err = new Error(msg);
        err.errorCode = res.errorCode;
        lastError = err;
        console.warn(`[MideaAPI] Estrategia ${strategy.path} (funId=${strategy.funId}, mode=${strategy.encMode}, env=${strategy.useEnvelope}) falló con código ${res.errorCode}: ${msg}`);

        const code = String(res.errorCode);
        // Session expired: do NOT continue trying strategies with a dead token!
        if (code === '3101' || code === '3102' || code === '3106') {
          throw err;
        }
        // Device wifi module unresponsive: trying other encryptions won't help
        if (code === '3176') {
          throw err;
        }

        continue;
      }

      // Success! Cache this working strategy in memory and localStorage
      cachedTransparentStrategy = strategy;
      setStoredStrategy(strategy);
      console.log(`[MideaAPI] ¡Estrategia exitosa!`, strategy);

      const rawReply = res.result?.reply || '';
      if (!rawReply) return '';

      // 3. Decrypt reply with strategy encryption mode (extracts AA... AC frame automatically)
      const decryptedReply = decryptReply(rawReply, accessToken, randomData, strategy.encMode);
      return decryptedReply;
    } catch (err) {
      lastError = err;
      const code = String(err.errorCode || '');
      if (code === '3101' || code === '3102' || code === '3106' || code === '3176') {
        throw err;
      }
      console.warn(`[MideaAPI] Error en estrategia ${strategy.path}:`, err.message);
    }
  }

  if (lastError) {
    throw lastError;
  }

  return '';
}

/**
 * 5. Update/Refresh Session
 * /v1/user/session/update
 */
export async function updateSession(session) {
  const sessionId = typeof session === 'string' ? session : session?.sessionId;
  if (!sessionId) return;
  const stamp = getFormatStamp();
  const path = '/user/session/update';
  const params = {
    src: API_CONFIG.SRC,
    sessionId: sessionId,
    format: API_CONFIG.FORMAT,
    stamp: stamp,
    language: 'en_US'
  };

  params.sign = requestSign(`/v1${path}`, params, API_CONFIG.APP_KEY);
  return await postForm(path, params);
}

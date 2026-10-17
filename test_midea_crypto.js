import CryptoJS from 'crypto-js';

const APP_KEY = '3742e9e5842d4ad59c2db887e12449f9';

function makeSha256(text) {
  return CryptoJS.SHA256(text).toString(CryptoJS.enc.Hex);
}

function deriveLoginKeys(appKey) {
  const sha = makeSha256(appKey);
  const key = CryptoJS.enc.Utf8.parse(sha.substring(0, 16));
  const iv = CryptoJS.enc.Utf8.parse(sha.substring(16, 32));
  return { key, iv };
}

function decryptLoginField(encHex, appKey) {
  if (!encHex) return '';
  const { key, iv } = deriveLoginKeys(appKey);
  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Hex.parse(encHex)
  });
  const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  return decrypted.toString(CryptoJS.enc.Utf8);
}

function encryptOrder(envelopeHex, accessToken, randomData) {
  const key = CryptoJS.enc.Utf8.parse(accessToken);
  const iv = CryptoJS.enc.Utf8.parse(randomData);
  const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(envelopeHex), key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  return encrypted.ciphertext.toString(CryptoJS.enc.Hex).toLowerCase();
}

function decryptReply(replyHex, accessToken, randomData) {
  if (!replyHex) return '';
  const key = CryptoJS.enc.Utf8.parse(accessToken);
  const iv = CryptoJS.enc.Utf8.parse(randomData);
  const cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Hex.parse(replyHex)
  });
  const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  return decrypted.toString(CryptoJS.enc.Utf8);
}

function buildEnvelopePacket(hexOrder, applianceIdStr, msgId = 1, msgType = 32) {
  const payloadBytes = [];
  for (let i = 0; i < hexOrder.length; i += 2) {
    payloadBytes.push(parseInt(hexOrder.substring(i, i + 2), 16));
  }
  const payloadLen = payloadBytes.length;
  const totalLen = 40 + payloadLen + 16;
  const buf = new Uint8Array(totalLen);

  // 0..1: 0x5A, 0x5A
  buf[0] = 0x5a;
  buf[1] = 0x5a;
  // 2: version
  buf[2] = 0x01;
  // 3: enc / flags
  buf[3] = 0x00;

  // 4..5: totalLen (little endian)
  buf[4] = totalLen & 0xff;
  buf[5] = (totalLen >> 8) & 0xff;

  // 6..7: msgType (little endian) = 32
  buf[6] = msgType & 0xff;
  buf[7] = (msgType >> 8) & 0xff;

  // 8..11: msgId (little endian)
  buf[8] = msgId & 0xff;
  buf[9] = (msgId >> 8) & 0xff;
  buf[10] = (msgId >> 16) & 0xff;
  buf[11] = (msgId >> 24) & 0xff;

  // 12..19: timestamp (8 bytes)
  const now = new Date();
  const yearStr = String(now.getFullYear()).padStart(4, '0');
  buf[12] = 0;
  buf[13] = now.getSeconds();
  buf[14] = now.getMinutes();
  buf[15] = now.getHours();
  buf[16] = now.getDate();
  buf[17] = now.getMonth();
  buf[18] = parseInt(yearStr.substring(2, 4), 10);
  buf[19] = parseInt(yearStr.substring(0, 2), 10);

  // 20..25: applianceId (6 bytes, little endian)
  try {
    let bigId = BigInt(applianceIdStr);
    for (let i = 0; i < 6; i++) {
      buf[20 + i] = Number(bigId & 0xffn);
      bigId >>= 8n;
    }
  } catch {
    // If not numeric, leave zeroes
  }

  // 40 .. 40 + payloadLen: payloadBytes
  for (let i = 0; i < payloadLen; i++) {
    buf[40 + i] = payloadBytes[i];
  }

  // Convert buffer to hex string
  let hex = '';
  for (let i = 0; i < totalLen; i++) {
    hex += buf[i].toString(16).padStart(2, '0');
  }
  return hex.toLowerCase();
}

function extractEnvelopePayload(decryptedEnvelopeHex) {
  if (!decryptedEnvelopeHex || decryptedEnvelopeHex.length < 56 * 2) {
    return decryptedEnvelopeHex;
  }
  // If starts with 5a5a
  if (decryptedEnvelopeHex.startsWith('5a5a')) {
    const totalBytes = decryptedEnvelopeHex.length / 2;
    const payloadBytesLen = totalBytes - 56;
    if (payloadBytesLen > 0) {
      return decryptedEnvelopeHex.substring(40 * 2, (40 + payloadBytesLen) * 2);
    }
  }
  return decryptedEnvelopeHex;
}

const sampleOrder = 'AA20AC00000000000003418100FF03FF000200000000000000000000000003CD9C';
const envHex = buildEnvelopePacket(sampleOrder, '123456789012345');
console.log('Envelope Hex:', envHex);
console.log('Extracted Payload:', extractEnvelopePayload(envHex));
console.log('Matches original?:', extractEnvelopePayload(envHex).toUpperCase() === sampleOrder.toUpperCase());

// Test AES encrypt/decrypt roundtrip
const dummyToken = '1234567890123456';
const dummyRandom = '6543210987654321';
const enc = encryptOrder(envHex, dummyToken, dummyRandom);
console.log('Encrypted order:', enc);
const dec = decryptReply(enc, dummyToken, dummyRandom);
console.log('Decrypted roundtrip matches?:', dec === envHex);

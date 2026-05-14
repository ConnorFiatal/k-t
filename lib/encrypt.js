const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LEN    = 12;   // 96-bit IV recommended for GCM
const PREFIX    = 'enc:';

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY environment variable is not set');
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  return buf;
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  const key    = getKey();
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc    = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(value) {
  if (value == null || value === '') return value;
  const s = String(value);
  if (!s.startsWith(PREFIX)) return s; // plaintext passthrough — handles unencrypted legacy rows
  const key    = getKey();
  const parts  = s.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null; // malformed
  const [ivHex, tagHex, dataHex] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(dataHex, 'hex')).toString('utf8') + decipher.final('utf8');
  } catch (err) {
    console.error('[encrypt] decryption failed (tag mismatch or corrupt data):', err.message);
    return null;
  }
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted };

import { createHash, randomUUID } from 'node:crypto';
import { sessionError } from './errors.js';

// The full environment ID determines a private vault slot; user-supplied
// account password references are never used for key decryption or clearing.
export function keyPassphraseRef(id) {
  return 'DSH_REMOTE_OPS_KEY_' + createHash('sha256').update(id).digest('hex').toUpperCase() + '_PASSPHRASE';
}

export function publicEnvironment(environment) {
  const { passphraseRef, ...fields } = environment;
  return { ...fields, passwordRef: environment.passwordRef ? 'configured' : undefined, passphraseConfigured: Boolean(passphraseRef) };
}

export function validateKeyPassphrase(passphrase, clear, environment) {
  if (clear != null && typeof clear !== 'boolean') throw sessionError('SSH_KEY_PASSPHRASE_INVALID', 'clearPassphrase must be a boolean');
  if (passphrase == null || passphrase === '') return;
  if (typeof passphrase !== 'string' || passphrase.length > 8192 || clear) throw sessionError('SSH_KEY_PASSPHRASE_INVALID', 'Supply one key passphrase of at most 8192 characters or clearPassphrase, separately');
  if ((environment.transport ?? 'ssh') !== 'ssh' || !environment.privateKeyPath?.trim()) throw sessionError('SSH_KEY_PASSPHRASE_INVALID', 'An SSH private key path is required to save a key passphrase');
}

export async function writeKeyPassphrase(credentials, id, passphrase) {
  const ref = keyPassphraseRef(id);
  try {
    if (passphrase) await credentials.set(ref, passphrase); else await credentials.unset(ref);
  } catch { throw sessionError('SSH_KEY_PASSPHRASE_SAVE_FAILED', 'DSH 未能保存私钥口令更改，请重试'); }
  return passphrase ? ref : '';
}

export function validateNewPassword(password, passwordRef, family = 'REMOTE') {
  if (password == null) return false;
  if (typeof password !== 'string' || !password.length || password.length > 8192) throw sessionError(`${family}_PASSWORD_INVALID`, 'password must be a non-empty string of at most 8192 characters; omit it or use null to keep the saved password');
  if (passwordRef != null && passwordRef !== '') throw sessionError(`${family}_PASSWORD_CONFLICT`, 'Provide either password or passwordRef, not both. Omit the reference when saving a supplied password');
  return true;
}

export async function storeNewPassword(credentials, environmentId, password, family = 'REMOTE') {
  validateNewPassword(password, undefined, family);
  if (!credentials?.set) throw sessionError(`${family}_CREDENTIALS_UNAVAILABLE`, 'DSH credentials service is unavailable; environment was not changed');
  // A fresh reference cannot overwrite a credential shared by another environment.
  const reference = `DSH_${family}_${environmentId.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_PASSWORD_${randomUUID().replace(/-/g, '').toUpperCase()}`;
  try { await credentials.set(reference, password); }
  catch { throw sessionError(`${family}_PASSWORD_SAVE_FAILED`, 'DSH could not save the password; environment was not changed'); }
  return reference;
}

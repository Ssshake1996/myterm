import { randomUUID } from 'node:crypto';
import { sessionError } from './errors.js';

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

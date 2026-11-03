export const TELNET_DEFAULTS = Object.freeze({
  loginMode: 'manual', lineEnding: 'crlf',
  usernamePrompt: '(?:login|username|user name|用户名)\\s*[:：]\\s*$',
  passwordPrompt: '(?:password|密码)\\s*[:：]\\s*$',
  shellPrompt: '(?:^|[\\r\\n])[^\\r\\n]{0,120}[>#$]\\s*$',
});
export function validateTelnet(value) {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['telnet must be an object'];
  const errors = [];
  for (const key of Object.keys(value)) if (!Object.hasOwn(TELNET_DEFAULTS,key)) errors.push(`telnet.${key} is not supported`);
  if (value.loginMode !== undefined && !['manual','none','password','username-password'].includes(value.loginMode)) errors.push('telnet.loginMode must be manual, none, password or username-password');
  if (value.lineEnding !== undefined && !['crlf','cr','lf'].includes(value.lineEnding)) errors.push('telnet.lineEnding must be crlf, cr or lf');
  for (const key of ['usernamePrompt','passwordPrompt','shellPrompt']) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || !value[key] || value[key].length > 256) errors.push(`telnet.${key} must be a regular expression of 1-256 characters`);
    else { try { const re = new RegExp(value[key],'i'); if (re.test('')) errors.push(`telnet.${key} must not match empty output`); } catch { errors.push(`telnet.${key} is not a valid regular expression`); } }
  }
  return errors;
}

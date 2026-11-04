export const SERIAL_DEFAULTS = Object.freeze({
  baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', lineEnding: 'cr',
});

export function isSerialPath(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) return false;
  return /^COM[1-9]\d*$/i.test(value) ||
    /^\/dev\/(?:tty[\w.-]+|cu\.[\w.-]+|pts\/\d+|serial\/by-(?:id|path)\/[\w:+.-]+)$/.test(value) &&
    !value.split('/').some(part => part === '.' || part === '..');
}

export function validateSerial(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['serial.path is required'];
  const errors = [];
  if (!isSerialPath(value.path)) errors.push('serial.path must be a COM port or a serial device under /dev');
  for (const key of Object.keys(value)) {
    if (key !== 'path' && !Object.hasOwn(SERIAL_DEFAULTS, key)) errors.push('Unknown serial setting: ' + key);
  }
  const settings = { ...SERIAL_DEFAULTS, ...value };
  if (!Number.isInteger(settings.baudRate) || settings.baudRate < 1 || settings.baudRate > 4000000) errors.push('serial.baudRate must be an integer from 1 to 4000000');
  for (const [key, allowed] of Object.entries({
    dataBits: [5, 6, 7, 8], stopBits: [1, 2], parity: ['none', 'even', 'odd'],
    flowControl: ['none', 'rtscts', 'xonxoff'], lineEnding: ['cr', 'lf', 'crlf'],
  })) if (!allowed.includes(settings[key])) errors.push('serial.' + key + ' must be one of ' + allowed.join(', '));
  return errors;
}

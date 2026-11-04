import { realpath, stat } from 'node:fs/promises';
import iconv from 'iconv-lite';
import { normalizeTerminalEncoding, sessionError, validateEnvironment } from './common.js';
import { isSerialPath, SERIAL_DEFAULTS } from './serial-config.js';
import { SshTerminalSession } from './terminal-sessions.js';

async function nativePort() {
  try { return (await import('serialport')).SerialPort; }
  catch { throw sessionError('SERIAL_DRIVER_UNAVAILABLE', 'Could not load the serialport native binding. Check the DSH plugin dependency installation for this host.'); }
}

export async function listSerialPorts() {
  const Port = await nativePort();
  try {
    return { ports: (await Port.list()).filter(port => isSerialPath(port.path)).map(({path, manufacturer}) => ({path, manufacturer})) };
  } catch (error) {
    throw sessionError('SERIAL_ENUMERATION_FAILED', 'Could not enumerate serial ports. Enter a known device path manually. ' + error.message);
  }
}

function openError(error, path) {
  const message = error.message || String(error);
  let code = 'SERIAL_OPEN_FAILED';
  if (/EBUSY|resource busy|cannot lock|temporarily unavailable|in use/i.test(message)) code = 'SERIAL_PORT_BUSY';
  else if (/EACCES|EPERM|access (is )?denied|permission denied/i.test(message)) code = 'SERIAL_ACCESS_DENIED';
  else if (/ENOENT|not found|cannot find|no such file/i.test(message)) code = 'SERIAL_PORT_NOT_FOUND';
  return sessionError(code, path + ': ' + message);
}

class SerialTerminalSession extends SshTerminalSession {
  constructor(port, environment) {
    super(port, port, environment, environment.terminal);
    this.lineEnding = {cr:'\r', lf:'\n', crlf:'\r\n'}[environment.serial.lineEnding ?? SERIAL_DEFAULTS.lineEnding];
    port.prependOnceListener('close', error => {
      if (error) this.closeReason = error.message;
      this.append(this.decoder.decode());
    });
  }

  exitedError() {
    return sessionError('REMOTE_SESSION_EXITED', 'Serial port ' + this.environment.serial.path + ' is closed. Reopen the environment to reconnect.');
  }

  async writeInput(text) {
    if (this.closed || this.closeRequested || !this.channel.isOpen) throw this.exitedError();
    const encoding = normalizeTerminalEncoding(this.environment.encoding);
    const payload = iconv.encode(String(text ?? '').replace(/\r\n|\r|\n/g, this.lineEnding), encoding === 'iso-8859-1' ? 'windows-1252' : encoding);
    if (payload.length) await new Promise((resolve, reject) => this.channel.write(payload, error => error ? reject(error) : resolve()));
    this.lastActivity = Date.now();
    return {accepted:true, bytes:payload.length};
  }

  write(text) { return this.writeInput(text); }
  async signal(signal) {
    if (!['INT','SIGINT'].includes(signal)) throw sessionError('SERIAL_SIGNAL_UNSUPPORTED', 'Serial terminals support Ctrl+C input only');
    await this.write('\x03'); return {delivered:true};
  }
  resize() { throw sessionError('SERIAL_RESIZE_UNSUPPORTED', 'A serial line has no remote PTY window size'); }

  async close() {
    if (this.closed) return;
    if (!this.closePromise) {
      this.closeRequested = true;
      this.closePromise = new Promise((resolve, reject) => this.channel.close(error => error ? reject(error) : resolve()));
    }
    try { await this.closePromise; }
    catch (error) { this.closePromise = undefined; this.closeRequested = false; throw error; }
  }
}

export async function connectSerial(environment, {leases, signal, Port} = {}) {
  const validation = validateEnvironment(environment);
  if (!validation.ok) throw sessionError('REMOTE_ENV_INVALID', validation.errors.join(', '));
  const config = {...SERIAL_DEFAULTS, ...environment.serial};
  let path = config.path;
  if (/^COM/i.test(path)) {
    if (!Port && process.platform !== 'win32') throw sessionError('SERIAL_PORT_NOT_FOUND', 'Choose a device path on this host: ' + path);
    path = path.toUpperCase();
  } else {
    try { path = await realpath(path); } catch (error) { throw openError(error, path); }
    if (!isSerialPath(path) || !(await stat(path)).isCharacterDevice()) throw sessionError('SERIAL_PORT_INVALID', 'The target must resolve to a serial character device');
  }
  Port ??= await nativePort();
  signal?.throwIfAborted();
  if (leases.has(path)) throw sessionError('SERIAL_PORT_BUSY', path + ' is already in use by a terminal or connection test');
  const port = new Port({path, baudRate:config.baudRate, dataBits:config.dataBits, stopBits:config.stopBits,
    parity:config.parity, rtscts:config.flowControl === 'rtscts', xon:config.flowControl === 'xonxoff',
    xoff:config.flowControl === 'xonxoff', lock:true, autoOpen:false});
  const session = new SerialTerminalSession(port, environment);
  leases.add(path);
  port.once('close', () => leases.delete(path));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(session);
    };
    const abort = () => finish(signal.reason ?? sessionError('SERIAL_CANCELLED', 'Serial open cancelled'));
    const timer = setTimeout(() => finish(sessionError('SERIAL_OPEN_TIMEOUT', 'Timed out opening ' + path)), environment.readyTimeoutMs ?? 15000);
    signal?.addEventListener('abort', abort, {once:true});
    // A driver open may finish after timeout. Keep its lease until the actual handle closes.
    const opened = error => {
      if (error) { leases.delete(path); finish(openError(error, path)); }
      else if (settled) { void session.close().catch(() => {}); }
      else finish();
    };
    try { port.open(opened); } catch (error) { opened(error); }
  });
}

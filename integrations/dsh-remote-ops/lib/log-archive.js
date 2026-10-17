import { deflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { stripAnsi } from "./ansi.js";

const deflate = promisify(deflateRaw);
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
};

// A transcript, not a reconstructed VT screen. Keep CR progress frames as lines,
// remove escape/control strings, and apply ordinary backspaces within a line.
export function logText(raw) {
  const plain = stripAnsi(String(raw).replace(/\x1b[P^_X][\s\S]*?(?:\x1b\\|\x07)/gu, "")).replace(/\x1b[^\r\n]*$/u, "");
  return plain.replace(/\r\n?/gu, "\n").split("\n").map(line => {
    if (!line.includes("\b")) return line.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu, "");
    const chars = [];
    for (const char of line) {
      if (char === "\b") chars.pop();
      else if (char === "\t" || !/[\x00-\x1f\x7f-\x9f]/u.test(char)) chars.push(char);
    }
    return chars.join("");
  }).join("\n");
}

// Small bounded ZIPs with UTF-8 names and DEFLATE; no shell or platform dependency.
export async function zipLogs(files, now = new Date()) {
  const local = [], central = [];
  let offset = 0;
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8"), raw = Buffer.from(file.text, "utf8"), data = await deflate(raw);
    const crc = crc32(raw), header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(time, 10); header.writeUInt16LE(date, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); header.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(entry, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

"""An isolated serial-console peer on a real kernel PTY. Only our own master is written."""
import os
import pty
import tty

master, slave = pty.openpty()
tty.setraw(slave)
print(os.ttyname(slave), flush=True)
line = bytearray()
while True:
    for byte in os.read(master, 4096):
        if byte in (10, 13):
            if line:
                command = bytes(line)
                print(command.decode("utf-8", errors="replace"), flush=True)
                os.write(master, b"\r\nSERIAL_REPLY " + command + b"\r\nconsole> ")
                line.clear()
        elif byte == 3:
            line.clear()
            os.write(master, b"^C\r\nconsole> ")
        else:
            line.append(byte)
            os.write(master, bytes([byte]))

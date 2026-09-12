# dsh-remote-ops v0.2.4

## Changes

- Fixed the SSH open action returning HTTP 400 after a successful connection by serializing only the public session snapshot instead of the live SSH channel object.
- Added direct terminal keyboard input in the Sidebar; the dedicated command textarea is removed from the primary terminal flow.
- Forwarded Tab completion, Shift+Tab, Enter, Escape, Backspace, Delete, arrows, Home/End, PageUp/PageDown, Insert, Ctrl+C and other common control keys as raw terminal input.
- Added the `remote_terminal_input` Agent tool for immediate raw input to interactive SSH programs.
- Requested UTF-8 locale variables for SSH shells and decoded output with streaming `TextDecoder`; supported encodings include UTF-8, GB18030, Big5, Windows-1252 and ISO-8859-1.
- Removed ANSI/OSC terminal control sequences from the Sidebar presentation so prompts and command output are readable.
- Preserved terminal scrolling and text selection while using an invisible keyboard capture layer.

## Validation

- `npm run check` passes.
- Installed the packed v0.2.4 artifact into the local DSH Web profile.
- Started DSH Web on `http://127.0.0.1:3080` and connected to the saved SSH environment `192.168.3.94`.
- Verified direct execution of `printf DIRECT_OK` and UTF-8 Chinese output.
- Verified Tab is posted as `\t` and Ctrl+C is posted as a terminal control character.
- Browser console had no errors after the connection flow.

use std::{collections::VecDeque, sync::Mutex};

use crate::AppError;

const CAPACITY: usize = 256 * 1024;

#[derive(Default)]
pub struct TerminalBuffer {
    bytes: Mutex<VecDeque<u8>>,
}

impl TerminalBuffer {
    pub fn push(&self, chunk: &[u8]) -> Result<(), AppError> {
        let mut bytes = self
            .bytes
            .lock()
            .map_err(|_| AppError::Session("terminal buffer lock is poisoned".to_owned()))?;
        if chunk.len() >= CAPACITY {
            bytes.clear();
            bytes.extend(&chunk[chunk.len() - CAPACITY..]);
            return Ok(());
        }
        let overflow = bytes
            .len()
            .saturating_add(chunk.len())
            .saturating_sub(CAPACITY);
        bytes.drain(..overflow);
        bytes.extend(chunk);
        Ok(())
    }

    pub fn snapshot_lines(&self, count: usize) -> Result<String, AppError> {
        let bytes = self
            .bytes
            .lock()
            .map_err(|_| AppError::Session("terminal buffer lock is poisoned".to_owned()))?;
        let raw: Vec<u8> = bytes.iter().copied().collect();
        let clean = strip_escape_sequences(&raw);
        let text = String::from_utf8_lossy(&clean).replace('\r', "");
        let lines: Vec<&str> = text.lines().collect();
        let start = lines.len().saturating_sub(count);
        Ok(lines[start..].join("\n"))
    }
}

fn strip_escape_sequences(input: &[u8]) -> Vec<u8> {
    #[derive(Clone, Copy)]
    enum State {
        Text,
        Escape,
        Csi,
        Osc,
        OscEscape,
    }
    let mut output = Vec::with_capacity(input.len());
    let mut state = State::Text;
    for &byte in input {
        state = match state {
            State::Text if byte == 0x1b => State::Escape,
            State::Text => {
                output.push(byte);
                State::Text
            }
            State::Escape if byte == b'[' => State::Csi,
            State::Escape if byte == b']' => State::Osc,
            State::Escape => State::Text,
            State::Csi if (0x40..=0x7e).contains(&byte) => State::Text,
            State::Csi => State::Csi,
            State::Osc if byte == 0x07 => State::Text,
            State::Osc if byte == 0x1b => State::OscEscape,
            State::Osc => State::Osc,
            State::OscEscape if byte == b'\\' => State::Text,
            State::OscEscape => State::Osc,
        };
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{TerminalBuffer, CAPACITY};

    #[test]
    fn keeps_capacity_and_returns_recent_lines() -> Result<(), Box<dyn std::error::Error>> {
        let buffer = TerminalBuffer::default();
        buffer.push(&vec![b'x'; CAPACITY + 10])?;
        buffer.push(b"\nfirst\nsecond\nthird")?;
        assert_eq!(buffer.snapshot_lines(2)?, "second\nthird");
        Ok(())
    }

    #[test]
    fn removes_csi_and_osc_sequences() -> Result<(), Box<dyn std::error::Error>> {
        let buffer = TerminalBuffer::default();
        buffer.push(b"plain\n\x1b[31mred\x1b[0m\n\x1b]0;title\x07done\n\x1b]2;x\x1b\\tail")?;
        let snapshot = buffer.snapshot_lines(4)?;
        assert_eq!(snapshot, "plain\nred\ndone\ntail");
        assert!(!snapshot.as_bytes().contains(&0x1b));
        Ok(())
    }
}

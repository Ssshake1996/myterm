use crate::error::CoreError;

#[derive(Default)]
pub struct SseDecoder {
    pending: Vec<u8>,
    data_lines: Vec<String>,
}

impl SseDecoder {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, CoreError> {
        self.pending.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(newline) = self.pending.iter().position(|byte| *byte == b'\n') {
            let mut line = self.pending.drain(..=newline).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8(line).map_err(|error| {
                CoreError::MalformedSse(format!("SSE line is not UTF-8: {error}"))
            })?;
            self.accept_line(&line, &mut events);
        }
        Ok(events)
    }

    pub fn finish(mut self) -> Result<Vec<String>, CoreError> {
        let mut events = Vec::new();
        if !self.pending.is_empty() {
            let mut line =
                String::from_utf8(std::mem::take(&mut self.pending)).map_err(|error| {
                    CoreError::MalformedSse(format!("final SSE line is not UTF-8: {error}"))
                })?;
            if line.ends_with('\r') {
                line.pop();
            }
            self.accept_line(&line, &mut events);
        }
        self.flush_event(&mut events);
        Ok(events)
    }

    fn accept_line(&mut self, line: &str, events: &mut Vec<String>) {
        if line.is_empty() {
            self.flush_event(events);
            return;
        }
        if line.starts_with(':') {
            return;
        }
        if let Some(data) = line.strip_prefix("data:") {
            self.data_lines
                .push(data.strip_prefix(' ').unwrap_or(data).to_owned());
        }
    }

    fn flush_event(&mut self, events: &mut Vec<String>) {
        if self.data_lines.is_empty() {
            return;
        }
        events.push(self.data_lines.join("\n"));
        self.data_lines.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_split_crlf_and_multiline_data() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"data: {\"a\":").unwrap().is_empty());
        let events = decoder
            .push(b"1}\r\ndata: second\r\n\r\n")
            .expect("split event should decode");
        assert_eq!(events, vec!["{\"a\":1}\nsecond"]);
    }

    #[test]
    fn flushes_final_event_without_blank_line() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b"data: [DONE]").unwrap().is_empty());
        assert_eq!(decoder.finish().unwrap(), vec!["[DONE]"]);
    }
}

use super::types::*;
use std::collections::{HashMap, HashSet, VecDeque};
use std::{
    io::Write,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager};
#[derive(Clone, Default)]
struct PlainSink(Arc<Mutex<Vec<u8>>>);
impl Write for PlainSink {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
struct Buffer {
    data: VecDeque<u8>,
    start: u64,
    end: u64,
    ended: bool,
    parser: strip_ansi_escapes::Writer<PlainSink>,
    plain: PlainSink,
}
impl Default for Buffer {
    fn default() -> Self {
        let plain = PlainSink::default();
        Self {
            data: Default::default(),
            start: 0,
            end: 0,
            ended: false,
            parser: strip_ansi_escapes::Writer::new(plain.clone()),
            plain,
        }
    }
}
#[derive(Default)]
pub struct OutputStore {
    unavailable: HashSet<i64>,
    buffers: HashMap<i64, Buffer>,
    finished: VecDeque<i64>,
}
impl OutputStore {
    pub fn push(&mut self, id: i64, bytes: &[u8]) {
        let b = self.buffers.entry(id).or_default();
        let _ = b.parser.write_all(bytes);
        let _ = b.parser.flush();
        let plain = std::mem::take(&mut *b.plain.0.lock().unwrap());
        b.end += plain.len() as u64;
        b.data.extend(plain);
        while b.data.len() > 1024 * 1024 {
            b.data.pop_front();
            b.start += 1;
        }
        while b.data.front().is_some_and(|v| v & 0xc0 == 0x80) {
            b.data.pop_front();
            b.start += 1;
        }
        while self.buffers.values().map(|b| b.data.len()).sum::<usize>() > 64 * 1024 * 1024 {
            let Some((&key, _)) = self
                .buffers
                .iter()
                .filter(|(_, v)| !v.data.is_empty())
                .min_by_key(|(k, _)| *k)
            else {
                break;
            };
            let b = self.buffers.get_mut(&key).unwrap();
            let n = b.data.len().min(65536);
            b.data.drain(..n);
            b.start += n as u64;
        }
    }
    pub fn finish(&mut self, id: i64) {
        self.buffers.entry(id).or_default().ended = true;
        self.finished.push_back(id);
        while self.finished.len() > 20 {
            if let Some(old) = self.finished.pop_front() {
                self.buffers.remove(&old);
                self.unavailable.remove(&old);
            }
        }
    }
    pub fn read(&self, id: i64, cursor: Option<&str>, limit: usize) -> Result<McpOutputPage> {
        if self.unavailable.contains(&id) {
            return Err(McpError::new(
                "OUTPUT_UNAVAILABLE",
                "External terminal output is not captured.",
            ));
        }
        let b = self
            .buffers
            .get(&id)
            .ok_or_else(|| McpError::new("OUTPUT_UNAVAILABLE", "Output is no longer available."))?;
        let requested = match cursor {
            Some(c) => c
                .parse::<u64>()
                .map_err(|_| McpError::new("INVALID_ARGUMENT", "Invalid output cursor."))?,
            None => b.start,
        };
        if requested > b.end {
            return Err(McpError::new(
                "INVALID_ARGUMENT",
                "Output cursor is ahead of this run.",
            ));
        }
        let mut start = requested.max(b.start);
        while b
            .data
            .get((start - b.start) as usize)
            .is_some_and(|v| v & 0xc0 == 0x80)
        {
            start += 1;
        }
        let mut raw: Vec<_> = b
            .data
            .iter()
            .skip((start - b.start) as usize)
            .take(limit.clamp(4, 65536))
            .copied()
            .collect();
        while std::str::from_utf8(&raw).is_err_and(|e| e.error_len().is_none()) {
            raw.pop();
        }
        let text = String::from_utf8_lossy(&raw).into_owned();
        Ok(McpOutputPage {
            text,
            next_cursor: (start + raw.len() as u64).to_string(),
            truncated: requested < b.start,
            ended: b.ended,
        })
    }
}
pub fn start(app: &AppHandle, id: i64, available: bool) {
    if let Some(s) = app.try_state::<super::McpService>() {
        if let Ok(mut o) = s.output.lock() {
            if available {
                o.push(id, b"");
            } else {
                o.unavailable.insert(id);
            }
        }
    }
}
pub fn push(app: &AppHandle, id: i64, bytes: &[u8]) {
    if let Some(s) = app.try_state::<super::McpService>() {
        if let Ok(mut o) = s.output.lock() {
            o.push(id, bytes);
        }
    }
}
pub fn finish(app: &AppHandle, id: i64) {
    if let Some(s) = app.try_state::<super::McpService>() {
        if let Ok(mut o) = s.output.lock() {
            o.finish(id);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_cursor_and_ansi() {
        let mut s = OutputStore::default();
        s.push(1, b"\x1b[31mhello\x1b[0m");
        assert_eq!(s.read(1, None, 100).unwrap().text, "hello");
        s.push(1, &vec![b'x'; 1024 * 1024 + 10]);
        assert!(s.read(1, Some("0"), 30).unwrap().truncated);
        assert!(s.read(1, Some("999999999"), 10).is_err());
    }
    #[test]
    fn completed_eviction() {
        let mut s = OutputStore::default();
        for i in 0..21 {
            s.push(i, b"x");
            s.finish(i);
        }
        assert!(s.read(0, None, 1).is_err());
    }
    #[test]
    fn split_ansi_and_utf8_keep_cursor_stable() {
        let mut s = OutputStore::default();
        s.push(1, b"\x1b[3");
        s.push(1, b"1mhello \xe2\x82");
        let first = s.read(1, None, 100).unwrap();
        assert_eq!(first.text, "hello ");
        s.push(1, b"\xac\x1b[0m!");
        let next = s.read(1, Some(&first.next_cursor), 100).unwrap();
        assert_eq!(next.text, "€!");
        assert_eq!(s.read(1, Some(&next.next_cursor), 100).unwrap().text, "");
    }
}

//! The server peer's recent log, kept in memory (the last 300 lines) as well as printed — so the admin can read what
//! the server saw (`GET /vault/log` with the app's key) without SSH.

use std::{
    collections::VecDeque,
    io::Write,
    sync::{Arc, Mutex},
};

const KEEP: usize = 300;

#[derive(Clone, Default)]
pub struct Ring(Arc<Mutex<VecDeque<String>>>);

impl Ring {
    pub fn lines(&self) -> Vec<String> {
        self.0.lock().unwrap().iter().cloned().collect()
    }
}

pub struct Tee {
    ring: Ring,
    line: Vec<u8>,
}

impl Write for Tee {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        std::io::stdout().write_all(buf)?;
        for &b in buf {
            if b == b'\n' {
                let s = String::from_utf8_lossy(&self.line).into_owned();
                let mut q = self.ring.0.lock().unwrap();
                q.push_back(s);
                while q.len() > KEEP {
                    q.pop_front();
                }
                self.line.clear();
            } else {
                self.line.push(b);
            }
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        std::io::stdout().flush()
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Ring {
    type Writer = Tee;
    fn make_writer(&'a self) -> Self::Writer {
        Tee { ring: self.clone(), line: Vec::new() }
    }
}

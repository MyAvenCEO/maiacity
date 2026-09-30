//! The film's sound, as worker.ts mixes it — every audio clip from where it is trimmed, through its EQ (`eq`), at its
//! volume, with its own fades (or a short one at both ends), placed on the film's clock to the millisecond; voice (A1), music (A2) and
//! sounds (A3, any other) summed apart; the voice keying the music down about 6 dB while it speaks (ffmpeg's
//! `sidechaincompress=threshold=0.02:ratio=4:knee=4:attack=120:release=900`, ported); the three summed — and then,
//! where the worker only measured, levelled to a loudness target (integrated LUFS, true-peak ceiling) by one gain
//! and a look-ahead limiter. Streamed in 100 ms blocks; the mix goes to disk, never into memory.
//!
//! Two passes over the clips' files: the mix measured (BS.1770), then the same mix levelled into a float WAV the
//! encoders read.

use std::{
    collections::VecDeque,
    fs::File,
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::Serialize;

use crate::{
    av::{AudioReader, RATE},
    loudness::{Loudness, Meter},
    timeline::Clip,
};

/// A loudness to level the film to.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Target {
    /// integrated loudness, LUFS
    pub lufs: f64,
    /// the ceiling for the true peak, dBTP
    #[serde(rename = "truePeak")]
    pub true_peak: f64,
}

/// What the platforms normalise to (YouTube, Instagram, TikTok play at about −14 LUFS; −1 dBTP leaves room for their
/// AAC encoders).
pub const PLATFORMS: Target = Target { lufs: -14.0, true_peak: -1.0 };

/// An audio clip and the file it plays.
#[derive(Debug, Clone)]
pub struct AudioClip {
    pub clip: Clip,
    /// on disk, or a blob read in place
    pub file: vault_media::Source,
}

#[derive(Debug, Clone, Serialize)]
pub struct Sound {
    /// the levelled mix: 48 kHz stereo float WAV, the film's exact length
    #[serde(skip)]
    pub wav: PathBuf,
    pub seconds: f64,
    /// the mix as it came out, before levelling
    pub mixed: Loudness,
    /// the gain taken to reach the target, dB
    pub gain_db: f64,
    /// the levelled mix
    pub levelled: Loudness,
    pub target: Option<Target>,
    /// how many clips went into each bus
    pub voice: usize,
    pub music: usize,
    pub fx: usize,
}

/// 100 ms at 48 kHz.
const BLOCK: usize = 4800;

/// One clip's sound, read ahead just enough for the block being mixed.
struct Voice {
    clip: Clip,
    file: vault_media::Source,
    /// where it starts on the film, in samples (adelay: to the millisecond)
    at: u64,
    /// how long it plays, in samples
    len: u64,
    gain: f64,
    eq: crate::eq::Eq,
    fin: u64,
    fout: u64,
    reader: Option<AudioReader>,
    /// decoded stereo frames not yet mixed, the first being sample `next` of the clip
    queue: VecDeque<f32>,
    next: u64,
    /// the first chunk's start in the file seen (a file whose sound starts after `in` is padded)
    started: bool,
    ended: bool,
}

impl Voice {
    fn new(a: &AudioClip) -> Self {
        let c = &a.clip;
        let rate = RATE as f64;
        let auto = (if c.track == "A1" { 0.05f64 } else { 0.8 }).min(c.dur / 3.0);
        let fin = c.fin.unwrap_or(auto).min(c.dur / 2.0).max(0.005);
        let fout = c.fout.unwrap_or(auto).min(c.dur / 2.0).max(0.005);
        let ms = (c.start * 1000.0).round().max(0.0);
        Self {
            clip: c.clone(),
            file: a.file.clone(),
            at: (ms / 1000.0 * rate).round() as u64,
            len: (c.dur * rate).round().max(0.0) as u64,
            gain: c.vol,
            eq: crate::eq::Eq::new(&c.eq(), rate),
            fin: (fin * rate).round().max(1.0) as u64,
            fout: (fout * rate).round().max(1.0) as u64,
            reader: None,
            queue: VecDeque::new(),
            next: 0,
            started: false,
            ended: false,
        }
    }

    /// The fade's gain at sample `i` of the clip (ffmpeg afade's default: a straight line).
    fn envelope(&self, i: u64) -> f64 {
        let mut g = self.gain;
        if i < self.fin {
            g *= i as f64 / self.fin as f64;
        }
        let out_from = self.len.saturating_sub(self.fout);
        if i >= out_from {
            g *= (self.len - i) as f64 / self.fout as f64;
        }
        g
    }

    /// Add this clip into `bus` (stereo frames of the block starting at film sample `from`).
    fn mix_into(&mut self, bus: &mut [f32], from: u64) -> Result<()> {
        let frames = bus.len() as u64 / 2;
        let (lo, hi) = (self.at.max(from), (self.at + self.len).min(from + frames));
        if lo >= hi {
            return Ok(());
        }
        if self.reader.is_none() && !self.ended {
            let c = &self.clip;
            self.reader = AudioReader::open(&self.file, c.in_, c.in_ + c.dur).with_context(|| format!("the sound of {}", self.file))?;
            if self.reader.is_none() {
                self.ended = true;
            }
        }
        // the clip's samples lo−at … hi−at
        let (first, last) = (lo - self.at, hi - self.at);
        // skip what fell before this block (a clip entering mid-way, which never happens after the first block)
        while self.next < first {
            if !self.fill()? {
                return Ok(());
            }
            let drop = ((first - self.next) as usize * 2).min(self.queue.len());
            self.queue.drain(..drop);
            self.next += drop as u64 / 2;
        }
        for i in first..last {
            if self.queue.len() < 2 && !self.fill()? {
                break;
            }
            let (l, r) = self.eq.frame(self.queue.pop_front().unwrap(), self.queue.pop_front().unwrap());
            let g = self.envelope(i) as f32;
            let k = ((self.at + i - from) * 2) as usize;
            bus[k] += l * g;
            bus[k + 1] += r * g;
            self.next = i + 1;
        }
        if self.next >= self.len {
            self.reader = None;
            self.ended = true;
        }
        Ok(())
    }

    /// More decoded sound into the queue; false when there is none.
    fn fill(&mut self) -> Result<bool> {
        let Some(reader) = self.reader.as_mut() else { return Ok(false) };
        match reader.next_chunk()? {
            Some((t, frames)) => {
                let in_ = self.clip.in_;
                let mut frames = frames;
                if !self.started {
                    self.started = true;
                    let offset = ((t - in_) * RATE as f64).round() as i64;
                    if offset < 0 {
                        // the first chunk starts before the in point: from the in point
                        let skip = ((-offset) as usize * 2).min(frames.len());
                        frames.drain(..skip);
                    } else if offset > 0 {
                        // the file's sound starts later: silence until it does
                        self.queue.extend(std::iter::repeat_n(0.0, offset as usize * 2));
                    }
                }
                self.queue.extend(frames);
                Ok(true)
            }
            None => {
                self.reader = None;
                Ok(false)
            }
        }
    }
}

/// ffmpeg's `sidechaincompress` (af_sidechaincompress.c) with the worker's settings: RMS detection, the key's
/// channels averaged, downward, threshold 0.02, ratio 4, knee 4, attack 120 ms, release 900 ms, makeup 1.
struct Ducker {
    lin_slope: f64,
    thres: f64,
    ratio: f64,
    knee: f64,
    knee_start: f64,
    knee_stop: f64,
    compressed_knee_stop: f64,
    adj_knee_start: f64,
    attack: f64,
    release: f64,
}

impl Ducker {
    fn new() -> Self {
        let (threshold, ratio, knee, attack, release) = (0.02f64, 4.0f64, 4.0f64, 120.0f64, 900.0f64);
        let lin_knee_start = threshold / knee.sqrt();
        let lin_knee_stop = threshold * knee.sqrt();
        let thres = threshold.ln();
        let knee_start = lin_knee_start.ln();
        let knee_stop = lin_knee_stop.ln();
        Self {
            lin_slope: 0.0,
            thres,
            ratio,
            knee,
            knee_start,
            knee_stop,
            compressed_knee_stop: (knee_stop - thres) / ratio + thres,
            adj_knee_start: lin_knee_start * lin_knee_start,
            attack: (1.0f64).min(1.0 / (attack * RATE as f64 / 4000.0)),
            release: (1.0f64).min(1.0 / (release * RATE as f64 / 4000.0)),
        }
    }

    fn gain(&self, lin_slope: f64) -> f64 {
        let slope = lin_slope.ln() * 0.5; // RMS detection
        let mut gain = (slope - self.thres) / self.ratio + self.thres;
        let delta = 1.0 / self.ratio;
        if self.knee > 1.0 && slope < self.knee_stop {
            // hermite_interpolation(slope, knee_start, knee_stop, knee_start, compressed_knee_stop, 1, delta)
            let (x0, x1, p0, p1) = (self.knee_start, self.knee_stop, self.knee_start, self.compressed_knee_stop);
            let width = x1 - x0;
            let t = (slope - x0) / width;
            let (m0, m1) = (width, delta * width);
            let (t2, t3) = (t * t, t * t * t);
            let ct2 = -3.0 * p0 - 2.0 * m0 + 3.0 * p1 - m1;
            let ct3 = 2.0 * p0 + m0 - 2.0 * p1 + m1;
            gain = ct3 * t3 + ct2 * t2 + m0 * t + p0;
        }
        (gain - slope).exp()
    }

    /// Duck `music` in place by `key` (both stereo frames of one block).
    fn run(&mut self, music: &mut [f32], key: &[f32]) {
        for (m, k) in music.as_chunks_mut::<2>().0.iter_mut().zip(key.as_chunks::<2>().0) {
            let abs = (k[0].abs() as f64 + k[1].abs() as f64) / 2.0;
            let abs = abs * abs;
            let coeff = if abs > self.lin_slope { self.attack } else { self.release };
            self.lin_slope += (abs - self.lin_slope) * coeff;
            let mut g = 1.0;
            if self.lin_slope > 0.0 && self.lin_slope > self.adj_knee_start {
                g = self.gain(self.lin_slope);
            }
            m[0] = (m[0] as f64 * g) as f32;
            m[1] = (m[1] as f64 * g) as f32;
        }
    }
}

/// The mix itself, block by block, into `sink`.
fn mix_pass(clips: &[AudioClip], total_frames: u64, sink: &mut dyn FnMut(&[f32]) -> Result<()>, progress: &mut dyn FnMut(f64)) -> Result<(usize, usize, usize)> {
    let bus_of = |c: &Clip| match c.track.as_str() {
        "A1" => 0,
        "A2" => 1,
        _ => 2,
    };
    let mut voices: Vec<(usize, Voice)> = clips.iter().map(|a| (bus_of(&a.clip), Voice::new(a))).collect();
    let counts = (0..3).map(|b| voices.iter().filter(|(x, _)| *x == b).count()).collect::<Vec<_>>();
    let duck = counts[0] > 0 && counts[1] > 0;
    let mut ducker = Ducker::new();
    let mut buses = [vec![0f32; BLOCK * 2], vec![0f32; BLOCK * 2], vec![0f32; BLOCK * 2]];
    let mut from = 0u64;
    while from < total_frames {
        let n = (total_frames - from).min(BLOCK as u64) as usize;
        for b in buses.iter_mut() {
            b.iter_mut().for_each(|x| *x = 0.0);
            b.truncate(n * 2);
            b.resize(n * 2, 0.0);
        }
        for (bus, v) in voices.iter_mut() {
            if !v.ended {
                v.mix_into(&mut buses[*bus], from)?;
            }
        }
        let [voice, music, fx] = &mut buses;
        if duck {
            ducker.run(music, voice);
        }
        for i in 0..n * 2 {
            fx[i] += voice[i] + music[i];
        }
        sink(fx)?;
        from += n as u64;
        progress(from as f64 / total_frames as f64);
    }
    Ok((counts[0], counts[1], counts[2]))
}

/// A look-ahead peak limiter: a gain that is the minimum of what each sample needs over the look-ahead window,
/// released exponentially and smoothed by a moving average as long as the window — so it is down to what a peak
/// needs when the peak arrives, without a click. Latency compensated: sample in, sample out.
struct Limiter {
    ceiling: f64,
    look: usize,
    release: f64,
    need: VecDeque<(u64, f64)>,
    held: f64,
    avg: VecDeque<f64>,
    sum: f64,
    delay: VecDeque<[f32; 2]>,
    n: u64,
}

impl Limiter {
    fn new(ceiling: f64) -> Self {
        let look = (0.005 * RATE as f64) as usize; // 5 ms, alimiter's attack
        Self {
            ceiling,
            look,
            release: 1.0 - (-1.0 / (0.05 * RATE as f64)).exp(), // 50 ms, alimiter's release
            need: VecDeque::new(),
            held: 1.0,
            avg: VecDeque::new(),
            sum: 0.0,
            delay: VecDeque::new(),
            n: 0,
        }
    }

    /// One frame in; one frame out once the look-ahead is full.
    fn push(&mut self, f: [f32; 2]) -> Option<[f32; 2]> {
        let peak = f[0].abs().max(f[1].abs()) as f64;
        let r = if peak > self.ceiling { self.ceiling / peak } else { 1.0 };
        // sliding minimum of r over the last `look` frames
        while self.need.back().is_some_and(|&(_, v)| v >= r) {
            self.need.pop_back();
        }
        self.need.push_back((self.n, r));
        while self.need.front().is_some_and(|&(i, _)| i + self.look as u64 <= self.n) {
            self.need.pop_front();
        }
        let m = self.need.front().unwrap().1;
        // down at once, back up slowly
        self.held = if m < self.held { m } else { self.held + (m - self.held) * self.release };
        self.avg.push_back(self.held);
        self.sum += self.held;
        if self.avg.len() > self.look {
            self.sum -= self.avg.pop_front().unwrap();
        }
        self.delay.push_back(f);
        self.n += 1;
        if self.delay.len() < self.look {
            return None;
        }
        let g = (self.sum / self.avg.len() as f64) as f32;
        let x = self.delay.pop_front().unwrap();
        Some([x[0] * g, x[1] * g])
    }
}

fn wav_header(frames: u64) -> Vec<u8> {
    let data = frames * 8;
    let mut h = Vec::with_capacity(58);
    h.extend(b"RIFF");
    h.extend(((4 + 26 + 12 + 8 + data) as u32).to_le_bytes());
    h.extend(b"WAVE");
    h.extend(b"fmt ");
    h.extend(18u32.to_le_bytes());
    h.extend(3u16.to_le_bytes()); // IEEE float
    h.extend(2u16.to_le_bytes());
    h.extend(RATE.to_le_bytes());
    h.extend((RATE * 8).to_le_bytes());
    h.extend(8u16.to_le_bytes());
    h.extend(32u16.to_le_bytes());
    h.extend(0u16.to_le_bytes());
    h.extend(b"fact");
    h.extend(4u32.to_le_bytes());
    h.extend((frames as u32).to_le_bytes());
    h.extend(b"data");
    h.extend((data as u32).to_le_bytes());
    h
}

/// Write interleaved stereo float frames at 48 kHz as a WAV.
pub fn write_wav(path: &Path, frames: &[f32]) -> Result<()> {
    let mut out = BufWriter::new(File::create(path)?);
    out.write_all(&wav_header(frames.len() as u64 / 2))?;
    for x in frames {
        out.write_all(&x.to_le_bytes())?;
    }
    out.flush()?;
    Ok(())
}

/// Mix the timeline's sound into `work`/mix.wav, `seconds` long, levelled to `target` (None: as the worker left it —
/// its limiter at 0.95, auto-levelled back to 0 dBFS).
pub fn mix(clips: &[AudioClip], seconds: f64, target: Option<Target>, work: &Path, progress: &mut dyn FnMut(f64)) -> Result<Sound> {
    std::fs::create_dir_all(work)?;
    let frames = (seconds * RATE as f64).round() as u64;
    // pass 1: the raw mix, measured, to disk
    let raw_path = work.join("mix.raw");
    let mut meter = Meter::new(RATE, 2);
    let (voice, music, fx) = {
        let mut raw = BufWriter::with_capacity(1 << 20, File::create(&raw_path)?);
        let r = mix_pass(
            clips,
            frames,
            &mut |b| {
                meter.push(b);
                for x in b {
                    raw.write_all(&x.to_le_bytes())?;
                }
                Ok(())
            },
            &mut |p| progress(0.5 * p),
        )?;
        raw.flush()?;
        r
    };
    let mixed = meter.result();
    // pass 2: one gain to the target, then the limiter under the ceiling
    let (gain_db, ceiling, after) = match (target, mixed.lufs) {
        (Some(t), Some(l)) => (t.lufs - l, 10f64.powf((t.true_peak - 0.5) / 20.0), 1.0),
        (Some(t), None) => (0.0, 10f64.powf((t.true_peak - 0.5) / 20.0), 1.0),
        (None, _) => (0.0, 0.95, 1.0 / 0.95),
    };
    let gain = 10f64.powf(gain_db / 20.0);
    let wav = work.join("mix.wav");
    let mut out = BufWriter::with_capacity(1 << 20, File::create(&wav)?);
    out.write_all(&wav_header(frames))?;
    let mut meter = Meter::new(RATE, 2);
    let mut lim = Limiter::new(ceiling);
    let mut raw = BufReader::with_capacity(1 << 20, File::open(&raw_path)?);
    let mut buf = vec![0u8; BLOCK * 8];
    let mut block: Vec<f32> = Vec::with_capacity(BLOCK * 2);
    let emit = |f: [f32; 2], block: &mut Vec<f32>| {
        block.push((f[0] as f64 * after) as f32);
        block.push((f[1] as f64 * after) as f32);
    };
    let (mut done, mut emitted) = (0u64, 0u64);
    while done < frames {
        let n = ((frames - done) as usize).min(BLOCK);
        raw.read_exact(&mut buf[..n * 8])?;
        block.clear();
        for i in 0..n {
            let l = f32::from_le_bytes(buf[i * 8..i * 8 + 4].try_into()?) as f64 * gain;
            let r = f32::from_le_bytes(buf[i * 8 + 4..i * 8 + 8].try_into()?) as f64 * gain;
            if let Some(o) = lim.push([l as f32, r as f32]) {
                emit(o, &mut block);
                emitted += 1;
            }
        }
        done += n as u64;
        // the look-ahead's last frames, pushed out by silence
        while done == frames && emitted < frames {
            if let Some(o) = lim.push([0.0, 0.0]) {
                emit(o, &mut block);
                emitted += 1;
            }
        }
        meter.push(&block);
        for x in &block {
            out.write_all(&x.to_le_bytes())?;
        }
        progress(0.5 + 0.5 * done as f64 / frames as f64);
    }
    out.flush()?;
    drop(out);
    let _ = std::fs::remove_file(&raw_path);
    Ok(Sound { wav, seconds, mixed, gain_db, levelled: meter.result(), target, voice, music, fx })
}

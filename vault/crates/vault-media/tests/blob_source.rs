//! AVFoundation reading a file in place from a byte source (`vaultblob://`, the resource loader) reads exactly what
//! it reads from the same file by path: the same samples, the same probe, the same proxy.

use std::{
    io,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Instant,
};

use vault_media::{ByteSource, FileSource, FrameWriter, Source, audio::decode_mono, make_proxy, probe};

/// Bytes in memory, counting what was read of them — so a test knows the loader, not a path, was read.
struct Counted {
    bytes: Vec<u8>,
    read: AtomicU64,
    calls: AtomicU64,
}

impl Counted {
    fn new(bytes: Vec<u8>) -> Arc<Self> {
        Arc::new(Self { bytes, read: AtomicU64::new(0), calls: AtomicU64::new(0) })
    }
}

impl ByteSource for Counted {
    fn len(&self) -> u64 {
        self.bytes.len() as u64
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.bytes.read_at(offset, buf)?;
        self.read.fetch_add(n as u64, Ordering::Relaxed);
        self.calls.fetch_add(1, Ordering::Relaxed);
        Ok(n)
    }
}

/// A source whose reads fail: the asset must fail, not hang.
struct Broken(u64);

impl ByteSource for Broken {
    fn len(&self) -> u64 {
        self.0
    }
    fn read_at(&self, _offset: u64, _buf: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("the blob is gone"))
    }
}

fn dir(test: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("vault-media-blob-{test}-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Two seconds of stereo 16-bit PCM at 44.1 kHz: two tones and a sweep, deterministic.
fn wav(path: &Path) {
    let (rate, secs, ch) = (44_100u32, 2u32, 2u16);
    let n = rate * secs;
    let mut data = Vec::with_capacity(n as usize * 4);
    for i in 0..n {
        let t = i as f32 / rate as f32;
        let l = 0.4 * (2.0 * std::f32::consts::PI * 440.0 * t).sin() + 0.1 * (2.0 * std::f32::consts::PI * (200.0 + 800.0 * t) * t).sin();
        let r = 0.3 * (2.0 * std::f32::consts::PI * 660.0 * t).sin();
        for v in [l, r] {
            data.extend_from_slice(&((v * 32767.0) as i16).to_le_bytes());
        }
    }
    let mut b = Vec::new();
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&ch.to_le_bytes());
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * ch as u32 * 2).to_le_bytes());
    b.extend_from_slice(&(ch * 2).to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&(data.len() as u32).to_le_bytes());
    b.extend_from_slice(&data);
    std::fs::write(path, b).unwrap();
}

/// The same sound as AAC in an .m4a — macOS's own `afconvert` (part of the system, nothing to install).
fn m4a(wav: &Path, out: &Path) {
    let ok = std::process::Command::new("/usr/bin/afconvert").args(["-f", "m4af", "-d", "aac", "-b", "128000"]).arg(wav).arg(out).status().unwrap();
    assert!(ok.success(), "afconvert failed");
}

/// A small HEVC movie (FrameWriter: 12 frames at 30 fps, tagged with our comment).
fn movie(out: &Path) {
    let (w, h) = (320usize, 180usize);
    let mut writer = FrameWriter::create(out, w as u32, h as u32, 30.0).unwrap();
    let mut frame = vec![0u8; w * h * 4];
    for k in 0..12 {
        for (i, px) in frame.chunks_exact_mut(4).enumerate() {
            let v = (((i % w) * 1023 / w + k * 8) % 1024) as u32;
            px.copy_from_slice(&(v | (v << 10) | (v << 20)).to_le_bytes());
        }
        writer.push(&frame).unwrap();
    }
    writer.finish().unwrap();
}

fn blob_of(path: &Path) -> (Arc<Counted>, Source) {
    let bytes = Counted::new(std::fs::read(path).unwrap());
    let name = format!("0123abcd.{}", path.extension().unwrap().to_string_lossy());
    (bytes.clone(), Source::blob(bytes, name))
}

#[test]
fn sound_decodes_the_same_by_blob_as_by_path() {
    let d = dir("sound");
    let (w, a) = (d.join("tone.wav"), d.join("tone.m4a"));
    wav(&w);
    m4a(&w, &a);
    for file in [&w, &a] {
        let by_path = decode_mono(file, 16_000, &mut |_| {}).unwrap().expect("a sound track");
        let (counted, src) = blob_of(file);
        let mut last = 0.0;
        let by_blob = decode_mono(&src, 16_000, &mut |p| last = p).unwrap().expect("a sound track by blob");
        assert!(by_path.len() > 30_000, "{}: {} samples", file.display(), by_path.len());
        assert_eq!(by_path.len(), by_blob.len(), "{}", file.display());
        assert!(by_path.iter().zip(&by_blob).all(|(a, b)| a.to_bits() == b.to_bits()), "{}: samples differ", file.display());
        assert_eq!(last, 1.0);
        let read = counted.read.load(Ordering::Relaxed);
        assert!(read >= counted.bytes.len() as u64 / 2, "{}: only {read} bytes read through the loader", file.display());
        eprintln!("{}: {} samples, {} bytes in {} reads", file.display(), by_blob.len(), read, counted.calls.load(Ordering::Relaxed));
    }
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn a_movie_probes_and_proxies_the_same_by_blob_as_by_path() {
    let d = dir("movie");
    std::fs::create_dir_all(&d).unwrap();
    let mov = d.join("ramp.mp4");
    movie(&mov);
    let (_, src) = blob_of(&mov);
    let (a, b) = (probe(&mov).unwrap(), probe(&src).unwrap());
    assert_eq!(serde_json::to_value(&a).unwrap(), serde_json::to_value(&b).unwrap());
    assert_eq!((b.codec.as_str(), b.frames, b.width, b.height), ("hvc1", 12, 320, 180));
    assert!(b.tags.iter().any(|t| t == "comment=maiacity:color=acescct"), "{:?}", b.tags);

    // the whole proxy path: frames decoded through the loader, graded, encoded
    let (pa, pb) = (d.join("by-path.mp4"), d.join("by-blob.mp4"));
    let ma = make_proxy(&mov, &pa, "acescct", &mut |_| {}).unwrap();
    let mb = make_proxy(&src, &pb, "acescct", &mut |_| {}).unwrap();
    assert_eq!((ma.width, ma.height, ma.seconds), (mb.width, mb.height, mb.seconds));
    assert_eq!(probe(&pa).unwrap().frames, 12);
    assert_eq!(probe(&pb).unwrap().frames, 12);
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn a_broken_source_fails_and_does_not_hang() {
    let src = Source::blob(Arc::new(Broken(1 << 20)), "gone.m4a");
    let started = Instant::now();
    let r = decode_mono(&src, 16_000, &mut |_| {});
    assert!(r.is_err() || r.as_ref().unwrap().is_none(), "{r:?}");
    assert!(started.elapsed().as_secs() < 20);
}

#[test]
fn the_content_types_are_apples() {
    use vault_media::blob_asset::uti_for;
    assert_eq!(uti_for("MOV"), "com.apple.quicktime-movie");
    assert_eq!(uti_for("mp4"), "public.mpeg-4");
    assert_eq!(uti_for("m4a"), "com.apple.m4a-audio");
    assert_eq!(uti_for("mp3"), "public.mp3");
    assert_eq!(uti_for("wav"), "com.microsoft.waveform-audio");
}

/// Throughput, by hand: `BLOB_BENCH=/path/to/big.mov cargo test -p vault-media --release --test blob_source -- --ignored --nocapture`
#[test]
#[ignore]
fn throughput() {
    let Ok(file) = std::env::var("BLOB_BENCH") else { return };
    let file = PathBuf::from(file);
    let size = std::fs::metadata(&file).unwrap().len() as f64 / 1e6;
    let name = format!("bench.{}", file.extension().unwrap().to_string_lossy());
    // warm the page cache first, so neither side pays for the disk alone
    let _ = std::fs::read(&file).unwrap();
    let counted = || Arc::new(Metered { inner: FileSource::open(&file).unwrap(), read: AtomicU64::new(0) });
    let t = Instant::now();
    let a = decode_mono(&file, 16_000, &mut |_| {}).unwrap().unwrap();
    let path_s = t.elapsed().as_secs_f64();
    let m = counted();
    let t = Instant::now();
    let b = decode_mono(Source::blob(m.clone(), name.clone()), 16_000, &mut |_| {}).unwrap().unwrap();
    let blob_s = t.elapsed().as_secs_f64();
    assert_eq!(a.len(), b.len());
    eprintln!(
        "{size:.0} MB, sound: by path {path_s:.2} s, by blob {blob_s:.2} s ({:.0} MB read through the loader), RSS {:.0} MB",
        m.read.load(Ordering::Relaxed) as f64 / 1e6,
        rss_mb()
    );
    let t = Instant::now();
    let pa = probe(&file).unwrap();
    let pp = t.elapsed().as_secs_f64();
    let t = Instant::now();
    let pb = probe(Source::blob(counted(), name.clone())).unwrap();
    eprintln!("probe: by path {:.3} s, by blob {:.3} s ({} frames)", pp, t.elapsed().as_secs_f64(), pb.frames);
    assert_eq!(pa.frames, pb.frames);
    if std::env::var("BLOB_BENCH_PROXY").is_ok() {
        let out = std::env::temp_dir().join(format!("bench-proxy-{}.mp4", std::process::id()));
        let side = std::env::var("BLOB_BENCH_PROXY").unwrap();
        let t = Instant::now();
        if side != "blob" {
            make_proxy(&file, &out, "rec709", &mut |_| {}).unwrap();
        }
        let path_s = t.elapsed().as_secs_f64();
        let m = counted();
        let t = Instant::now();
        if side != "path" {
            make_proxy(Source::blob(m.clone(), name), &out, "rec709", &mut |_| {}).unwrap();
        }
        let blob_s = t.elapsed().as_secs_f64();
        std::fs::remove_file(&out).ok();
        eprintln!(
            "proxy: by path {path_s:.2} s ({:.0} MB/s), by blob {blob_s:.2} s ({:.0} MB/s, {:.0} MB read), RSS {:.0} MB",
            size / path_s,
            size / blob_s,
            m.read.load(Ordering::Relaxed) as f64 / 1e6,
            rss_mb()
        );
    }
}

struct Metered {
    inner: FileSource,
    read: AtomicU64,
}

impl ByteSource for Metered {
    fn len(&self) -> u64 {
        self.inner.len()
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read_at(offset, buf)?;
        self.read.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

fn rss_mb() -> f64 {
    let out = std::process::Command::new("/bin/ps").args(["-o", "rss=", "-p", &std::process::id().to_string()]).output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().parse::<f64>().unwrap_or(0.0) / 1024.0
}

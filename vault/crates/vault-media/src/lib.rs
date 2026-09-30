//! Native media on macOS — the studio's replacement for ffprobe and ffmpeg. Apple's own frameworks from Rust:
//! AVFoundation reads and writes MOV/MP4, VideoToolbox encodes and decodes in hardware (H.264, HEVC, ProRes —
//! the iPhone's Apple Log 2 included), Core Image and Metal scale and transform colour. Nothing to install.

pub mod color;
pub mod cst;
pub mod frames;
pub mod gpu;
pub mod mp4;
pub mod probe;
pub mod proxy;

pub use color::{ColorInfo, detect};
pub use frames::FrameWriter;
pub use probe::{Probe, probe};
pub use proxy::{Proxy, make_proxy, proxy_size};

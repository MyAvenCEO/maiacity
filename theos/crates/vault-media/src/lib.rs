//! Native media on macOS — the studio's replacement for ffprobe and ffmpeg. Apple's own frameworks from Rust:
//! AVFoundation reads and writes MOV/MP4, VideoToolbox encodes and decodes in hardware (H.264, HEVC, ProRes —
//! the iPhone's Apple Log 2 included), Core Image and Metal scale and transform colour. Nothing to install.

pub mod audio;
pub mod blob_asset;
pub mod color;
pub mod frames;
pub mod gpu;
pub mod mp4;
pub mod probe;
pub mod proxy;
pub mod source;
pub mod still;
pub mod timecode;

/// The colour maths live in their own platform-free crate (the vault server needs them too); here under their old names.
pub use vault_color::{aces2, cst};

pub use color::{ColorInfo, detect};
pub use frames::FrameWriter;
pub use probe::{Probe, probe};
pub use proxy::{Proxy, make_proxy, proxy_size};
pub use source::{ByteSource, FileSource, Source};

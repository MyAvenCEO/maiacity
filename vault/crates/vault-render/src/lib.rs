//! The final film render, native on the Mac — the render worker (scripts/film/worker.ts: bun, ffmpeg, OCIO LUTs,
//! Chrome for the captions) done with Apple's own frameworks from Rust. Nothing to install.
//!
//!   picture  every delivery shape composited on the film's clock (`timeline::pieces`, as the worker cuts it): each
//!            frame read by AVAssetReader (originals, never proxies; a world clip's ACEScct plate; a still held),
//!            then on the GPU in one Core Image graph with no colour management — its journey into ACEScct
//!            (`vault_media::cst::METAL_KERNEL`), framing, the clip's CDL, the film's look, the output transform (a 3D
//!            LUT, `output::Output`), fades — and rendered into VideoToolbox's buffer: 4K HEVC Main10 master + its
//!            1080 H.264 copy in one pass for 16:9, 1080 H.264 for 9:16, 1:1, 4:5.
//!   captions Core Text (Fraunces 460, the worker's CSS) drawn over the display-referred picture; the hook the same.
//!   sound    the worker's mix ported (fades, voice ducking the music, the sum) in 100 ms blocks to disk, measured
//!            (BS.1770 / EBU R 128 in Rust, `loudness`) and levelled to a target, AAC in every file.
//!   report   QC (qc.mjs natively), loudness of each delivered file, every transform by hash — the worker's JSON.
//!
//! Entry points: `render::render` (a timeline into its deliveries), `render::hero_frame` (the `frame` job),
//! `Render::about` / `Render::job_result` (what goes into the vault and back to the API).

pub mod av;
pub mod captions;
pub mod gpu;
pub mod grade;
pub mod loudness;
pub mod output;
pub mod qc;
pub mod render;
pub mod sound;
pub mod timeline;

pub use output::{Lut3d, Output};
pub use render::{Delivery, Library, Media, Options, Plate, Render, hero_frame, render};
pub use sound::{PLATFORMS, Target};
pub use timeline::{Clip, Shape, Timeline};

//! The pieces of a picture's analysis the `analysis` rule takes (aven.rs `analysis`): its frames sampled here natively
//! (read in place, through the ACES 2.0 output transform, JPEGs in memory: `frames`), sent in stretches with the words
//! said in each to our server (`prem`: `POST /api/analysis`), which asks Prem's confidential Qwen with its own key — the
//! prompt, the vocabulary and the validation are the server's; no LLM key is on a Mac. Map, then reduce: each stretch
//! described on its own, then one text-only request over every answer groups takes, writes the file's tags and summary
//! and picks the hero frame (`plan`: merge, finish, thumbnail_time — pure, tested). The vocabulary is
//! game/film/vocabulary.json.

pub mod frames;
pub mod plan;
pub mod prem;

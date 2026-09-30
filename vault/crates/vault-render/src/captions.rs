//! Captions set by Core Text, as the worker's Chrome page set them (worker.ts `captionImages`): Fraunces at weight
//! 460, white, centred between 9 % margins, the last line's box `bottom` above the frame's foot (22 % in a portrait
//! frame, 8.5 % otherwise), font size W/30 (portrait) or min(W, H)/24, line height 1.3, and the two text shadows
//! `0 2px 18px rgba(0,0,0,.65), 0 0 3px rgba(0,0,0,.45)`. Drawn into a band at the foot of the frame (premultiplied
//! RGBA, display code values) that Core Image lays over the picture after the output transform.

use std::ffi::c_void;

use anyhow::{Context, Result};
use objc2_core_foundation::{CFAttributedString, CFData, CFDictionary, CFNumber, CFRange, CFRetained, CFString, CFType, CGFloat, CGSize};
use objc2_core_graphics::{CGBitmapContextCreate, CGBitmapContextCreateImage, CGColor, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo};
use objc2_core_text::{
    CTFont, CTFontDescriptor, CTFontManagerCreateFontDescriptorFromData, CTLine, CTTypesetter, kCTFontAttributeName,
    kCTForegroundColorAttributeName,
};

/// The worker's caption face (Fraunces, SIL Open Font License: assets/fraunces-OFL.txt).
pub const FRAUNCES: &[u8] = include_bytes!("../assets/fraunces-latin-wght-normal.woff2");
/// The CSS weight the worker set.
pub const WEIGHT: f64 = 460.0;

pub struct Captions {
    face: CFRetained<CTFontDescriptor>,
    pub face_name: String,
}

/// A caption drawn: the band at the foot of the frame, `height` pixels high.
pub struct Band {
    pub image: CFRetained<CGImage>,
    pub height: u32,
}

impl Captions {
    /// The face from font data (a TTF, OTF, WOFF or WOFF2); None: the worker's Fraunces. Falls back to Georgia (the
    /// worker's CSS fallback) when the data cannot be read.
    pub fn new(font: Option<&[u8]>) -> Result<Self> {
        let data = CFData::from_bytes(font.unwrap_or(FRAUNCES));
        // SAFETY: Core Text calls on objects we own
        unsafe {
            if let Some(d) = CTFontManagerCreateFontDescriptorFromData(&data) {
                let wght = CFNumber::new_i32(i32::from_be_bytes(*b"wght"));
                let face = d.copy_with_variation(&wght, WEIGHT as CGFloat);
                return Ok(Self { face, face_name: "Fraunces".into() });
            }
            let face = CTFontDescriptor::with_name_and_size(&CFString::from_str("Georgia"), 12.0);
            Ok(Self { face, face_name: "Georgia".into() })
        }
    }

    /// The caption's font size in a frame of `w`×`h`.
    pub fn size(w: u32, h: u32) -> f64 {
        let (w, h) = (w as f64, h as f64);
        (if h > w { w / 30.0 } else { w.min(h) / 24.0 }).round()
    }

    /// Where the last line's box ends, above the frame's foot.
    pub fn bottom(w: u32, h: u32) -> f64 {
        h as f64 * if h > w { 0.22 } else { 0.085 }
    }

    /// Draw `text` for a frame of `w`×`h`.
    pub fn draw(&self, text: &str, w: u32, h: u32) -> Result<Band> {
        let size = Self::size(w, h);
        let line_height = 1.3 * size;
        let width = w as f64 * 0.82;
        // SAFETY: Core Text and Core Graphics calls on objects we own; the bitmap is owned by its context
        unsafe {
            let font = CTFont::with_font_descriptor(&self.face, size as CGFloat, std::ptr::null());
            let white = CGColor::new_srgb(1.0, 1.0, 1.0, 1.0);
            let keys: [&CFString; 2] = [kCTFontAttributeName, kCTForegroundColorAttributeName];
            let values: [&CFType; 2] = [font.as_ref(), white.as_ref()];
            let attrs = CFDictionary::<CFString, CFType>::from_slices(&keys, &values);
            let string = CFAttributedString::new(None, Some(&CFString::from_str(text)), Some(attrs.as_opaque())).context("the caption's text")?;
            let setter = CTTypesetter::with_attributed_string(&string);
            // break into lines as a browser wraps a paragraph: at word boundaries within the width
            let len = string.length();
            let mut lines: Vec<CFRetained<CTLine>> = Vec::new();
            let mut at = 0;
            while at < len {
                let n = setter.suggest_line_break(at, width).max(1);
                lines.push(setter.line(CFRange { location: at, length: n }));
                at += n;
            }
            let (ascent, descent) = (font.ascent(), font.descent());
            let half_leading = (line_height - (ascent + descent)) / 2.0;
            let bottom = Self::bottom(w, h);
            // room for the soft shadow below and above the text
            let band = ((bottom + lines.len() as f64 * line_height + 40.0).ceil() as u32).min(h).max(1);
            let space = CGColorSpace::new_device_rgb().context("no RGB colour space")?;
            let ctx: CFRetained<CGContext> =
                CGBitmapContextCreate(std::ptr::null_mut::<c_void>(), w as usize, band as usize, 8, w as usize * 4, Some(&space), CGImageAlphaInfo::PremultipliedLast.0)
                    .context("no bitmap for the caption")?;
            // the soft shadow on everything drawn in the layer; inside it the text with the tight one
            let soft = CGColor::new_srgb(0.0, 0.0, 0.0, 0.65);
            let tight = CGColor::new_srgb(0.0, 0.0, 0.0, 0.45);
            CGContext::set_shadow_with_color(Some(&ctx), CGSize { width: 0.0, height: -2.0 }, 18.0, Some(&soft));
            CGContext::begin_transparency_layer(Some(&ctx), None);
            CGContext::set_shadow_with_color(Some(&ctx), CGSize { width: 0.0, height: 0.0 }, 3.0, Some(&tight));
            let count = lines.len();
            for (i, line) in lines.iter().enumerate() {
                // lines stack up from the bottom: the last line's box starts at `bottom`
                let from_bottom = (count - 1 - i) as f64;
                let baseline = bottom + from_bottom * line_height + half_leading + descent;
                let advance = line.typographic_bounds(std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) - line.trailing_whitespace_width();
                let x = w as f64 * 0.09 + (width - advance) / 2.0;
                CGContext::set_text_position(Some(&ctx), x, baseline);
                line.draw(&ctx);
            }
            CGContext::end_transparency_layer(Some(&ctx));
            let image = CGBitmapContextCreateImage(Some(&ctx)).context("the caption's picture")?;
            Ok(Band { image, height: band })
        }
    }
}

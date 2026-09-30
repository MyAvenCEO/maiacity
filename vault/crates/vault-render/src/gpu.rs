//! The picture on the GPU: Core Image on Metal, in a context that manages no colour at all (no working or output
//! colour space, float working format — as `vault_media::gpu`), so code values go through exactly the maths the
//! kernels say. Every step of worker.ts's picture path is one Core Image step here:
//!
//!   decoded frame (YCbCr → RGB by its own matrix and range) → its journey into ACEScct (`cst::METAL_KERNEL`)
//!   → frame geometry (Lanczos scale to cover, crop where the reframing puts it) → clip CDL → film look (CDL)
//!   → output transform (a 3D LUT, tetrahedral) → display code values → fades → captions and the hook on top
//!   → rendered into the encoder's 4:2:0 buffer by its BT.709 matrix and TV range.

use std::{ffi::c_int, ptr::NonNull};

use anyhow::{Context, Result, anyhow};
use block2::RcBlock;
use objc2::{Message, rc::Retained, runtime::AnyObject};
use objc2_core_foundation::{CGAffineTransform, CGPoint, CGRect, CGSize};
use objc2_core_image::{
    CIColorKernel, CIContext, CIFilter, CIImage, CIKernel, CIVector, kCIContextCacheIntermediates, kCIContextOutputColorSpace,
    kCIContextWorkingColorSpace, kCIContextWorkingFormat, kCIFormatRGBAf, kCIImageApplyOrientationProperty, kCIImageColorSpace,
    kCIInputImageKey,
};
use objc2_core_video::CVPixelBuffer;
use objc2_foundation::{NSArray, NSData, NSDictionary, NSNull, NSNumber, NSObjectNSKeyValueCoding, NSString, NSURL};

use crate::{
    grade::{Balance, Cdl},
    output::Lut3d,
    timeline::ClipFrame,
};

/// The render's own kernels, beside the journeys' (`cst::METAL_KERNEL`).
pub const KERNELS: &str = r#"#include <CoreImage/CoreImage.h>
using namespace metal;

// the ASC CDL in ACEScct, as grade.rs `Cdl::apply`: slope, offset, power (negatives held at 0 before a power), saturation
extern "C" float4 cdl(coreimage::sample_t s, float3 slope, float3 offset, float3 power, float sat) [[stitchable]] {
    float3 y = s.rgb * slope + offset;
    float3 v = float3(power.x == 1.0f ? y.x : precise::pow(max(y.x, 0.0f), power.x),
                      power.y == 1.0f ? y.y : precise::pow(max(y.y, 0.0f), power.y),
                      power.z == 1.0f ? y.z : precise::pow(max(y.z, 0.0f), power.z));
    float l = dot(v, float3(0.2126f, 0.7152f, 0.0722f));
    return float4(l + sat * (v - l), s.a);
}

// the balance in ACEScct, as grade.rs `Balance::apply`: white balance (stops per channel), exposure, contrast around mid grey,
// then highlights and lows by luma, then saturation around luma — `wb` is (temp, tint, exposure), `tone` (contrast,
// highlights, shadows), `sat` the saturation minus 1
extern "C" float4 balance(coreimage::sample_t s, float3 wb, float3 tone, float sat) [[stitchable]] {
    const float STOP = 1.0f / 17.52f, PIVOT = 0.4135884f, REACH = 0.35f;
    float3 c = s.rgb + float3(wb.x * 0.5f, -wb.y, -wb.x * 0.5f) * STOP;
    c = PIVOT + (c + wb.z * STOP - PIVOT) * (1.0f + tone.x);
    float l = dot(c, float3(0.2126f, 0.7152f, 0.0722f));
    float lift = (tone.y * smoothstep(PIVOT, PIVOT + REACH, l) + tone.z * (1.0f - smoothstep(PIVOT - REACH, PIVOT, l))) * STOP;
    return float4(l + lift + (1.0f + sat) * (c - l), s.a);
}

// a fade in display space: the picture towards black
extern "C" float4 gain(coreimage::sample_t s, float k) [[stitchable]] {
    return float4(s.rgb * k, s.a);
}

// an overlay's own fade: premultiplied, so all four channels
extern "C" float4 opacity(coreimage::sample_t s, float k) [[stitchable]] {
    return s * k;
}

static float hash21(float2 p, float seed) {
    float3 q = fract(float3(p.x, p.y, seed) * float3(0.1031f, 0.1030f, 0.0973f));
    q += dot(q, q.yzx + 33.33f);
    return fract((q.x + q.y) * q.z);
}

// triangular (TPDF) dither of ±amp before an 8-bit encoder, in place of ffmpeg's error diffusion
extern "C" float4 dither(coreimage::sample_t s, float amp, float seed, coreimage::destination dest) [[stitchable]] {
    float2 p = dest.coord();
    float n = hash21(p, seed) + hash21(p + 71.3f, seed + 13.7f) - 1.0f;
    return float4(s.rgb + n * amp, s.a);
}

// a 3D LUT, tetrahedral (ffmpeg lut3d interp=tetrahedral), the input clamped to 0…1. The cube lies in the `lut` image
// as `tiles` blue slices across, each size × size (red across, green down from the top).
static float3 cell(coreimage::sampler lut, float size, float tiles, float h, float3 i) {
    float tx = fmod(i.z, tiles), ty = floor(i.z / tiles);
    float x = tx * size + i.x + 0.5f;
    float row = ty * size + i.y;
    return lut.sample(lut.transform(float2(x, h - row - 0.5f))).rgb;
}

extern "C" float4 lut3d(coreimage::sampler src, coreimage::sampler lut, float size, float tiles, float h) [[stitchable]] {
    float4 s = src.sample(src.coord());
    float n = size - 1.0f;
    float3 p = clamp(s.rgb, 0.0f, 1.0f) * n;
    float3 i = min(floor(p), float3(n - 1.0f));
    float3 f = p - i;
    float3 c000 = cell(lut, size, tiles, h, i);
    float3 c111 = cell(lut, size, tiles, h, i + float3(1.0f, 1.0f, 1.0f));
    float3 o;
    if (f.x > f.y) {
        if (f.y > f.z) {
            o = (1.0f - f.x) * c000 + (f.x - f.y) * cell(lut, size, tiles, h, i + float3(1, 0, 0)) + (f.y - f.z) * cell(lut, size, tiles, h, i + float3(1, 1, 0)) + f.z * c111;
        } else if (f.x > f.z) {
            o = (1.0f - f.x) * c000 + (f.x - f.z) * cell(lut, size, tiles, h, i + float3(1, 0, 0)) + (f.z - f.y) * cell(lut, size, tiles, h, i + float3(1, 0, 1)) + f.y * c111;
        } else {
            o = (1.0f - f.z) * c000 + (f.z - f.x) * cell(lut, size, tiles, h, i + float3(0, 0, 1)) + (f.x - f.y) * cell(lut, size, tiles, h, i + float3(1, 0, 1)) + f.y * c111;
        }
    } else {
        if (f.z > f.y) {
            o = (1.0f - f.z) * c000 + (f.z - f.y) * cell(lut, size, tiles, h, i + float3(0, 0, 1)) + (f.y - f.x) * cell(lut, size, tiles, h, i + float3(0, 1, 1)) + f.x * c111;
        } else if (f.z > f.x) {
            o = (1.0f - f.y) * c000 + (f.y - f.z) * cell(lut, size, tiles, h, i + float3(0, 1, 0)) + (f.z - f.x) * cell(lut, size, tiles, h, i + float3(0, 1, 1)) + f.x * c111;
        } else {
            o = (1.0f - f.y) * c000 + (f.y - f.x) * cell(lut, size, tiles, h, i + float3(0, 1, 0)) + (f.x - f.z) * cell(lut, size, tiles, h, i + float3(1, 1, 0)) + f.z * c111;
        }
    }
    return float4(o, s.a);
}
"#;

pub type Image = Retained<CIImage>;

/// The cube as an image the `lut3d` kernel samples.
struct LutImage {
    image: Image,
    size: f32,
    tiles: f32,
    height: f32,
    extent: CGRect,
}

pub struct Gpu {
    context: Retained<CIContext>,
    journey: Retained<CIColorKernel>,
    cdl: Retained<CIColorKernel>,
    balance: Retained<CIColorKernel>,
    gain: Retained<CIColorKernel>,
    opacity: Retained<CIColorKernel>,
    dither: Retained<CIColorKernel>,
    lut3d: Retained<CIKernel>,
    lut: Option<LutImage>,
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> CGRect {
    CGRect { origin: CGPoint { x, y }, size: CGSize { width: w, height: h } }
}

fn unmanaged() -> Retained<NSDictionary<NSString, AnyObject>> {
    let null = NSNull::null();
    // SAFETY: a constant key of Core Image's
    let keys: [&NSString; 1] = [unsafe { kCIImageColorSpace }];
    let values: [&AnyObject; 1] = [&null];
    NSDictionary::from_slices(&keys, &values)
}

fn kernels(source: &str) -> Result<Vec<Retained<CIKernel>>> {
    // SAFETY: compiling Metal source we own
    let ks = unsafe { CIKernel::kernelsWithMetalString_error(&NSString::from_str(source)) }.map_err(|e| anyhow!("the kernels do not compile: {e:?}"))?;
    Ok(ks.iter().collect())
}

fn find(ks: &[Retained<CIKernel>], name: &str) -> Result<Retained<CIKernel>> {
    // SAFETY: reading a kernel's name
    ks.iter().find(|k| unsafe { k.name() }.to_string() == name).cloned().with_context(|| format!("no kernel {name}"))
}

fn color(k: Retained<CIKernel>) -> Retained<CIColorKernel> {
    // SAFETY: kernels taking one sample_t are CIColorKernels
    unsafe { Retained::cast_unchecked(k) }
}

fn num(x: f64) -> Retained<NSNumber> {
    NSNumber::new_f64(x)
}

fn vec3(v: [f64; 3]) -> Retained<CIVector> {
    // SAFETY: plain constructor
    unsafe { CIVector::vectorWithX_Y_Z(v[0], v[1], v[2]) }
}

impl Gpu {
    pub fn new() -> Result<Self> {
        // SAFETY: Core Image objects we create and own, used from this thread only.
        let context = unsafe {
            let null = NSNull::null();
            let rgbaf = NSNumber::new_i32(kCIFormatRGBAf);
            let no = NSNumber::new_bool(false);
            let keys: [&NSString; 4] = [kCIContextWorkingColorSpace, kCIContextOutputColorSpace, kCIContextWorkingFormat, kCIContextCacheIntermediates];
            let values: [&AnyObject; 4] = [&null, &null, &rgbaf, &no];
            CIContext::contextWithOptions(Some(&NSDictionary::from_slices(&keys, &values)))
        };
        let cst = kernels(vault_media::cst::METAL_KERNEL)?;
        let ours = kernels(KERNELS)?;
        Ok(Self {
            context,
            journey: color(find(&cst, "acescct")?),
            cdl: color(find(&ours, "cdl")?),
            balance: color(find(&ours, "balance")?),
            gain: color(find(&ours, "gain")?),
            opacity: color(find(&ours, "opacity")?),
            dither: color(find(&ours, "dither")?),
            lut3d: find(&ours, "lut3d")?,
            lut: None,
        })
    }

    /// The output transform's cube, loaded once per render.
    pub fn set_output(&mut self, lut: &Lut3d) {
        let n = lut.size;
        let tiles = (n as f64).sqrt().ceil() as usize;
        let rows = n.div_ceil(tiles);
        let (w, h) = (tiles * n, rows * n);
        let mut px = vec![0f32; w * h * 4];
        for b in 0..n {
            let (tx, ty) = (b % tiles, b / tiles);
            for g in 0..n {
                let row = ty * n + g;
                for r in 0..n {
                    let src = ((b * n + g) * n + r) * 3;
                    let dst = (row * w + tx * n + r) * 4;
                    px[dst..dst + 3].copy_from_slice(&lut.data[src..src + 3]);
                    px[dst + 3] = 1.0;
                }
            }
        }
        let bytes: Vec<u8> = px.iter().flat_map(|x| x.to_ne_bytes()).collect();
        // SAFETY: the data outlives nothing: NSData copies it
        let image = unsafe {
            CIImage::imageWithBitmapData_bytesPerRow_size_format_colorSpace(
                &NSData::from_vec(bytes),
                w * 16,
                CGSize { width: w as f64, height: h as f64 },
                kCIFormatRGBAf,
                None,
            )
        };
        let extent = rect(0.0, 0.0, w as f64, h as f64);
        self.lut = Some(LutImage { image, size: n as f32, tiles: tiles as f32, height: h as f32, extent });
    }

    /// A decoded frame as Core Image sees it: RGB by its own YCbCr matrix and range, no colour management.
    /// Turned upright as the movie's track says (its preferred transform: the iPhone held upside down is 180°, portrait
    /// 90°), its origin back at 0, 0. The transform is in the frame's own top-down coordinates; Core Image's run
    /// bottom-up, where the same turn is the matrix with its off-diagonal negated.
    pub fn orient(&self, img: &CIImage, t: CGAffineTransform) -> Image {
        if t.a == 1.0 && t.b == 0.0 && t.c == 0.0 && t.d == 1.0 {
            return img.retain();
        }
        // SAFETY: plain Core Image call
        let turned = unsafe { img.imageByApplyingTransform(CGAffineTransform { a: t.a, b: -t.b, c: -t.c, d: t.d, tx: 0.0, ty: 0.0 }) };
        to_origin(&turned)
    }

    pub fn frame(&self, pb: &CVPixelBuffer) -> Image {
        // SAFETY: the buffer is alive for the call; Core Image retains what it needs
        unsafe { CIImage::imageWithCVPixelBuffer_options(pb, Some(&unmanaged())) }
    }

    /// A still (PNG, JPEG, TIFF, EXR, HEIC) as its code values, upright by its EXIF orientation, with its origin at 0.
    pub fn still(&self, src: impl Into<vault_media::Source>) -> Result<Image> {
        let src: vault_media::Source = src.into();
        let Some(path) = src.path() else {
            // a blob read in place: Core Image reads the picture from its bytes (the same options)
            let bytes = src.read_all().with_context(|| format!("cannot read the picture {src}"))?;
            return Ok(to_origin(&*vault_media::gpu::load_image(&bytes).with_context(|| format!("cannot read the picture {src}"))?));
        };
        // SAFETY: plain Core Image calls
        unsafe {
            let null = NSNull::null();
            let yes = NSNumber::new_bool(true);
            let keys: [&NSString; 2] = [kCIImageColorSpace, kCIImageApplyOrientationProperty];
            let values: [&AnyObject; 2] = [&null, &yes];
            let options = NSDictionary::from_slices(&keys, &values);
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
            let img = CIImage::imageWithContentsOfURL_options(&url, Some(&options)).with_context(|| format!("cannot read the picture {}", path.display()))?;
            Ok(to_origin(&img))
        }
    }

    /// A CGImage (captions) as its code values.
    pub fn cg_image(&self, cg: &objc2_core_graphics::CGImage) -> Image {
        // SAFETY: the CGImage is retained by the CIImage
        unsafe { CIImage::imageWithCGImage_options(cg, Some(&unmanaged())) }
    }

    /// Into ACEScct by a journey (`cst::Journey::kernel_args`).
    pub fn journey(&self, img: &CIImage, args: (f32, f32, [[f32; 3]; 3])) -> Result<Image> {
        let (curve, scale, m) = args;
        if curve == 0.0 {
            return Ok(img.retain());
        }
        let row = |r: [f32; 3]| vec3(r.map(f64::from));
        let (c, s) = (NSNumber::new_f32(curve), NSNumber::new_f32(scale));
        let (r0, r1, r2) = (row(m[0]), row(m[1]), row(m[2]));
        let args: [&AnyObject; 6] = [img, &c, &s, &r0, &r1, &r2];
        // SAFETY: the kernel's arguments as its signature takes them
        unsafe { self.journey.applyWithExtent_arguments(img.ext(), &NSArray::from_slice(&args)) }.context("the journey gave no picture")
    }

    /// The ASC CDL (none: the picture as it is).
    pub fn cdl(&self, img: &CIImage, g: Option<&Cdl>) -> Result<Image> {
        let Some(g) = g.filter(|g| !g.is_neutral()) else { return Ok(img.retain()) };
        let (sl, of, pw, sat) = (vec3(g.slope), vec3(g.offset), vec3(g.power), num(g.sat));
        let args: [&AnyObject; 5] = [img, &sl, &of, &pw, &sat];
        // SAFETY: as above
        unsafe { self.cdl.applyWithExtent_arguments(img.ext(), &NSArray::from_slice(&args)) }.context("the grade gave no picture")
    }

    /// The balance (none: the picture as shot).
    pub fn balance(&self, img: &CIImage, b: Option<&Balance>) -> Result<Image> {
        let Some(b) = b.filter(|b| !b.is_neutral()) else { return Ok(img.retain()) };
        let (wb, tone, sat) = (vec3([b.temp, b.tint, b.exposure]), vec3([b.contrast, b.highlights, b.shadows]), num(b.sat));
        let args: [&AnyObject; 4] = [img, &wb, &tone, &sat];
        // SAFETY: the kernel's arguments as its signature takes them
        unsafe { self.balance.applyWithExtent_arguments(img.ext(), &NSArray::from_slice(&args)) }.context("the balance gave no picture")
    }

    /// The output transform.
    pub fn output(&self, img: &CIImage) -> Result<Image> {
        let lut = self.lut.as_ref().context("no output transform set")?;
        let extent = img.ext();
        let lut_extent = lut.extent;
        let roi = RcBlock::new(move |i: c_int, r: CGRect| if i == 1 { lut_extent } else { r });
        let (size, tiles, h) = (NSNumber::new_f32(lut.size), NSNumber::new_f32(lut.tiles), NSNumber::new_f32(lut.height));
        let args: [&AnyObject; 5] = [img, &lut.image, &size, &tiles, &h];
        // SAFETY: the ROI block lives until the call returns; Core Image copies it
        unsafe {
            self.lut3d.applyWithExtent_roiCallback_arguments(extent, &*roi as *const _ as *mut _, &NSArray::from_slice(&args))
        }
        .context("the output transform gave no picture")
    }

    /// The picture towards black (a fade), `k` 1 = as it is.
    pub fn gain(&self, img: &CIImage, k: f64) -> Result<Image> {
        if k >= 1.0 {
            return Ok(img.retain());
        }
        let k = num(k.max(0.0));
        let args: [&AnyObject; 2] = [img, &k];
        // SAFETY: as above
        unsafe { self.gain.applyWithExtent_arguments(img.ext(), &NSArray::from_slice(&args)) }.context("the fade gave no picture")
    }

    /// An overlay's opacity (premultiplied).
    pub fn opacity(&self, img: &CIImage, k: f64) -> Result<Image> {
        if k >= 1.0 {
            return Ok(img.retain());
        }
        let k = num(k.max(0.0));
        let args: [&AnyObject; 2] = [img, &k];
        // SAFETY: as above
        unsafe { self.opacity.applyWithExtent_arguments(img.ext(), &NSArray::from_slice(&args)) }.context("the overlay gave no picture")
    }

    /// Triangular dither of ±`amp` (display code values), different every frame by `seed`.
    pub fn dither(&self, img: &CIImage, amp: f64, seed: f64) -> Result<Image> {
        let (a, s) = (num(amp), num(seed));
        let args: [&AnyObject; 3] = [img, &a, &s];
        // SAFETY: as above
        unsafe { self.dither.applyWithExtent_arguments(img.ext(), &NSArray::from_slice(&args)) }.context("the dither gave no picture")
    }

    /// `top` over `bottom` (premultiplied source-over).
    pub fn over(&self, top: &CIImage, bottom: &CIImage) -> Image {
        // SAFETY: plain Core Image call
        unsafe { top.imageByCompositingOverImage(bottom) }
    }

    /// Black, `w`×`h`, alpha 1.
    pub fn black(&self, w: u32, h: u32) -> Image {
        // SAFETY: plain Core Image calls
        unsafe { CIImage::blackImage().imageByCroppingToRect(rect(0.0, 0.0, w as f64, h as f64)) }
    }

    /// Scale by `kx`, `ky` (Lanczos), edges clamped first so nothing dark bleeds in.
    pub fn scale(&self, img: &CIImage, kx: f64, ky: f64) -> Result<Image> {
        let extent = img.ext();
        if (kx - 1.0).abs() < 1e-9 && (ky - 1.0).abs() < 1e-9 {
            return Ok(img.retain());
        }
        // SAFETY: plain Core Image calls
        unsafe {
            let filter = CIFilter::filterWithName(&NSString::from_str("CILanczosScaleTransform")).context("no Lanczos filter")?;
            filter.setValue_forKey(Some(&img.imageByClampingToExtent()), kCIInputImageKey);
            filter.setValue_forKey(Some(&num(ky)), &NSString::from_str("inputScale"));
            filter.setValue_forKey(Some(&num(kx / ky)), &NSString::from_str("inputAspectRatio"));
            let out = filter.outputImage().context("the scale gave no picture")?;
            let (w, h) = ((extent.size.width * kx).round(), (extent.size.height * ky).round());
            Ok(out.imageByCroppingToRect(rect(extent.origin.x * kx, extent.origin.y * ky, w, h)))
        }
    }

    /// The frame a picture is cut to (picture.mjs `geometry`): scaled to cover `W`×`H` (times its zoom), then cropped
    /// where its reframing for this shape puts it (x, y in −1…1 of the free room: −1 the left/top edge, 0 the middle).
    pub fn frame_to(&self, img: &CIImage, width: u32, height: u32, frame: Option<&ClipFrame>) -> Result<Image> {
        let g = geometry(img.ext().size.width, img.ext().size.height, width, height, frame);
        let img = to_origin(img);
        let scaled = if g.w as f64 != img.ext().size.width || g.h as f64 != img.ext().size.height {
            self.scale(&img, g.w as f64 / img.ext().size.width, g.h as f64 / img.ext().size.height)?
        } else {
            img
        };
        // Core Image's origin is bottom-left: the crop's top edge at y from the top
        let y = (g.h - height - g.y) as f64;
        // SAFETY: plain Core Image calls
        unsafe {
            let cropped = scaled.imageByCroppingToRect(rect(g.x as f64, y, width as f64, height as f64));
            Ok(cropped.imageByApplyingTransform(CGAffineTransform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, tx: -(g.x as f64), ty: -y }))
        }
    }

    /// Scale a whole frame to `w`×`h` exactly (the 1080 copy from the master, the hook layer).
    pub fn resize(&self, img: &CIImage, w: u32, h: u32) -> Result<Image> {
        let e = img.ext();
        let out = self.scale(&to_origin(img), w as f64 / e.size.width, h as f64 / e.size.height)?;
        // SAFETY: plain Core Image call
        Ok(unsafe { out.imageByCroppingToRect(rect(0.0, 0.0, w as f64, h as f64)) })
    }

    /// Render into an encoder's buffer (by its own format and colour tags: RGB → YCbCr with its matrix and range).
    pub fn render(&self, img: &CIImage, out: &CVPixelBuffer, w: u32, h: u32) {
        // SAFETY: the buffer is alive for the call
        unsafe { self.context.render_toCVPixelBuffer_bounds_colorSpace(img, out, rect(0.0, 0.0, w as f64, h as f64), None) }
    }

    /// A picture's display code values as a 16-bit PNG, tagged Rec.709 (the hero frame).
    pub fn png(&self, img: &CIImage, w: u32, h: u32, out: &std::path::Path) -> Result<()> {
        // SAFETY: plain Core Image and Core Graphics calls
        unsafe {
            let img = img.imageByCroppingToRect(rect(0.0, 0.0, w as f64, h as f64));
            let space = objc2_core_graphics::CGColorSpace::with_name(Some(objc2_core_graphics::kCGColorSpaceITUR_709)).context("no Rec.709 colour space")?;
            let url = NSURL::fileURLWithPath(&NSString::from_str(&std::path::absolute(out)?.to_string_lossy()));
            self.context
                .writePNGRepresentationOfImage_toURL_format_colorSpace_options_error(&img, &url, objc2_core_image::kCIFormatRGBA16, &space, &NSDictionary::new())
                .map_err(|e| anyhow!("cannot write {}: {e:?}", out.display()))
        }
    }

    /// A picture's display code values as a JPEG, tagged Rec.709 (a preview thumbnail).
    pub fn jpeg(&self, img: &CIImage, w: u32, h: u32, out: &std::path::Path) -> Result<()> {
        // SAFETY: plain Core Image and Core Graphics calls
        unsafe {
            let img = img.imageByCroppingToRect(rect(0.0, 0.0, w as f64, h as f64));
            let space = objc2_core_graphics::CGColorSpace::with_name(Some(objc2_core_graphics::kCGColorSpaceITUR_709)).context("no Rec.709 colour space")?;
            let url = NSURL::fileURLWithPath(&NSString::from_str(&std::path::absolute(out)?.to_string_lossy()));
            self.context
                .writeJPEGRepresentationOfImage_toURL_colorSpace_options_error(&img, &url, &space, &NSDictionary::new())
                .map_err(|e| anyhow!("cannot write {}: {e:?}", out.display()))
        }
    }

    /// A picture's display code values as a JPEG in memory, tagged Rec.709 (the frames the shot analysis sends).
    pub fn jpeg_bytes(&self, img: &CIImage, w: u32, h: u32) -> Result<Vec<u8>> {
        // SAFETY: plain Core Image and Core Graphics calls
        unsafe {
            let img = img.imageByCroppingToRect(rect(0.0, 0.0, w as f64, h as f64));
            let space = objc2_core_graphics::CGColorSpace::with_name(Some(objc2_core_graphics::kCGColorSpaceITUR_709)).context("no Rec.709 colour space")?;
            let data = self.context.JPEGRepresentationOfImage_colorSpace_options(&img, &space, &NSDictionary::new()).context("Core Image made no JPEG")?;
            Ok(data.to_vec())
        }
    }

    /// Read a picture back as RGBA f32 (tests, the hero frame).
    pub fn read(&self, img: &CIImage, w: u32, h: u32) -> Vec<f32> {
        let mut px = vec![0f32; (w * h * 4) as usize];
        // SAFETY: `px` holds w·h RGBA f32 pixels
        unsafe {
            self.context.render_toBitmap_rowBytes_bounds_format_colorSpace(
                img,
                NonNull::new(px.as_mut_ptr().cast()).unwrap(),
                (w * 16) as isize,
                rect(0.0, 0.0, w as f64, h as f64),
                kCIFormatRGBAf,
                None,
            );
        }
        px
    }

    /// A picture from RGBA f32 pixels, top row first (tests).
    pub fn from_rgba(&self, px: &[f32], w: u32, h: u32) -> Image {
        let bytes: Vec<u8> = px.iter().flat_map(|x| x.to_ne_bytes()).collect();
        // SAFETY: NSData copies the bytes
        unsafe {
            CIImage::imageWithBitmapData_bytesPerRow_size_format_colorSpace(
                &NSData::from_vec(bytes),
                (w * 16) as usize,
                CGSize { width: w as f64, height: h as f64 },
                kCIFormatRGBAf,
                None,
            )
        }
    }
}

/// Moved so its extent starts at 0, 0.
pub fn to_origin(img: &CIImage) -> Image {
    // SAFETY: plain Core Image calls
    unsafe {
        let e = img.ext();
        if e.origin.x == 0.0 && e.origin.y == 0.0 {
            return img.retain();
        }
        img.imageByApplyingTransform(CGAffineTransform { a: 1.0, b: 0.0, c: 0.0, d: 1.0, tx: -e.origin.x, ty: -e.origin.y })
    }
}

/// The scale-and-crop of picture.mjs `geometry`: the scaled size (even sides, never smaller than the frame) and the
/// crop's top-left corner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Geometry {
    pub w: u32,
    pub h: u32,
    pub x: u32,
    pub y: u32,
}

pub fn geometry(src_w: f64, src_h: f64, width: u32, height: u32, frame: Option<&ClipFrame>) -> Geometry {
    let clamp = |v: Option<f64>| v.filter(|x| x.is_finite()).unwrap_or(0.0).clamp(-1.0, 1.0);
    let zoom = frame.and_then(|f| f.zoom).filter(|z| z.is_finite() && *z > 0.0).unwrap_or(1.0).max(1.0);
    let s = (width as f64 / src_w).max(height as f64 / src_h) * zoom;
    // JavaScript's Math.round: halves up
    let js_round = |x: f64| (x + 0.5).floor();
    let w = (width as f64).max(2.0 * js_round(src_w * s / 2.0)) as u32;
    let h = (height as f64).max(2.0 * js_round(src_h * s / 2.0)) as u32;
    let x = js_round((w - width) as f64 / 2.0 * (1.0 + clamp(frame.and_then(|f| f.x)))) as u32;
    let y = js_round((h - height) as f64 / 2.0 * (1.0 + clamp(frame.and_then(|f| f.y)))) as u32;
    Geometry { w, h, x, y }
}

/// A picture's extent.
pub trait Extent {
    fn ext(&self) -> CGRect;
}

impl Extent for CIImage {
    fn ext(&self) -> CGRect {
        // SAFETY: a getter
        unsafe { self.extent() }
    }
}

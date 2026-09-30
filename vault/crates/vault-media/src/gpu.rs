//! A proxy's frames through their colour journey into ACEScct, on the GPU: Core Image running `cst::METAL_KERNEL`
//! (the exact maths — within 1.2e-5 ACEScct of the reference, measured on an M1) and a Lanczos scale down to the
//! proxy's size, in a context that manages no colour at all, so the code values go in and come out as the journey
//! says and nothing else touches them.

use anyhow::{Context, Result, bail};
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_image::{
    CIColorKernel, CIContext, CIFilter, CIImage, CIKernel, CIVector, kCIContextCacheIntermediates, kCIContextOutputColorSpace,
    kCIContextWorkingColorSpace, kCIContextWorkingFormat, kCIFormatRGBAf, kCIImageApplyOrientationProperty, kCIImageColorSpace,
    kCIInputImageKey,
};
use objc2_core_video::CVPixelBuffer;
use objc2_foundation::{NSArray, NSData, NSDictionary, NSNull, NSNumber, NSObjectNSKeyValueCoding, NSString};

use crate::cst;

pub struct Grader {
    context: Retained<CIContext>,
    kernel: Retained<CIColorKernel>,
    args: (f32, f32, [[f32; 3]; 3]),
    label: &'static str,
}

impl Grader {
    /// The journey of this source profile into ACEScct; None when there is none (an unknown or new kind of source).
    pub fn for_profile(profile: &str) -> Result<Option<Self>> {
        let Some(journey) = cst::journey(profile) else { return Ok(None) };
        // SAFETY: Core Image objects we create and own, used from this thread only.
        unsafe {
            let null = NSNull::null();
            let rgbaf = NSNumber::new_i32(kCIFormatRGBAf);
            let no = NSNumber::new_bool(false);
            let keys: [&NSString; 4] = [kCIContextWorkingColorSpace, kCIContextOutputColorSpace, kCIContextWorkingFormat, kCIContextCacheIntermediates];
            let values: [&AnyObject; 4] = [&null, &null, &rgbaf, &no];
            let options = NSDictionary::from_slices(&keys, &values);
            let context = CIContext::contextWithOptions(Some(&options));
            let kernels = CIKernel::kernelsWithMetalString_error(&NSString::from_str(cst::METAL_KERNEL))
                .map_err(|e| anyhow::anyhow!("the colour kernel does not compile: {e:?}"))?;
            let kernel = kernels
                .iter()
                .find(|k| k.name().to_string() == "acescct")
                .context("the colour kernel has no function acescct")?;
            let kernel: Retained<CIColorKernel> = Retained::cast_unchecked(kernel);
            Ok(Some(Self { context, kernel, args: journey.kernel_args(), label: journey.label }))
        }
    }

    pub fn label(&self) -> &'static str {
        self.label
    }

    /// One frame: the decoded source into ACEScct, scaled to `w`×`h`, rendered into `out`. Core Image reads the source's
    /// YCbCr as full-range RGB by its matrix and range tags — still the source's own curve and gamut, as the kernel wants
    /// — and writes `out` by its tags.
    pub fn frame(&self, src: &CVPixelBuffer, out: &CVPixelBuffer, w: u32, h: u32) -> Result<()> {
        // SAFETY: as above; the pixel buffers are alive for the whole call.
        unsafe {
            let null = NSNull::null();
            let keys: [&NSString; 1] = [kCIImageColorSpace];
            let values: [&AnyObject; 1] = [&null];
            let unmanaged = NSDictionary::from_slices(&keys, &values);
            let image = CIImage::imageWithCVPixelBuffer_options(src, Some(&unmanaged));
            let extent = image.extent();
            let (curve, scale, m) = self.args;
            let row = |r: [f32; 3]| CIVector::vectorWithX_Y_Z(r[0] as f64, r[1] as f64, r[2] as f64);
            let (c, s) = (NSNumber::new_f32(curve), NSNumber::new_f32(scale));
            let (r0, r1, r2) = (row(m[0]), row(m[1]), row(m[2]));
            let args: [&AnyObject; 6] = [&image, &c, &s, &r0, &r1, &r2];
            let graded = self
                .kernel
                .applyWithExtent_arguments(extent, &NSArray::from_slice(&args))
                .context("the colour kernel gave no picture")?;
            let k = w as f64 / extent.size.width;
            let scaled = if (k - 1.0).abs() < 1e-6 && (h as f64 - extent.size.height).abs() < 0.5 {
                graded
            } else {
                self.scale(&graded, k, h as f64 / extent.size.height / k)?
            };
            let bounds = CGRect { origin: CGPoint { x: 0.0, y: 0.0 }, size: CGSize { width: w as f64, height: h as f64 } };
            self.context.render_toCVPixelBuffer_bounds_colorSpace(&scaled, out, bounds, None);
        }
        Ok(())
    }

    /// A still (or one frame of a sequence) through the journey, scaled to `w`×`h`, read back as RGBA f32 — ACEScct
    /// codes, top row first.
    pub fn still(&self, image: &CIImage, w: u32, h: u32) -> Result<Vec<f32>> {
        // SAFETY: as above; `out` is sized for the bounds rendered into it.
        unsafe {
            let extent = image.extent();
            let (curve, scale, m) = self.args;
            let row = |r: [f32; 3]| CIVector::vectorWithX_Y_Z(r[0] as f64, r[1] as f64, r[2] as f64);
            let (c, s) = (NSNumber::new_f32(curve), NSNumber::new_f32(scale));
            let (r0, r1, r2) = (row(m[0]), row(m[1]), row(m[2]));
            let args: [&AnyObject; 6] = [image, &c, &s, &r0, &r1, &r2];
            let graded = self.kernel.applyWithExtent_arguments(extent, &NSArray::from_slice(&args)).context("the colour kernel gave no picture")?;
            let k = w as f64 / extent.size.width;
            let scaled = if (k - 1.0).abs() < 1e-6 && (h as f64 - extent.size.height).abs() < 0.5 {
                graded
            } else {
                self.scale(&graded, k, h as f64 / extent.size.height / k)?
            };
            let mut out = vec![0f32; (w * h * 4) as usize];
            let bounds = CGRect { origin: scaled.extent().origin, size: CGSize { width: w as f64, height: h as f64 } };
            let data = std::ptr::NonNull::new(out.as_mut_ptr().cast()).context("no buffer")?;
            self.context.render_toBitmap_rowBytes_bounds_format_colorSpace(&scaled, data, (w * 16) as isize, bounds, kCIFormatRGBAf, None);
            Ok(out)
        }
    }

    /// Down to the proxy's size when the decoder did not (Lanczos: no aliasing on fine detail).
    unsafe fn scale(&self, graded: &CIImage, k: f64, aspect: f64) -> Result<Retained<CIImage>> {
        unsafe {
            let filter = CIFilter::filterWithName(&NSString::from_str("CILanczosScaleTransform")).context("no Lanczos filter")?;
            filter.setValue_forKey(Some(graded), kCIInputImageKey);
            filter.setValue_forKey(Some(&NSNumber::new_f64(k)), &NSString::from_str("inputScale"));
            filter.setValue_forKey(Some(&NSNumber::new_f64(aspect)), &NSString::from_str("inputAspectRatio"));
            filter.outputImage().context("the scale gave no picture")
        }
    }
}

/// A picture's bytes (OpenEXR, PNG, JPEG, HEIC, TIFF …) as Core Image reads them: its own code values, unmanaged — no
/// colour conversion at all — the right way up.
pub fn load_image(bytes: &[u8]) -> Result<Retained<CIImage>> {
    // SAFETY: an NSData copy of the bytes, read by Core Image on this thread.
    unsafe {
        let null = NSNull::null();
        let yes = NSNumber::new_bool(true);
        let keys: [&NSString; 2] = [kCIImageColorSpace, kCIImageApplyOrientationProperty];
        let values: [&AnyObject; 2] = [&null, &yes];
        let options = NSDictionary::from_slices(&keys, &values);
        CIImage::imageWithData_options(&NSData::with_bytes(bytes), Some(&options)).context("Core Image cannot read this picture")
    }
}

/// A picture's size in pixels.
pub fn size_of(image: &CIImage) -> (u32, u32) {
    // SAFETY: a plain accessor.
    let e = unsafe { image.extent() };
    (e.size.width.round() as u32, e.size.height.round() as u32)
}

/// Is the kernel usable on this Mac at all? (For the tests and the app's start.)
pub fn check() -> Result<()> {
    match Grader::for_profile("apple-log-2")? {
        Some(_) => Ok(()),
        None => bail!("no journey for apple-log-2"),
    }
}

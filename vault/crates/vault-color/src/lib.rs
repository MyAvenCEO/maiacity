//! The studio's colour maths, pure Rust and platform-free: every source's journey into ACEScct (`cst`) and the ACES 2.0
//! output transform, ACEScct to Rec.709 display (`aces2`). The Mac's native media (vault-media: Core Image, Metal)
//! and the vault server (analyse.rs: the picture a model sees, through ffmpeg's `lut3d`) use the same numbers.

pub mod aces2;
pub mod cst;

/// A baked cube as a `.cube` file (the Adobe / Resolve 3D LUT that ffmpeg's `lut3d` reads): `size`³ RGB triplets, red
/// fastest — the order `aces2::bake_cube` and `cst::Journey::cube` bake in.
pub fn cube_file(title: &str, size: usize, cube: &[f32]) -> String {
    let mut out = String::with_capacity(cube.len() * 10 + 64);
    out.push_str(&format!("TITLE \"{title}\"\nLUT_3D_SIZE {size}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n"));
    for rgb in cube.chunks_exact(3) {
        out.push_str(&format!("{:.6} {:.6} {:.6}\n", rgb[0], rgb[1], rgb[2]));
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_cube_file_is_red_fastest() {
        let cube = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0];
        let f = super::cube_file("identity", 2, &cube);
        let lines: Vec<&str> = f.lines().collect();
        assert_eq!(lines[1], "LUT_3D_SIZE 2");
        assert_eq!(lines[4], "0.000000 0.000000 0.000000");
        assert_eq!(lines[5], "1.000000 0.000000 0.000000");
        assert_eq!(lines.len(), 4 + 8);
    }

    #[test]
    fn the_output_transform_bakes_mid_grey_to_a_middle_code() {
        // ACEScct 18 % grey through the ACES 2.0 SDR output: a Rec.709 code a little under the middle (OCIO: ≈ 0.39)
        let t = super::aces2::OutputTransform::sdr_rec709();
        let g = t.apply([super::cst::to_cct(0.18); 3]);
        assert!(g.iter().all(|v| (0.3..0.5).contains(v)), "{g:?}");
    }
}

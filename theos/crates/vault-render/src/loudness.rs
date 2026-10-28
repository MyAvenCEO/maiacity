//! Loudness as EBU R 128 measures it, in Rust — what qc.mjs asked ffmpeg's `ebur128=peak=true` for: integrated
//! loudness (ITU-R BS.1770-4: K-weighting, 400 ms blocks overlapping by 75 %, the absolute gate at −70 LUFS and the
//! relative gate 10 LU below), the loudness range (EBU Tech 3342: 3 s short-term loudness, gates at −70 LUFS and
//! 20 LU below, the 10th to the 95th percentile) and the true peak (4× oversampled, BS.1770-4 Annex 2).
//!
//! Streaming: it keeps one number per 100 ms of sound, never the sound.

use serde::Serialize;

/// What a delivery's sound measures (the keys qc.mjs's `loudness` returns; null where there is nothing to measure).
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
pub struct Loudness {
    /// integrated loudness, LUFS
    pub lufs: Option<f64>,
    /// loudness range, LU
    pub lra: Option<f64>,
    /// true peak, dBTP
    #[serde(rename = "truePeak")]
    pub true_peak: Option<f64>,
    /// the highest sample, dBFS
    #[serde(rename = "samplePeak")]
    pub sample_peak: Option<f64>,
}

/// A biquad, direct form I, in f64.
#[derive(Debug, Clone, Copy)]
struct Biquad {
    b: [f64; 3],
    a: [f64; 3],
    x: [f64; 2],
    y: [f64; 2],
}

impl Biquad {
    fn new(b: [f64; 3], a: [f64; 3]) -> Self {
        Self { b, a, x: [0.0; 2], y: [0.0; 2] }
    }
    #[inline]
    fn run(&mut self, x: f64) -> f64 {
        let y = self.b[0] * x + self.b[1] * self.x[0] + self.b[2] * self.x[1] - self.a[1] * self.y[0] - self.a[2] * self.y[1];
        self.x = [x, self.x[0]];
        self.y = [y, self.y[0]];
        y
    }
}

/// The K-weighting's two stages at any sample rate (BS.1770's pre-filter and RLB high-pass, from their analogue
/// prototypes as libebur128 derives them — at 48 kHz they are BS.1770's published coefficients).
fn k_weighting(rate: f64) -> (Biquad, Biquad) {
    use std::f64::consts::PI;
    let (f0, g, q) = (1681.974450955533, 3.999843853973347, 0.7071752369554196);
    let k = (PI * f0 / rate).tan();
    let vh = 10f64.powf(g / 20.0);
    let vb = vh.powf(0.4996667741545416);
    let a0 = 1.0 + k / q + k * k;
    let shelf = Biquad::new(
        [(vh + vb * k / q + k * k) / a0, 2.0 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0],
        [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0],
    );
    let (f0, q) = (38.13547087602444, 0.5003270373238773);
    let k = (PI * f0 / rate).tan();
    let a0 = 1.0 + k / q + k * k;
    let hp = Biquad::new([1.0, -2.0, 1.0], [1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0]);
    (shelf, hp)
}

/// Taps per phase of the true-peak interpolator.
const TP_TAPS: usize = 48;

/// The 4× oversampling filter: a Kaiser-windowed sinc cut at the source's Nyquist, one set of taps per phase, each
/// normalised to unity gain. Phase p interpolates the point p/4 of a sample after `history[TP_TAPS/2 - 1]`.
fn tp_phases() -> [[f64; TP_TAPS]; 4] {
    fn bessel_i0(x: f64) -> f64 {
        let (mut sum, mut term) = (1.0, 1.0);
        for k in 1..50 {
            term *= (x / 2.0 / k as f64).powi(2);
            sum += term;
        }
        sum
    }
    let beta = 8.0;
    let half = TP_TAPS as f64 / 2.0;
    std::array::from_fn(|p| {
        let frac = p as f64 / 4.0;
        let mut taps: [f64; TP_TAPS] = std::array::from_fn(|i| {
            // distance from the interpolated point to tap i (tap half-1 is the sample just before it)
            let d = (i as f64 - (half - 1.0)) - frac;
            let sinc = if d.abs() < 1e-12 { 1.0 } else { (std::f64::consts::PI * d).sin() / (std::f64::consts::PI * d) };
            let w = (1.0 - (d / (half + 1.0)).powi(2)).max(0.0);
            sinc * bessel_i0(beta * w.sqrt()) / bessel_i0(beta)
        });
        let sum: f64 = taps.iter().sum();
        taps.iter_mut().for_each(|t| *t /= sum);
        taps
    })
}

/// An EBU R 128 meter over interleaved f32 samples.
pub struct Meter {
    channels: usize,
    filters: Vec<(Biquad, Biquad)>,
    /// samples in 100 ms
    sub_len: usize,
    sub_fill: usize,
    sub_energy: f64,
    /// the K-weighted energy of every finished 100 ms (summed over channels, not yet divided by its length)
    subs: Vec<f64>,
    phases: [[f64; TP_TAPS]; 4],
    /// the last TP_TAPS samples per channel, a ring
    history: Vec<[f64; TP_TAPS]>,
    at: usize,
    true_peak: f64,
    sample_peak: f64,
    samples: u64,
}

impl Meter {
    pub fn new(rate: u32, channels: usize) -> Self {
        let rate_f = rate as f64;
        Self {
            channels,
            filters: (0..channels).map(|_| k_weighting(rate_f)).collect(),
            sub_len: ((rate_f / 10.0).round() as usize).max(1),
            sub_fill: 0,
            sub_energy: 0.0,
            subs: Vec::new(),
            phases: tp_phases(),
            history: vec![[0.0; TP_TAPS]; channels],
            at: 0,
            true_peak: 0.0,
            sample_peak: 0.0,
            samples: 0,
        }
    }

    /// Frames of interleaved samples.
    pub fn push(&mut self, interleaved: &[f32]) {
        let ch = self.channels;
        for frame in interleaved.chunks_exact(ch) {
            let mut e = 0.0;
            for (c, &s) in frame.iter().enumerate() {
                let x = s as f64;
                let (a, b) = &mut self.filters[c];
                let y = b.run(a.run(x));
                // BS.1770 channel weights: 1 for left, right and centre (surround channels are not delivered here)
                e += y * y;
                self.sample_peak = self.sample_peak.max(x.abs());
                self.history[c][self.at] = x;
            }
            self.at = (self.at + 1) % TP_TAPS;
            // the true peak: the four points between the sample TP_TAPS/2 back and the one after it
            if self.samples >= TP_TAPS as u64 / 2 {
                let half = TP_TAPS / 2;
                for c in 0..ch {
                    let h = &self.history[c];
                    // the points between are only worth interpolating where the samples around them come within
                    // 3.5 dB of the peak so far: a band-limited point between samples rises at most ~3 dB over its
                    // neighbours (a sine at a quarter of the rate, 45° off the samples) — only contrived signals
                    // go further
                    let near = (half - 2..half + 2).map(|i| h[(self.at + i) % TP_TAPS].abs()).fold(0.0, f64::max);
                    if near * 1.5 < self.true_peak {
                        continue;
                    }
                    for taps in &self.phases {
                        let mut y = 0.0;
                        for (i, t) in taps.iter().enumerate() {
                            // tap 0 is the oldest sample in the ring
                            y += t * h[(self.at + i) % TP_TAPS];
                        }
                        self.true_peak = self.true_peak.max(y.abs());
                    }
                }
            }
            self.samples += 1;
            self.sub_energy += e;
            self.sub_fill += 1;
            if self.sub_fill == self.sub_len {
                self.subs.push(self.sub_energy);
                self.sub_energy = 0.0;
                self.sub_fill = 0;
            }
        }
    }

    /// Mean-square power of a window of `n` sub-blocks starting at `i`.
    fn power(&self, i: usize, n: usize) -> f64 {
        self.subs[i..i + n].iter().sum::<f64>() / (n * self.sub_len) as f64
    }

    pub fn result(&self) -> Loudness {
        let lufs_of = |p: f64| -0.691 + 10.0 * p.log10();
        // integrated: 400 ms blocks every 100 ms
        let blocks: Vec<f64> = if self.subs.len() >= 4 { (0..=self.subs.len() - 4).map(|i| self.power(i, 4)).collect() } else { vec![] };
        let gated = |ps: &[f64], rel_lu: f64| -> Vec<f64> {
            let abs: Vec<f64> = ps.iter().copied().filter(|&p| p > 0.0 && lufs_of(p) > -70.0).collect();
            if abs.is_empty() {
                return abs;
            }
            let rel = lufs_of(abs.iter().sum::<f64>() / abs.len() as f64) - rel_lu;
            abs.into_iter().filter(|&p| lufs_of(p) > rel).collect()
        };
        let g = gated(&blocks, 10.0);
        let lufs = (!g.is_empty()).then(|| lufs_of(g.iter().sum::<f64>() / g.len() as f64));
        // the loudness range: 3 s short-term loudness every 100 ms
        let shorts: Vec<f64> = if self.subs.len() >= 30 { (0..=self.subs.len() - 30).map(|i| self.power(i, 30)).collect() } else { vec![] };
        let mut s: Vec<f64> = gated(&shorts, 20.0).into_iter().map(lufs_of).collect();
        s.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let lra = (s.len() >= 2).then(|| {
            let at = |q: f64| s[((s.len() - 1) as f64 * q).round() as usize];
            at(0.95) - at(0.10)
        });
        let db = |x: f64| (x > 0.0).then(|| 20.0 * x.log10());
        Loudness { lufs, lra, true_peak: db(self.true_peak.max(self.sample_peak)), sample_peak: db(self.sample_peak) }
    }
}

/// Measure interleaved samples at once.
pub fn measure(interleaved: &[f32], rate: u32, channels: usize) -> Loudness {
    let mut m = Meter::new(rate, channels);
    m.push(interleaved);
    m.result()
}

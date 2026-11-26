import SwiftUI

// The web's default avatar (`web-foldkit/src/ui/dither-avatar.ts`, `avatar-seed-tint`): a Bayer
// dithered diagonal ramp between two tones of a hue picked by hashing the name.
enum Dither {
    /// OKLCH hues the seed picks from, brand purple first (the web's `HUES`).
    static let hues: [Double] = [285, 255, 215, 165, 85, 45, 15, 330]

    /// The web's `stringHash`: JavaScript's 32-bit `(h << 5) - h + code` over UTF-16 units, absolute.
    static func hash(_ seed: String) -> Int {
        var hash: Int32 = 0
        for unit in seed.utf16 { hash = (hash &<< 5) &- hash &+ Int32(unit) }
        return Int(abs(Int64(hash)))
    }

    static func hue(_ seed: String) -> Double { hues[hash(seed) % hues.count] }

    /// The grid: 1pt cells up to 24pt, 2pt above, at least 8 (the web's `cells`).
    static func cells(_ size: CGFloat) -> Int {
        max(8, Int((size <= 24 ? size : size / 2).rounded()))
    }

    private static let bayer4: [[Int]] = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    private static let bayer2: [[Int]] = [[0, 2], [3, 1]]

    /// Whether cell (x, y) of an n-by-n grid is lit: the ramp, brightest at the top left, against the
    /// 8x8 threshold built from the 4x4 and 2x2 matrices.
    static func lit(_ x: Int, _ y: Int, _ n: Int) -> Bool {
        let span = Double(max(1, 2 * (n - 1)))
        let threshold = (Double(4 * bayer4[y % 4][x % 4] + bayer2[(y >> 2) & 1][(x >> 2) & 1]) + 0.5) / 64
        return (1 - Double(x + y) / span) * 1.05 - 0.05 > threshold
    }

    /// `oklch(l c h)` in sRGB, clamped to the gamut.
    static func oklch(_ l: Double, _ c: Double, _ h: Double) -> Color {
        let a = c * cos(h * .pi / 180), b = c * sin(h * .pi / 180)
        let l_ = l + 0.3963377774 * a + 0.2158037573 * b
        let m_ = l - 0.1055613458 * a - 0.0638541728 * b
        let s_ = l - 0.0894841775 * a - 1.2914855480 * b
        let (lc, mc, sc) = (l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_)
        let linear = [
            4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
            -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
            -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc,
        ]
        let srgb = linear.map { v -> Double in
            let x = min(1, max(0, v))
            return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1 / 2.4) - 0.055
        }
        return Color(.sRGB, red: srgb[0], green: srgb[1], blue: srgb[2])
    }
}

/// The dithered square for `seed` at `side` points, filling its frame (the caller clips the shape).
struct DitherFill: View {
    let seed: String
    let side: CGFloat

    var body: some View {
        let hue = Dither.hue(seed), n = Dither.cells(side)
        let dark = Dither.oklch(0.4, 0.13, hue), light = Dither.oklch(0.55, 0.12, hue)
        Canvas { context, size in
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(dark))
            let cell = CGSize(width: size.width / CGFloat(n), height: size.height / CGFloat(n))
            var lit = Path()
            for y in 0..<n {
                for x in 0..<n where Dither.lit(x, y, n) {
                    lit.addRect(CGRect(x: CGFloat(x) * cell.width, y: CGFloat(y) * cell.height, width: cell.width, height: cell.height))
                }
            }
            context.fill(lit, with: .color(light))
        }
        .accessibilityHidden(true)
    }
}

//! Pictures: `<img src>`, CSS `background-image: url(..)` and multi-colour inline SVGs, decoded
//! off the main thread by Rune's `ImageCache`. Rune has no HTTP client on native, so http(s)
//! sources are fetched by `curl` on a worker thread and redrawn when they land.
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use base64::Engine;
use rune::{Image, ImageCache, Waker};

/// Device pixels per point the images rasterize at (Retina).
const SCALE: f32 = 2.0;

static CACHE: OnceLock<Arc<ImageCache>> = OnceLock::new();
/// The app's public assets, where a root-relative `src` is found (the shell's bundle).
static ASSETS: OnceLock<std::path::PathBuf> = OnceLock::new();

/// Where root-relative sources (`/logo.svg`) are found unless `HAZEL_ASSET_ROOT` says otherwise.
pub fn set_assets_root(root: std::path::PathBuf) {
    let _ = ASSETS.set(root);
}
static WAKER: OnceLock<Waker> = OnceLock::new();
/// A downloaded http(s) source, by URL: fetched once, whatever sizes draw it.
enum Fetched {
    Pending,
    Failed,
    /// A bitmap decodes once; it scales like any picture.
    Picture(Image),
    /// An SVG keeps its bytes and rasterizes once per size it is drawn at.
    Svg(Arc<Vec<u8>>),
}

static REMOTE: Mutex<Option<HashMap<String, Fetched>>> = Mutex::new(None);
/// Remote SVGs rasterized, by URL and drawn size in points.
static REMOTE_SVGS: Mutex<Option<HashMap<(String, u32), Image>>> = Mutex::new(None);
/// A remote image arrived since the view last ran; the next frame must rebuild memoised subtrees.
static ARRIVED: AtomicBool = AtomicBool::new(false);

/// The window's waker, so a finished decode or download redraws it. Without one (capture,
/// tests) the frame loop runs anyway.
pub fn set_waker(waker: Waker) {
    let _ = WAKER.set(waker);
}

fn wake() {
    if let Some(w) = WAKER.get() {
        w()
    }
}

fn cache() -> &'static Arc<ImageCache> {
    CACHE.get_or_init(|| Arc::new(ImageCache::new(Arc::new(wake))))
}

/// Whether a remote image arrived since the last call (the view should rebuild).
pub fn take_arrived() -> bool {
    ARRIVED.swap(false, Ordering::SeqCst)
}

/// Pictures a thread waits on to rebuild the view once they decode, by image id.
static AWAITED: Mutex<Option<std::collections::HashSet<rune::ImageId>>> = Mutex::new(None);

/// Rebuilds the memoised subtrees once `image` has decoded, for a box sized from the picture's
/// own size. A decode wakes the window to redraw, but a memoised row is not rebuilt by a
/// redraw, so a row built while its picture decoded would keep its empty box. A picture that
/// failed to decode stays empty and asks for nothing.
pub fn rebuild_when_ready(image: &Image) {
    if image.is_ready() {
        // The decode finished after the caller found no size: that build drew the empty box.
        if image.error().is_none() {
            arrived();
        }
        return;
    }
    let mut awaited = AWAITED.lock().unwrap();
    if !awaited
        .get_or_insert_with(Default::default)
        .insert(image.id())
    {
        return;
    }
    drop(awaited);
    let image = image.clone();
    std::thread::spawn(move || {
        let decoded = image.wait().is_ok();
        if let Some(set) = AWAITED.lock().unwrap().as_mut() {
            set.remove(&image.id());
        }
        if decoded {
            arrived();
        }
    });
}

/// A picture landed: the next frame rebuilds the memoised subtrees.
fn arrived() {
    ARRIVED.store(true, Ordering::SeqCst);
    wake();
}

/// A picture composited with its mask, by what was asked for: the size it was last asked at,
/// and the latest finished one (shown while a new size composites).
struct Masked {
    size: (u32, u32),
    image: Option<Image>,
}

static MASKED: Mutex<Option<HashMap<String, Masked>>> = Mutex::new(None);

/// Whether `src` is read from here (a `data:` URL or a file), not fetched.
pub fn is_local(src: &str) -> bool {
    !(src.starts_with("http://") || src.starts_with("https://"))
}

/// The bytes of a picture the host can read at once: a `data:` URL or a file among the app's
/// public assets. `None` for an http(s) source, which arrives later.
fn local_bytes(src: &str) -> Option<Vec<u8>> {
    if let Some(rest) = src.strip_prefix("data:") {
        return decode_data_url(rest).map(|(_, bytes)| bytes);
    }
    std::fs::read(local_path(src)?).ok()
}

/// `src` as a file: a path, else one relative to the app's public assets (`HAZEL_ASSET_ROOT`, or
/// the shell's `set_assets_root`).
fn local_path(src: &str) -> Option<std::path::PathBuf> {
    if !is_local(src) {
        return None;
    }
    let path = std::path::PathBuf::from(src.strip_prefix("file://").unwrap_or(src));
    let root = std::env::var_os("HAZEL_ASSET_ROOT")
        .map(std::path::PathBuf::from)
        .or_else(|| ASSETS.get().cloned());
    let path = match root {
        Some(root) if !path.exists() => root.join(src.trim_start_matches('/')),
        _ => path,
    };
    path.is_file().then_some(path)
}

/// `picture` as CSS draws it in a `w` by `h` box under a mask: fitted by `object-fit`, its alpha
/// scaled by the mask picture's (centred, `share` of the box, nothing outside it) and by the
/// edges that fade (`fade`: left top right bottom, each a share of the box). Straight RGBA rows.
pub fn composite(
    picture: &image::RgbaImage,
    mask: Option<(&image::RgbaImage, [f32; 2])>,
    fade: [f32; 4],
    (w, h): (u32, u32),
    fit: Option<&str>,
) -> Vec<u8> {
    use image::imageops::{FilterType, crop_imm, overlay, resize};
    let (pw, ph) = (picture.width() as f32, picture.height() as f32);
    let (bw, bh) = (w as f32, h as f32);
    let mut out = match fit {
        Some("cover") => {
            // The middle of the picture with the box's shape, scaled to fill it.
            let scale = (bw / pw).max(bh / ph);
            let (cw, ch) = ((bw / scale).min(pw), (bh / scale).min(ph));
            let (x, y) = ((pw - cw) / 2.0, (ph - ch) / 2.0);
            let crop = crop_imm(
                picture,
                x as u32,
                y as u32,
                cw.max(1.0) as u32,
                ch.max(1.0) as u32,
            );
            resize(&crop.to_image(), w, h, FilterType::Triangle)
        }
        Some("contain" | "scale-down" | "none") => {
            let scale = (bw / pw).min(bh / ph);
            let (dw, dh) = ((pw * scale).round().max(1.0), (ph * scale).round().max(1.0));
            let fitted = resize(picture, dw as u32, dh as u32, FilterType::Triangle);
            let mut canvas = image::RgbaImage::new(w, h);
            let (x, y) = ((bw - dw) / 2.0, (bh - dh) / 2.0);
            overlay(&mut canvas, &fitted, x as i64, y as i64);
            canvas
        }
        _ => resize(picture, w, h, FilterType::Triangle),
    };
    let shape = mask.map(|(mask, [sw, sh])| {
        let (mw, mh) = ((bw * sw).round().max(1.0), (bh * sh).round().max(1.0));
        let scaled = resize(mask, mw as u32, mh as u32, FilterType::Triangle);
        (
            scaled,
            ((bw - mw) / 2.0).round() as i64,
            ((bh - mh) / 2.0).round() as i64,
        )
    });
    // A linear ramp from the edge: whole once `share` of the box in from it.
    let ramp = |at: f32, share: f32| {
        if share > 0.0 {
            (at / share).clamp(0.0, 1.0)
        } else {
            1.0
        }
    };
    for (x, y, pixel) in out.enumerate_pixels_mut() {
        let (fx, fy) = ((x as f32 + 0.5) / bw, (y as f32 + 0.5) / bh);
        let mut alpha = ramp(fx, fade[0])
            * ramp(fy, fade[1])
            * ramp(1.0 - fx, fade[2])
            * ramp(1.0 - fy, fade[3]);
        if let Some((mask, ox, oy)) = &shape {
            let (mx, my) = (x as i64 - ox, y as i64 - oy);
            let inside =
                mx >= 0 && my >= 0 && mx < mask.width() as i64 && my < mask.height() as i64;
            alpha *= if inside {
                mask.get_pixel(mx as u32, my as u32)[3] as f32 / 255.0
            } else {
                0.0
            };
        }
        pixel[3] = (pixel[3] as f32 * alpha).round() as u8;
    }
    out.into_raw()
}

/// Decoded images by source, kept alive while the app may draw them.
#[derive(Default)]
pub struct Images {
    loaded: RefCell<HashMap<String, Image>>,
}

impl Images {
    /// The image at `src` (data:, file:, a path, or http(s)), rasterized for `size_pt` when it
    /// is an SVG. `None` while a download is in flight or when the source cannot load.
    pub fn get(&self, src: &str, size_pt: f32) -> Option<Image> {
        let size_pt = size_pt.clamp(8.0, 1024.0);
        let key = format!("{size_pt}|{src}");
        if let Some(image) = self.loaded.borrow().get(&key) {
            return Some(image.clone());
        }
        let image = if let Some(rest) = src.strip_prefix("data:") {
            let (mime, bytes) = decode_data_url(rest)?;
            cache().load_mime(bytes, &mime, size_pt, SCALE)
        } else if src.starts_with("http://") || src.starts_with("https://") {
            remote(src, size_pt)?
        } else {
            cache().file(local_path(src)?, size_pt, SCALE)
        };
        self.loaded.borrow_mut().insert(key, image.clone());
        Some(image)
    }

    /// The picture at `src` as it shows under `mask` in a box `size` points big (CSS
    /// `mask-image` on an `<img>`), composited off the main thread. `None` until the first one
    /// is ready, or when the picture or its mask picture cannot be read here (an http(s) one).
    pub fn masked(
        &self,
        src: &str,
        mask: &crate::wire::Mask,
        size: [f32; 2],
        fit: Option<&str>,
    ) -> Option<Image> {
        let px = |v: f32| (v * SCALE).round().clamp(1.0, 4096.0) as u32;
        let size = (px(size[0]), px(size[1]));
        let key = format!("{src}|{mask:?}|{fit:?}");
        let mut masked = MASKED.lock().unwrap();
        let map = masked.get_or_insert_with(HashMap::new);
        if let Some(entry) = map.get_mut(&key) {
            if entry.size == size {
                return entry.image.clone();
            }
            entry.size = size;
        } else {
            map.insert(key.clone(), Masked { size, image: None });
        }
        let shown = map.get(&key).and_then(|entry| entry.image.clone());
        drop(masked);
        let (src, mask, fit) = (src.to_string(), mask.clone(), fit.map(str::to_string));
        std::thread::spawn(move || {
            let decode = |src: &str| {
                let bytes = local_bytes(src)?;
                Some(image::load_from_memory(&bytes).ok()?.to_rgba8())
            };
            let Some(picture) = decode(&src) else { return };
            let shape = match &mask.image {
                Some(m) => match decode(&m.url) {
                    Some(shape) => Some((shape, [m.w.0, m.h.0])),
                    None => return,
                },
                None => None,
            };
            let fade = mask.fade.map_or([0.0; 4], |f| f.map(|v| v.0));
            let rgba = composite(
                &picture,
                shape.as_ref().map(|(shape, share)| (shape, *share)),
                fade,
                size,
                fit.as_deref(),
            );
            let image = cache().rgba(size.0, size.1, rgba);
            // A newer size asked for since then composites on its own thread; keep that one.
            if let Some(entry) = MASKED
                .lock()
                .unwrap()
                .as_mut()
                .and_then(|m| m.get_mut(&key))
                && entry.size == size
            {
                entry.image = Some(image);
                ARRIVED.store(true, Ordering::SeqCst);
                wake();
            }
        });
        shown
    }

    /// An inline SVG drawn in its own colours (not tinted like an icon).
    pub fn svg(&self, view: f32, body: &str, size_pt: f32) -> Image {
        let size_pt = size_pt.clamp(8.0, 1024.0);
        let markup = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {view} {view}\" preserveAspectRatio=\"none\">{}</svg>",
            replace_oklch(body)
        );
        let key = format!("{size_pt}|svg|{markup}");
        if let Some(image) = self.loaded.borrow().get(&key) {
            return image.clone();
        }
        let image = cache().svg(markup.into_bytes(), size_pt, SCALE);
        self.loaded.borrow_mut().insert(key, image.clone());
        image
    }
}

/// Starts (once) the download of `url`; the image at `size_pt` once it has arrived.
fn remote(url: &str, size_pt: f32) -> Option<Image> {
    let mut remote = REMOTE.lock().unwrap();
    let map = remote.get_or_insert_with(HashMap::new);
    match map.get(url) {
        Some(Fetched::Picture(image)) => return Some(image.clone()),
        Some(Fetched::Svg(bytes)) => {
            let bytes = bytes.clone();
            drop(remote);
            return Some(remote_svg(url, &bytes, size_pt));
        }
        Some(Fetched::Pending | Fetched::Failed) => return None,
        None => {}
    }
    map.insert(url.to_string(), Fetched::Pending);
    let url = url.to_string();
    std::thread::spawn(move || {
        let output = std::process::Command::new("curl")
            .args(["-sfL", "--max-time", "15", "--", &url])
            .output();
        let fetched = match output {
            Ok(out) if out.status.success() && !out.stdout.is_empty() => {
                if url.ends_with(".svg") || out.stdout.starts_with(b"<svg") {
                    Fetched::Svg(Arc::new(out.stdout))
                } else {
                    Fetched::Picture(cache().load(out.stdout))
                }
            }
            _ => Fetched::Failed,
        };
        let failed = matches!(fetched, Fetched::Failed);
        if let Some(map) = REMOTE.lock().unwrap().as_mut() {
            map.insert(url, fetched);
        }
        if !failed {
            ARRIVED.store(true, Ordering::SeqCst);
            wake();
        }
    });
    None
}

fn remote_svg(url: &str, bytes: &Arc<Vec<u8>>, size_pt: f32) -> Image {
    let key = (url.to_string(), size_pt.to_bits());
    let mut svgs = REMOTE_SVGS.lock().unwrap();
    let map = svgs.get_or_insert_with(HashMap::new);
    map.entry(key)
        .or_insert_with(|| cache().svg(bytes.to_vec(), size_pt, SCALE))
        .clone()
}

/// `[mime][;base64],payload` into its MIME type and bytes.
pub fn decode_data_url(rest: &str) -> Option<(String, Vec<u8>)> {
    let (meta, payload) = rest.split_once(',')?;
    let is_base64 = meta.ends_with(";base64");
    let mime = meta.trim_end_matches(";base64").to_string();
    let bytes = if is_base64 {
        let clean: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
        base64::engine::general_purpose::STANDARD
            .decode(clean.trim_end_matches('='))
            .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(&clean))
            .or_else(|_| base64::engine::general_purpose::STANDARD.decode(&clean))
            .ok()?
    } else {
        percent_decode(payload)
    };
    Some((
        if mime.is_empty() {
            "text/plain".into()
        } else {
            mime
        },
        bytes,
    ))
}

fn percent_decode(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(v) = s
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
        {
            out.push(v);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

/// Whether an SVG body paints in its own colours rather than `currentColor`.
pub fn is_multicolour(body: &str) -> bool {
    if body.contains("currentColor") {
        return false;
    }
    ["fill=\"", "stroke=\""].iter().any(|attr| {
        body.match_indices(attr).any(|(at, _)| {
            let value = &body[at + attr.len()..];
            !value.starts_with("none\"") && !value.starts_with('"')
        })
    })
}

/// resvg reads hex and `rgb()`; CSS Color 4 `oklch(L C H [/ A])` becomes hex here.
pub fn replace_oklch(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(at) = rest.find("oklch(") {
        out.push_str(&rest[..at]);
        let after = &rest[at + 6..];
        let Some(end) = after.find(')') else {
            out.push_str(&rest[at..]);
            return out;
        };
        match oklch_hex(&after[..end]) {
            Some(hex) => out.push_str(&hex),
            None => out.push_str(&rest[at..at + 6 + end + 1]),
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

/// `L C H [/ A]` (L as 0..1 or a percentage, H in degrees) to `#rrggbb` or `#rrggbbaa`.
pub fn oklch_hex(args: &str) -> Option<String> {
    let (lch, alpha) = match args.split_once('/') {
        Some((a, b)) => (a, Some(b.trim())),
        None => (args, None),
    };
    let parts: Vec<&str> = lch.split_whitespace().collect();
    let [l, c, h] = parts.as_slice() else {
        return None;
    };
    let num = |s: &str| -> Option<f32> {
        match s.strip_suffix('%') {
            Some(p) => p.parse::<f32>().ok().map(|v| v / 100.0),
            None => s.trim_end_matches("deg").parse().ok(),
        }
    };
    let (l, c, h) = (num(l)?, num(c)?, num(h)?.to_radians());
    let (a, b) = (c * h.cos(), c * h.sin());
    let l_ = l + 0.396_337_78 * a + 0.215_803_76 * b;
    let m_ = l - 0.105_561_346 * a - 0.063_854_17 * b;
    let s_ = l - 0.089_484_18 * a - 1.291_485_5 * b;
    let (lc, mc, sc) = (l_.powi(3), m_.powi(3), s_.powi(3));
    let linear = [
        4.076_741_7 * lc - 3.307_711_6 * mc + 0.230_969_94 * sc,
        -1.268_438 * lc + 2.609_757_4 * mc - 0.341_319_38 * sc,
        -0.004_196_086_3 * lc - 0.703_418_6 * mc + 1.707_614_7 * sc,
    ];
    let channel = |x: f32| {
        let x = x.clamp(0.0, 1.0);
        let v = if x <= 0.003_130_8 {
            12.92 * x
        } else {
            1.055 * x.powf(1.0 / 2.4) - 0.055
        };
        (v * 255.0).round() as u8
    };
    let [r, g, b] = linear.map(channel);
    let alpha = alpha
        .and_then(num)
        .map(|a| (a.clamp(0.0, 1.0) * 255.0).round() as u8);
    Some(match alpha {
        Some(a) if a < 255 => format!("#{r:02x}{g:02x}{b:02x}{a:02x}"),
        _ => format!("#{r:02x}{g:02x}{b:02x}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oklch_converts_to_srgb_hex() {
        assert_eq!(oklch_hex("1 0 0").as_deref(), Some("#ffffff"));
        assert_eq!(oklch_hex("0 0 0").as_deref(), Some("#000000"));
        // Tailwind's red-500 is oklch(63.7% 0.237 25.331) = #fb2c36.
        let red = oklch_hex("63.7% 0.237 25.331").unwrap();
        let channel = |i: usize| u8::from_str_radix(&red[i..i + 2], 16).unwrap() as i32;
        assert!(
            (channel(1) - 0xfb).abs() <= 2 && (channel(3) - 0x2c).abs() <= 3,
            "{red}"
        );
        assert_eq!(oklch_hex("1 0 0 / 0.5").as_deref(), Some("#ffffff80"));
    }

    #[test]
    fn svg_bodies_with_their_own_fills_are_multicolour() {
        assert!(is_multicolour(
            r#"<path d="M0 0h1v1z" fill="oklch(0.5 0.1 285)"/>"#
        ));
        assert!(!is_multicolour(r#"<path fill="currentColor" d="M0 0"/>"#));
        assert!(!is_multicolour(r#"<path d="M0 0"/>"#));
        assert!(!is_multicolour(
            r#"<path fill="none" stroke="currentColor"/>"#
        ));
        assert_eq!(
            replace_oklch(r#"<p fill="oklch(1 0 0)"/>"#),
            r##"<p fill="#ffffff"/>"##
        );
    }

    #[test]
    fn a_downloaded_svg_rasterizes_at_each_size_it_is_drawn() {
        let file = std::env::temp_dir().join(format!("hazel-remote-{}.svg", std::process::id()));
        std::fs::write(
            &file,
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="red"/></svg>"#,
        )
        .unwrap();
        let url = format!("file://{}", file.display());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let small = loop {
            if let Some(image) = remote(&url, 16.0) {
                break image;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "the download never landed"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        let large = remote(&url, 64.0).expect("already downloaded");
        let (small, large) = (small.wait().unwrap(), large.wait().unwrap());
        assert!(large[0] > small[0] * 3, "{small:?} {large:?}");
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn data_urls_decode_base64_and_percent_payloads() {
        let (mime, bytes) = decode_data_url("image/png;base64,iVBORw0K").unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(&bytes[..4], b"\x89PNG");
        let (mime, bytes) = decode_data_url("image/svg+xml,%3Csvg%3E").unwrap();
        assert_eq!(mime, "image/svg+xml");
        assert_eq!(bytes, b"<svg>");
    }
}

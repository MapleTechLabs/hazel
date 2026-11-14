//! Pictures: `<img src>`, CSS `background-image: url(..)` and multi-colour inline SVGs, decoded
//! off the main thread by Rune's `ImageCache`. Rune has no HTTP client on native, so http(s)
//! sources are fetched with the system's (`fetch`) on a few worker threads, and the elements that
//! drew an empty box for them are rebuilt when they land.
//!
//! Every cache here is bounded (least recently used goes first) and keyed by a hash of its
//! source, never by the source itself, which may be a multi-megabyte `data:` URL. Dropping an
//! entry never blanks an element: Rune's cache is content-addressed and keeps a picture alive
//! while any element draws it, so asking again hands back the same one.
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, OnceLock, mpsc};
use std::time::{Duration, Instant};

use base64::Engine;
use rune::{Image, ImageCache, ImageId, Waker};

/// Device pixels per point the images rasterize at (Retina).
const SCALE: f32 = 2.0;
/// How long a failed download stays failed before a build asks for it again.
const RETRY_AFTER: Duration = Duration::from_secs(60);
/// Threads downloads and mask composites share.
const WORKERS: usize = 4;
/// Pictures a window keeps handles on, by source and size.
const LOADED_ENTRIES: usize = 512;
/// Downloaded bytes kept (encoded, as fetched), and how many downloads.
const REMOTE_BYTES: usize = 64 << 20;
const REMOTE_ENTRIES: usize = 1024;
/// Mask composites kept, and their pixels.
const MASKED_ENTRIES: usize = 128;
const MASKED_BYTES: usize = 128 << 20;
/// Decoded pictures and mask pictures kept for compositing at a new size.
const SOURCES_BYTES: usize = 64 << 20;
const SOURCES_ENTRIES: usize = 64;
/// Element paths whose memos a landed picture made stale, before they are all dropped at once.
const STALE_PATHS: usize = 4096;

static CACHE: OnceLock<Arc<ImageCache>> = OnceLock::new();
/// The app's public assets, where a root-relative `src` is found (the shell's bundle).
static ASSETS: OnceLock<std::path::PathBuf> = OnceLock::new();

/// Where root-relative sources (`/logo.svg`) are found unless `HAZEL_ASSET_ROOT` says otherwise.
pub fn set_assets_root(root: std::path::PathBuf) {
    let _ = ASSETS.set(root);
}
static WAKER: OnceLock<Waker> = OnceLock::new();

/// A downloaded http(s) source, by URL: fetched once, whatever sizes draw it. Its bytes are
/// kept encoded; Rune's cache decodes them, once for as long as anything draws the picture.
enum Fetched {
    Pending,
    /// When it failed: asked for again after `RETRY_AFTER`.
    Failed(Instant),
    /// A bitmap; it scales like any picture.
    Picture(Arc<[u8]>),
    /// An SVG rasterizes once per size it is drawn at.
    Svg(Arc<[u8]>),
}

static REMOTE: LazyLock<Mutex<Lru<String, Fetched>>> =
    LazyLock::new(|| Mutex::new(Lru::new(REMOTE_ENTRIES, REMOTE_BYTES)));
/// A remote picture or a composite landed since `take_arrived` last looked.
static ARRIVED: AtomicBool = AtomicBool::new(false);
/// Decodes some box's size waits on (`Images::await_decode`), for `take_arrived`.
static DECODING: Mutex<Vec<Image>> = Mutex::new(Vec::new());

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

/// Whether any picture landed (a download, a composite, an awaited decode) since the last call:
/// for a shell that rebuilds the whole view then. `poll` rebuilds only what waited on one.
pub fn take_arrived() -> bool {
    let mut decoded = false;
    DECODING.lock().unwrap().retain(|image| {
        let ready = image.is_ready();
        decoded |= ready && image.error().is_none();
        !ready
    });
    ARRIVED.swap(false, Ordering::SeqCst) | decoded
}

/// A picture landed: the next frame rebuilds what waited on it.
fn arrived() {
    ARRIVED.store(true, Ordering::SeqCst);
    wake();
}

/// Runs `job` on one of a few shared background threads: downloads and composites queue there
/// rather than each taking a thread. A job that panics (a malformed picture) loses only itself.
fn background(job: impl FnOnce() + Send + 'static) {
    type Job = Box<dyn FnOnce() + Send>;
    static JOBS: OnceLock<mpsc::Sender<Job>> = OnceLock::new();
    let jobs = JOBS.get_or_init(|| {
        let (send, receive) = mpsc::channel::<Job>();
        let receive = Arc::new(Mutex::new(receive));
        for _ in 0..WORKERS {
            let receive = receive.clone();
            std::thread::Builder::new()
                .name("hazel-images".into())
                .spawn(move || {
                    loop {
                        let job = receive.lock().unwrap_or_else(|e| e.into_inner()).recv();
                        let Ok(job) = job else { return };
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
                    }
                })
                .expect("image worker");
        }
        send
    });
    let _ = jobs.send(Box::new(job));
}

/// A hash of what a cache entry was made from.
fn key(of: impl Hash) -> u64 {
    let mut hasher = DefaultHasher::new();
    of.hash(&mut hasher);
    hasher.finish()
}

/// A map that keeps at most `max_entries` entries and `max_weight` of their total weight (bytes,
/// say), dropping the least recently used first. An entry `keep` says to hold is never dropped.
pub(crate) struct Lru<K, V> {
    entries: HashMap<K, (V, u64, usize)>,
    tick: u64,
    weight: usize,
    max_entries: usize,
    max_weight: usize,
}

impl<K: Hash + Eq + Clone, V> Lru<K, V> {
    pub(crate) fn new(max_entries: usize, max_weight: usize) -> Self {
        Lru {
            entries: HashMap::new(),
            tick: 0,
            weight: 0,
            max_entries,
            max_weight,
        }
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    /// The entry at `key`, now the most recently used.
    pub(crate) fn get(&mut self, key: &K) -> Option<&mut V> {
        self.tick += 1;
        let tick = self.tick;
        self.entries.get_mut(key).map(|(value, used, _)| {
            *used = tick;
            value
        })
    }

    /// The entry at `key`, its use not counted.
    pub(crate) fn peek(&self, key: &K) -> Option<&V> {
        self.entries.get(key).map(|(value, ..)| value)
    }

    /// Puts `value` at `key`, then drops the least recently used entries `keep` lets go of
    /// until the map is within its bounds.
    pub(crate) fn insert(&mut self, key: K, value: V, weight: usize, keep: impl Fn(&V) -> bool) {
        self.tick += 1;
        if let Some((_, _, old)) = self.entries.insert(key.clone(), (value, self.tick, weight)) {
            self.weight -= old;
        }
        self.weight += weight;
        while self.entries.len() > self.max_entries || self.weight > self.max_weight {
            let oldest = self
                .entries
                .iter()
                .filter(|(k, (v, ..))| **k != key && !keep(v))
                .min_by_key(|(_, (_, used, _))| *used)
                .map(|(k, _)| k.clone());
            let Some(oldest) = oldest else { break };
            if let Some((_, _, w)) = self.entries.remove(&oldest) {
                self.weight -= w;
            }
        }
    }
}

/// What a build drew an empty (or stale) box for, to rebuild once it lands.
#[derive(Clone, PartialEq, Eq, Hash)]
enum Awaited {
    /// A download, by URL.
    Download(String),
    /// A mask composite, by its key, at a size in pixels.
    Composite(u64, (u32, u32)),
    /// A decode the box's size waits on.
    Decode(ImageId),
}

/// The element paths waiting on one picture, and the picture when it is a decode.
struct Waiter {
    paths: HashSet<String>,
    image: Option<Image>,
}

/// A picture composited with its mask: the size last asked for, and the latest finished one
/// (shown while a new size composites).
struct Masked {
    asked: (u32, u32),
    made: Option<((u32, u32), Image)>,
    /// The picture or its mask picture would not decode at `asked`.
    failed: bool,
}

static MASKED: LazyLock<Mutex<Lru<u64, Masked>>> =
    LazyLock::new(|| Mutex::new(Lru::new(MASKED_ENTRIES, MASKED_BYTES)));
/// Pictures and mask pictures decoded to composite, by source: a new box size only
/// recomposites.
static SOURCES: LazyLock<Mutex<Lru<u64, Arc<image::RgbaImage>>>> =
    LazyLock::new(|| Mutex::new(Lru::new(SOURCES_ENTRIES, SOURCES_BYTES)));

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

/// The picture at local `src` decoded to RGBA, once while it stays in use.
fn decoded_source(src: &str) -> Option<Arc<image::RgbaImage>> {
    let id = key(src);
    if let Some(found) = SOURCES.lock().unwrap().get(&id) {
        return Some(found.clone());
    }
    let decoded = Arc::new(image::load_from_memory(&local_bytes(src)?).ok()?.to_rgba8());
    let bytes = decoded.as_raw().len();
    SOURCES
        .lock()
        .unwrap()
        .insert(id, decoded.clone(), bytes, |_| false);
    Some(decoded)
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

/// A window's pictures: handles on those it drew, by source and size, and the elements waiting
/// on one still to land.
pub struct Images {
    loaded: RefCell<Lru<u64, Image>>,
    waiting: RefCell<HashMap<Awaited, Waiter>>,
    /// Element paths whose memos a landed picture made stale, by when it landed.
    stale: HashMap<String, u64>,
    landings: u64,
}

impl Default for Images {
    fn default() -> Self {
        Images {
            loaded: RefCell::new(Lru::new(LOADED_ENTRIES, usize::MAX)),
            waiting: RefCell::default(),
            stale: HashMap::new(),
            landings: 0,
        }
    }
}

impl Images {
    /// The image at `src` (data:, file:, a path, or http(s)), rasterized for `size_pt` when it
    /// is an SVG. `None` while a download is in flight or when the source cannot load; the
    /// element at `path` is rebuilt once the download lands.
    pub fn get(&self, src: &str, size_pt: f32, path: &str) -> Option<Image> {
        let size_pt = size_pt.clamp(8.0, 1024.0);
        let id = key((size_pt.to_bits(), src));
        if let Some(image) = self.loaded.borrow_mut().get(&id) {
            return Some(image.clone());
        }
        let image = if let Some(rest) = src.strip_prefix("data:") {
            let (mime, bytes) = decode_data_url(rest)?;
            cache().load_mime(bytes, &mime, size_pt, SCALE)
        } else if !is_local(src) {
            let Some(image) = remote(src, size_pt) else {
                self.wait(Awaited::Download(src.to_string()), path, None);
                return None;
            };
            image
        } else {
            cache().file(local_path(src)?, size_pt, SCALE)
        };
        self.loaded
            .borrow_mut()
            .insert(id, image.clone(), 1, |_| false);
        Some(image)
    }

    /// The picture at `src` as it shows under `mask` in a box `size` points big (CSS
    /// `mask-image` on an `<img>`), composited off the main thread. `None` until the first one
    /// is ready, or when the picture or its mask picture cannot be read here (an http(s) one).
    /// The element at `path` is rebuilt once the composite at this size lands.
    pub fn masked(
        &self,
        src: &str,
        mask: &crate::wire::Mask,
        size: [f32; 2],
        fit: Option<&str>,
        path: &str,
    ) -> Option<Image> {
        let px = |v: f32| (v * SCALE).round().clamp(1.0, 4096.0) as u32;
        let size = (px(size[0]), px(size[1]));
        let id = key((src, mask, fit));
        let mut masked = MASKED.lock().unwrap();
        let shown = match masked.get(&id) {
            Some(entry) => {
                if let Some((made, image)) = &entry.made
                    && *made == size
                {
                    return Some(image.clone());
                }
                let shown = entry.made.as_ref().map(|(_, image)| image.clone());
                if entry.asked == size {
                    // Already compositing at this size (or it failed): wait, or show what there is.
                    if !entry.failed {
                        self.wait(Awaited::Composite(id, size), path, None);
                    }
                    return shown;
                }
                entry.asked = size;
                entry.failed = false;
                shown
            }
            None => {
                let entry = Masked {
                    asked: size,
                    made: None,
                    failed: false,
                };
                masked.insert(id, entry, 0, |_| false);
                None
            }
        };
        drop(masked);
        self.wait(Awaited::Composite(id, size), path, None);
        let (src, mask, fit) = (src.to_string(), mask.clone(), fit.map(str::to_string));
        background(move || {
            // A newer size asked for since this was queued composites on its own.
            let wanted =
                |masked: &Lru<u64, Masked>| masked.peek(&id).is_some_and(|e| e.asked == size);
            if !wanted(&MASKED.lock().unwrap()) {
                return;
            }
            let picture = decoded_source(&src);
            let shape = match &mask.image {
                Some(m) => decoded_source(&m.url).map(|shape| Some((shape, [m.w.0, m.h.0]))),
                None => Some(None),
            };
            let (Some(picture), Some(shape)) = (picture, shape) else {
                if let Some(entry) = MASKED.lock().unwrap().get(&id)
                    && entry.asked == size
                {
                    entry.failed = true;
                }
                return;
            };
            let fade = mask.fade.map_or([0.0; 4], |f| f.map(|v| v.0));
            let rgba = composite(
                &picture,
                shape
                    .as_ref()
                    .map(|(shape, share)| (shape.as_ref(), *share)),
                fade,
                size,
                fit.as_deref(),
            );
            let image = cache().rgba(size.0, size.1, rgba);
            let mut masked = MASKED.lock().unwrap();
            if !wanted(&masked) {
                return;
            }
            let bytes = (size.0 * size.1 * 4) as usize;
            let entry = Masked {
                asked: size,
                made: Some((size, image)),
                failed: false,
            };
            masked.insert(id, entry, bytes, |_| false);
            drop(masked);
            arrived();
        });
        shown
    }

    /// An inline SVG drawn in its own colours (not tinted like an icon).
    pub fn svg(&self, view: f32, body: &str, size_pt: f32) -> Image {
        let size_pt = size_pt.clamp(8.0, 1024.0);
        let id = key(("svg", view.to_bits(), size_pt.to_bits(), body));
        if let Some(image) = self.loaded.borrow_mut().get(&id) {
            return image.clone();
        }
        let markup = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {view} {view}\" preserveAspectRatio=\"none\">{}</svg>",
            replace_oklch(body)
        );
        let image = cache().svg(markup.into_bytes(), size_pt, SCALE);
        self.loaded
            .borrow_mut()
            .insert(id, image.clone(), 1, |_| false);
        image
    }

    /// Rebuilds the element at `path` once `image` has decoded, for a box sized from the
    /// picture's own size. A decode wakes the window to redraw, but a memoised row is not rebuilt
    /// by a redraw, so a row built while its picture decoded would keep its empty box. A picture
    /// that fails to decode stays empty and asks for nothing.
    pub fn await_decode(&self, image: &Image, path: &str) {
        if image.is_ready() && image.error().is_some() {
            return;
        }
        let mut decoding = DECODING.lock().unwrap();
        if !decoding.iter().any(|d| d.id() == image.id()) {
            decoding.push(image.clone());
        }
        drop(decoding);
        self.wait(Awaited::Decode(image.id()), path, Some(image));
    }

    fn wait(&self, on: Awaited, path: &str, image: Option<&Image>) {
        let mut waiting = self.waiting.borrow_mut();
        let waiter = waiting.entry(on).or_insert_with(|| Waiter {
            paths: HashSet::new(),
            image: image.cloned(),
        });
        waiter.paths.insert(path.to_string());
    }

    /// The paths of the elements whose pictures landed since the last call. A picture that
    /// failed lets its elements go: they keep their empty box.
    pub(crate) fn landed(&mut self) -> Vec<String> {
        let waiting = self.waiting.get_mut();
        if waiting.is_empty() {
            return Vec::new();
        }
        let remote = REMOTE.lock().unwrap();
        let masked = MASKED.lock().unwrap();
        let mut paths = Vec::new();
        waiting.retain(|on, waiter| {
            let landed = match on {
                Awaited::Download(url) => match remote.peek(url) {
                    Some(Fetched::Pending) => return true,
                    Some(Fetched::Picture(_) | Fetched::Svg(_)) => true,
                    Some(Fetched::Failed(_)) | None => false,
                },
                Awaited::Composite(id, size) => match masked.peek(id) {
                    Some(entry) if entry.made.as_ref().is_some_and(|(made, _)| made == size) => {
                        true
                    }
                    Some(entry) if entry.asked == *size && !entry.failed => return true,
                    _ => false,
                },
                Awaited::Decode(_) => match &waiter.image {
                    Some(image) if !image.is_ready() => return true,
                    Some(image) => image.error().is_none(),
                    None => false,
                },
            };
            if landed {
                paths.extend(waiter.paths.drain());
            }
            false
        });
        paths
    }

    /// Marks the memos of the elements at `paths` and of every element around them stale: each
    /// rebuilds once, the rest of the tree is reused. Whether that overflowed what is tracked, so
    /// that every memo must go instead.
    pub(crate) fn mark_stale(&mut self, paths: &[String]) -> bool {
        self.landings += 1;
        for path in paths {
            let ends = path
                .match_indices('/')
                .map(|(at, _)| at)
                .chain([path.len()]);
            for end in ends {
                self.stale.insert(path[..end].to_string(), self.landings);
            }
        }
        if self.stale.len() > STALE_PATHS {
            self.stale.clear();
            return true;
        }
        false
    }

    /// Part of the memo version of the element at `path`: changes when a picture it or an
    /// element inside it waited on lands.
    pub(crate) fn epoch(&self, path: &str) -> u64 {
        if self.stale.is_empty() {
            return 0;
        }
        self.stale.get(path).copied().unwrap_or(0)
    }
}

/// Starts (once, or again `RETRY_AFTER` a failure) the download of `url`; the image at `size_pt`
/// once it has arrived.
fn remote(url: &str, size_pt: f32) -> Option<Image> {
    let mut remote = REMOTE.lock().unwrap();
    match remote.get(&url.to_string()) {
        Some(Fetched::Picture(bytes)) => return Some(cache().load(bytes.clone())),
        Some(Fetched::Svg(bytes)) => return Some(cache().svg(bytes.clone(), size_pt, SCALE)),
        Some(Fetched::Pending) => return None,
        Some(Fetched::Failed(at)) if at.elapsed() < RETRY_AFTER => return None,
        Some(Fetched::Failed(_)) | None => {}
    }
    let pending = |f: &Fetched| matches!(f, Fetched::Pending);
    remote.insert(url.to_string(), Fetched::Pending, 0, pending);
    drop(remote);
    let url = url.to_string();
    background(move || {
        let fetched = match crate::fetch::get(&url, Duration::from_secs(15)) {
            Ok(body) if !body.is_empty() => {
                if url.ends_with(".svg") || body.starts_with(b"<svg") {
                    Fetched::Svg(body.into())
                } else {
                    Fetched::Picture(body.into())
                }
            }
            _ => Fetched::Failed(Instant::now()),
        };
        let (failed, bytes) = match &fetched {
            Fetched::Picture(b) | Fetched::Svg(b) => (false, b.len()),
            _ => (true, 0),
        };
        REMOTE.lock().unwrap().insert(url, fetched, bytes, pending);
        if !failed {
            arrived();
        }
    });
    None
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
        // Served once over http on a local port: downloads take web URLs only.
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="red"/></svg>"#;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/picture.svg", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut stream, _) = listener.accept().unwrap();
            let _ = stream.read(&mut [0; 1024]);
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: image/svg+xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                svg.len()
            );
            stream.write_all(head.as_bytes()).unwrap();
            stream.write_all(svg.as_bytes()).unwrap();
        });
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
    }

    /// A `w` by `h` PNG, its pixels all `rgba`.
    fn png(w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(w, h, image::Rgba(rgba)))
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn an_lru_drops_the_least_recently_used_within_its_bounds() {
        let never = |_: &u32| false;
        let mut lru = Lru::new(2, 100);
        lru.insert("a", 1, 10, never);
        lru.insert("b", 2, 10, never);
        lru.get(&"a");
        lru.insert("c", 3, 10, never);
        assert!(lru.peek(&"b").is_none(), "b was used least recently");
        assert!(lru.peek(&"a").is_some() && lru.peek(&"c").is_some());
        // Over its weight, it drops until it fits; what `keep` holds stays.
        let mut lru = Lru::new(10, 100);
        lru.insert("pending", 0, 60, |_| false);
        lru.insert("old", 1, 30, |_| false);
        lru.insert("new", 2, 50, |v: &u32| *v == 0);
        assert!(lru.peek(&"pending").is_some(), "kept");
        assert!(lru.peek(&"old").is_none());
        assert_eq!(lru.len(), 2);
    }

    #[test]
    fn a_window_keeps_a_bounded_number_of_pictures_keyed_by_their_hash() {
        let images = Images::default();
        let body = r#"<path d="M0 0h1v1z" fill="red"/>"#;
        let first = images.svg(16.0, body, 32.0);
        assert_eq!(
            images.svg(16.0, body, 32.0).id(),
            first.id(),
            "found, not built again"
        );
        assert_eq!(images.loaded.borrow().len(), 1);
        for i in 0..LOADED_ENTRIES + 20 {
            images.svg(
                16.0,
                &format!(r#"<path d="M0 0h{i}v1z" fill="red"/>"#),
                32.0,
            );
        }
        assert_eq!(images.loaded.borrow().len(), LOADED_ENTRIES);
    }

    #[test]
    fn a_failed_download_is_asked_for_again_after_the_retry_delay() {
        let url = format!(
            "file:///nonexistent/hazel-{}/missing.png",
            std::process::id()
        );
        let state = || match REMOTE.lock().unwrap().peek(&url) {
            Some(Fetched::Pending) => "pending",
            Some(Fetched::Failed(_)) => "failed",
            Some(_) => "fetched",
            None => "none",
        };
        assert!(remote(&url, 16.0).is_none());
        let deadline = Instant::now() + Duration::from_secs(10);
        while state() != "failed" {
            assert!(Instant::now() < deadline, "the download never failed");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(remote(&url, 16.0).is_none());
        assert_eq!(state(), "failed", "not fetched again at once");
        let long_ago = Instant::now() - RETRY_AFTER - Duration::from_secs(1);
        REMOTE
            .lock()
            .unwrap()
            .insert(url.clone(), Fetched::Failed(long_ago), 0, |_| false);
        assert!(remote(&url, 16.0).is_none());
        // Asked for again: pending, or (a missing file fails fast) failed anew, not the old failure.
        let retried = match REMOTE.lock().unwrap().peek(&url) {
            Some(Fetched::Failed(at)) => *at > long_ago,
            Some(Fetched::Pending) => true,
            _ => false,
        };
        assert!(retried, "fetched again once the delay passed");
    }

    #[test]
    fn a_mask_composite_decodes_its_source_once_for_every_size() {
        use base64::Engine;
        let src = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png(3, 2, [0, 0, 255, 255]))
        );
        let first = decoded_source(&src).expect("decodes");
        assert_eq!(first.dimensions(), (3, 2));
        assert!(Arc::ptr_eq(&first, &decoded_source(&src).unwrap()));
    }

    #[test]
    fn a_landed_picture_makes_only_its_element_and_those_around_it_stale() {
        let mut images = Images::default();
        let image = cache().load(png(2, 2, [255, 0, 0, 255]));
        images.await_decode(&image, "r/1/k7");
        image.wait().unwrap();
        let landed = images.landed();
        assert_eq!(landed, ["r/1/k7"]);
        assert!(images.landed().is_empty(), "told once");
        assert!(!images.mark_stale(&landed));
        for path in ["r", "r/1", "r/1/k7"] {
            assert_eq!(images.epoch(path), 1, "{path}");
        }
        for path in ["r/0", "r/1/k7/0", "r/10"] {
            assert_eq!(images.epoch(path), 0, "{path} is reused");
        }
        let many: Vec<String> = (0..STALE_PATHS).map(|i| format!("r/{i}")).collect();
        assert!(
            images.mark_stale(&many),
            "too many: every memo goes instead"
        );
        assert_eq!(images.epoch("r/1"), 0);
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

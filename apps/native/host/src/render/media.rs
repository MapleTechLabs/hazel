//! Pictures: inline SVGs (icons and multicolour drawings) and `<img>`.

use std::collections::HashMap;
use std::sync::Mutex;

use rune::text::Icon;
use rune::{El, SurfaceFit, el, icon};

use crate::layout::{Inherit, apply_box, center_vertically, color};
use crate::wire::{self, Style};
use crate::{images, svg_text};

use super::Ctx;
use super::handlers::press_handlers;

static ICONS: Mutex<Option<HashMap<String, &'static Icon>>> = Mutex::new(None);

/// Rune icons are `&'static`; one per distinct body (an app has a bounded icon set).
fn intern_icon(view: f32, body: &str) -> &'static Icon {
    let mut icons = ICONS.lock().unwrap();
    let map = icons.get_or_insert_with(HashMap::new);
    let key = format!("{view}|{body}");
    if let Some(i) = map.get(&key) {
        return i;
    }
    let leaked: &'static Icon = Box::leak(Box::new(Icon {
        name: "hazel",
        view,
        body: Box::leak(body.to_string().into_boxed_str()),
    }));
    map.insert(key, leaked);
    leaked
}

/// The size a picture rasterizes for: its own width or height, else a generous default.
pub(super) fn picture_size(st: &Style) -> f32 {
    match (&st.w, &st.h) {
        (Some(wire::Len::Px(w)), Some(wire::Len::Px(h))) => w.0.max(h.0),
        (Some(wire::Len::Px(v)), _) | (_, Some(wire::Len::Px(v))) => v.0,
        _ => 128.0,
    }
}

/// An inline SVG: a `currentColor` icon tinted with the text colour, or one with its own
/// colours (an avatar's dither pattern) drawn as a picture.
pub(super) fn build_svg(
    view: f32,
    body: &str,
    st: &Style,
    par: Option<&str>,
    inh: Inherit,
    ctx: &Ctx,
) -> El {
    let c = color(&st.color).unwrap_or(inh.color);
    let (shape, texts) = svg_text::split(body);
    let body = shape.as_str();
    let labels = |e: El, size: f32| {
        texts
            .iter()
            .fold(e, |e, t| e.child(svg_text::overlay(t, view, size, c)))
    };
    if !images::is_multicolour(body) {
        let size = match st.w {
            Some(wire::Len::Px(wire::F(v))) => v,
            _ => 16.0,
        };
        let e = labels(icon(intern_icon(view, body), size).color(c), size);
        return center_vertically(apply_box(e, st), st);
    }
    let image = ctx.s.images.svg(view, body, picture_size(st));
    // `preserveAspectRatio`: `none` stretches to the box (the dithered avatar), `slice` covers
    // it, and the default (`meet`) fits inside it.
    let mut e = match par.unwrap_or("xMidYMid meet") {
        "none" => el().pixels(image.pixels()),
        p if p.ends_with("slice") => el().pixels_fit(image.pixels(), SurfaceFit::Fill),
        _ => el().pixels_fit(image.pixels(), SurfaceFit::Fit),
    };
    if st.w.is_none() && st.h.is_none() && st.absolute.is_none() {
        // An unsized SVG fills its box; the decorative ones here sit under their siblings.
        e = e.pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0))
    }
    let e = labels(e, picture_size(st));
    center_vertically(apply_box(e, st), st)
}

/// `<img>`: the picture at `src`, fitted by `object-fit`; an empty box until it decodes.
pub(super) fn build_img(
    path: &str,
    st: &Style,
    attrs: &HashMap<String, String>,
    on: &HashMap<String, u32>,
    ctx: &Ctx,
) -> El {
    let mut e = el().key(path);
    let mask = st.mask.as_ref().filter(|m| m.image.is_some());
    let local = attrs.get("src").filter(|src| images::is_local(src));
    if let (Some(src), Some(mask)) = (local, mask) {
        // A mask picture is placed in the box, so the picture composites at the box's own size:
        // nothing shows until it is laid out and the composite is ready.
        let size = rune::memo::layout_size(path).filter(|[w, h]| *w > 0.0 && *h > 0.0);
        let fit = st.object_fit.as_deref();
        if let Some(image) = size.and_then(|size| ctx.s.images.masked(src, mask, size, fit)) {
            e = e.pixels(image.pixels());
        }
    } else if let Some(image) = attrs
        .get("src")
        .and_then(|src| ctx.s.images.get(src, picture_size(st)))
    {
        if let Some([w, h]) = natural_box(st, &image, path) {
            e = e.size(w, h);
        }
        e = match st.object_fit.as_deref() {
            Some("cover") => e.pixels_fit(image.pixels(), SurfaceFit::Fill),
            Some("contain" | "scale-down" | "none") => {
                e.pixels_fit(image.pixels(), SurfaceFit::Fit)
            }
            _ => e.pixels(image.pixels()),
        };
    }
    press_handlers(apply_box(e, st), on, None)
}

/// The box of an `<img>` that sets neither its width nor its height (`w-auto h-auto`, a chat
/// message's lone image): CSS gives it the picture's own size, scaled down to fit its `max-w`
/// and `max-h` with its aspect ratio kept. Rune sizes a picture's box only from a side that is
/// set, so without this the box is empty. `None` while the picture decodes (the row rebuilds
/// once it has), or when the style sizes the box itself.
///
/// A percentage max (`max-w-full max-h-full`, the image viewer's) is a share of the parent's
/// laid-out box, read so the view rebuilds when that box changes. Before the parent is laid out
/// that side has no cap, as a percentage of a size that depends on the content has none in CSS.
fn natural_box(st: &Style, image: &rune::Image, path: &str) -> Option<[f32; 2]> {
    let unset = |len: &Option<wire::Len>| matches!(len, None | Some(wire::Len::Auto));
    if !unset(&st.w) || !unset(&st.h) || st.aspect_ratio.is_some() {
        return None;
    }
    let Some([w, h]) = image.size() else {
        images::rebuild_when_ready(image);
        return None;
    };
    let percent = st
        .max_w
        .iter()
        .chain(&st.max_h)
        .any(|len| matches!(len, wire::Len::Full | wire::Len::Frac(_)));
    let parent = percent
        .then(|| path.rsplit_once('/'))
        .flatten()
        .and_then(|(parent, _)| rune::memo::layout_size(parent));
    let max = |len: &Option<wire::Len>, side: usize| {
        let share = match len {
            Some(wire::Len::Px(v)) if v.0 > 0.0 => return v.0,
            Some(wire::Len::Full) => 1.0,
            Some(wire::Len::Frac(f)) => f.0,
            _ => return f32::INFINITY,
        };
        match parent {
            Some(size) if size[side] > 0.0 => size[side] * share,
            _ => f32::INFINITY,
        }
    };
    Some(fit_within(
        [w as f32, h as f32],
        [max(&st.max_w, 0), max(&st.max_h, 1)],
    ))
}

/// `size` scaled down (never up) to fit inside `max`, keeping its aspect ratio.
fn fit_within([w, h]: [f32; 2], [max_w, max_h]: [f32; 2]) -> [f32; 2] {
    if w <= 0.0 || h <= 0.0 {
        return [w.max(0.0), h.max(0.0)];
    }
    let scale = (max_w / w).min(max_h / h).min(1.0);
    [w * scale, h * scale]
}

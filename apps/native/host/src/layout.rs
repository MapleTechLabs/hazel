//! Computed CSS (already resolved by the runtime) to Rune element styles. Rune lacks a few CSS
//! features, emulated here: single-side borders, CSS text inheritance and percentage centring.
use rune::tok::TextStyle;
use rune::{Color, El, ScrollSpec, el, row};

use crate::wire::{F, Len, Style};

pub fn color(hex: &Option<String>) -> Option<Color> {
    let h = hex.as_deref()?;
    let c = rune::color::hex(h)?;
    if c.a <= 0.0 { None } else { Some(c) }
}

fn f(v: Option<F>) -> Option<f32> {
    v.map(|F(x)| x)
}

/// CSS-inherited text properties, which Rune does not inherit on its own.
#[derive(Clone, Copy)]
pub struct Inherit {
    pub color: Color,
    pub size: f32,
    pub line: f32,
    pub weight: f32,
    pub truncate: bool,
    pub nowrap: bool,
}

impl Inherit {
    pub fn from(&self, st: &Style) -> Inherit {
        let size = f(st.font_size).unwrap_or(self.size);
        Inherit {
            color: color(&st.color).unwrap_or(self.color),
            size,
            line: f(st.line_height).unwrap_or(if st.font_size.is_some() {
                size * 1.4
            } else {
                self.line
            }),
            weight: f(st.font_weight).unwrap_or(self.weight),
            truncate: self.truncate || st.truncate.unwrap_or(false),
            nowrap: if st.nowrap == Some(true) {
                true
            } else {
                self.nowrap
            },
        }
    }
    pub fn style(&self) -> TextStyle {
        let mut s = TextStyle::new(self.size, self.weight);
        s.line_height = self.line;
        s
    }
}

/// Box model, paint and flex-item properties shared by every element kind.
pub fn apply_box(mut e: El, st: &Style) -> El {
    match st.w {
        Some(Len::Px(F(v))) => e = e.w(v),
        Some(Len::Full) => e = e.w_full(),
        _ => {}
    }
    match st.h {
        Some(Len::Px(F(v))) => e = e.h(v),
        Some(Len::Full) => e = e.h_full(),
        _ => {}
    }
    if let Some(v) = f(st.min_w) {
        e = e.min_w(v)
    }
    if let Some(v) = f(st.min_h) {
        e = e.min_h(v)
    }
    if let Some(v) = f(st.max_w) {
        e = e.max_w(v)
    }
    if let Some(g) = f(st.grow).filter(|g| *g > 0.0) {
        e = e.grow(g)
    }
    if let Some([t, r, b, l]) = st.pad {
        e = e.pt(t.0).pr(r.0).pb(b.0).pl(l.0)
    }
    if let Some([t, r, b, l]) = st.margin {
        e = e.mt(t.0).mr(r.0).mb(b.0).ml(l.0)
    }
    if let Some(c) = color(&st.bg) {
        e = e.fill(c)
    }
    if let Some(c) = color(&st.hover_bg) {
        e = e.hover(c)
    }
    if let Some(r) = st.radius {
        let r = r.map(|F(v)| v.min(999.0));
        e = if r.iter().all(|v| *v == r[0]) {
            e.radius(r[0])
        } else {
            e.corners(r)
        };
    }
    match (f(st.opacity), f(st.group_opacity)) {
        // An ancestor's hover reveals this element; Rune animates it without re-running the view.
        (rest, Some(hovered)) => e = e.group_opacity(rest.unwrap_or(1.0), hovered),
        (Some(o), None) => e = e.opacity(o),
        _ => {}
    }
    if st.hover_group == Some(true) {
        e = e.hover_group()
    }
    match st.align_self.as_deref() {
        Some("center") => e = e.self_center(),
        Some("flex-start" | "start") => e = e.self_start(),
        _ => {}
    }
    if let Some([l, t, r, b]) = st.absolute
        && st.center_y != Some(true)
    {
        e = e.pin(f(l), f(t), f(r), f(b))
    }
    // A transparent border only reserves space, which the padding already accounts for.
    let is_transparent = st.border_color.is_some() && color(&st.border_color).is_none();
    if let (Some(border), false) = (st.border, is_transparent) {
        let c = color(&st.border_color).unwrap_or(rune::color::hex("#8080804d").unwrap());
        let [t, r, b, l] = border.map(|F(v)| v);
        if t == r && r == b && b == l {
            if t > 0.0 {
                e = e.border(t, c)
            }
        } else {
            // Rune borders go all the way round; single sides are pinned hairlines.
            if t > 0.0 {
                e = e.child(el().pin(Some(0.0), Some(0.0), Some(0.0), None).h(t).fill(c))
            }
            if r > 0.0 {
                e = e.child(el().pin(None, Some(0.0), Some(0.0), Some(0.0)).w(r).fill(c))
            }
            if b > 0.0 {
                e = e.child(el().pin(Some(0.0), None, Some(0.0), Some(0.0)).h(b).fill(c))
            }
            if l > 0.0 {
                e = e.child(el().pin(Some(0.0), Some(0.0), None, Some(0.0)).w(l).fill(c))
            }
        }
    }
    e
}

/// `inset-y-1/2 -translate-y-1/2`: Rune has no percentage insets, so centre in a full-height slot.
pub fn center_vertically(e: El, st: &Style) -> El {
    match (st.absolute, st.center_y) {
        (Some([l, _, r, _]), Some(true)) => row()
            .pin(f(l), Some(0.0), f(r), Some(0.0))
            .items_center()
            .child(e),
        _ => e,
    }
}

pub fn apply_flex(mut e: El, st: &Style) -> El {
    let gap_row = f(st.gap_row).or(f(st.child_gap)).unwrap_or(0.0);
    let gap_col = f(st.gap_col).or(f(st.child_gap)).unwrap_or(0.0);
    if gap_row > 0.0 || gap_col > 0.0 {
        e = e.gaps(gap_row, gap_col)
    }
    if st.wrap == Some(true) {
        e = e.flex_wrap()
    }
    match st.items.as_deref() {
        Some("center") => e = e.items_center(),
        Some("flex-start" | "start") => e = e.items_start(),
        Some("flex-end" | "end") => e = e.items_end(),
        Some("stretch") => e = e.items_stretch(),
        _ => {}
    }
    match st.justify.as_deref() {
        Some("center") => e = e.justify_center(),
        Some("space-between") => e = e.justify_between(),
        Some("flex-end" | "end") => e = e.justify_end(),
        _ => {}
    }
    if st.scroll_y == Some(true) {
        e = e.scroll(ScrollSpec {
            stick_bottom: false,
        })
    }
    e
}

/// One grid track as a flex item: `auto` hugs, `Nfr` grows, a length is fixed.
pub fn track(cell: El, template: &str) -> El {
    if let Some(fr) = template.strip_suffix("fr") {
        cell.grow(fr.parse().unwrap_or(1.0)).min_w(0.0)
    } else if let Some(rem) = template.strip_suffix("rem") {
        cell.w(rem.parse::<f32>().unwrap_or(0.0) * 16.0)
    } else if let Some(px) = template.strip_suffix("px") {
        cell.w(px.parse().unwrap_or(0.0))
    } else {
        cell
    }
}

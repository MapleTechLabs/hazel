//! Computed CSS (already resolved by the runtime) to Rune element styles. Rune lacks a few CSS
//! features, emulated here: single-side borders, CSS text inheritance, percentage centring, auto
//! margins and box-shadow rings.
use rune::tok::TextStyle;
use rune::{
    Align, Anim, AnimExt, Color, Curve, Easing, Effect, El, Family, GridTrack, LoopSpec,
    ScrollSpec, Shadow, Span, Spring, SpringPair, TextCase, Transition, Vec2, el, row, text,
};

use std::collections::HashMap;

use crate::wire::{Animation, BgImage, F, FocusRing, Len, OutlineSpec, Style, Timing};

pub fn color(hex: &Option<String>) -> Option<Color> {
    let h = hex.as_deref()?;
    let c = rune::color::hex(h)?;
    if c.a <= 0.0 { None } else { Some(c) }
}

fn f(v: Option<F>) -> Option<f32> {
    v.map(|F(x)| x)
}

fn px(v: &Option<Len>) -> Option<f32> {
    match v {
        Some(Len::Px(F(x))) => Some(*x),
        _ => None,
    }
}

/// CSS `text-transform` (`Capitalize` is applied to the string; Rune draws the other two).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Case {
    #[default]
    None,
    Upper,
    Lower,
    Capitalize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Decoration {
    #[default]
    None,
    Underline,
    Strike,
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
    pub mono: bool,
    pub italic: bool,
    pub tracking: f32,
    pub case: Case,
    /// Not inherited in CSS, but a decoration paints across all text inside the box.
    pub decoration: Decoration,
    pub pre: bool,
    pub align: Align,
    pub justify: bool,
    /// Text colour while the nearest hover-coloured ancestor is hovered.
    pub hover_color: Option<Color>,
}

impl Default for Inherit {
    fn default() -> Self {
        Inherit {
            color: Color::WHITE,
            size: 16.0,
            line: 24.0,
            weight: 400.0,
            truncate: false,
            nowrap: false,
            mono: false,
            italic: false,
            tracking: 0.0,
            case: Case::None,
            decoration: Decoration::None,
            pre: false,
            align: Align::Start,
            justify: false,
            hover_color: None,
        }
    }
}

impl Inherit {
    pub fn from(&self, st: &Style) -> Inherit {
        // A size the resolver could not compute (`cqw`, `%`) arrives as 0: keep the inherited one.
        let own_size = f(st.font_size).filter(|s| *s > 0.0);
        let size = own_size.unwrap_or(self.size);
        let own_color = color(&st.color);
        Inherit {
            color: own_color.unwrap_or(self.color),
            size,
            line: f(st.line_height)
                .filter(|l| *l > 0.0)
                .unwrap_or(if own_size.is_some() {
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
            mono: match st.font_family.as_deref() {
                Some("mono") => true,
                Some(_) => false,
                None => self.mono,
            },
            italic: st.italic.unwrap_or(self.italic),
            tracking: f(st.letter_spacing).unwrap_or(self.tracking),
            case: match st.text_transform.as_deref() {
                Some("uppercase") => Case::Upper,
                Some("lowercase") => Case::Lower,
                Some("capitalize") => Case::Capitalize,
                Some(_) => Case::None,
                None => self.case,
            },
            decoration: match st.text_decoration.as_deref() {
                Some("underline") => Decoration::Underline,
                Some("line-through") => Decoration::Strike,
                Some(_) => Decoration::None,
                None => self.decoration,
            },
            pre: st.white_space_pre.unwrap_or(self.pre),
            align: match st.text_align.as_deref() {
                Some("center") => Align::Center,
                Some("right" | "end") => Align::End,
                Some(_) => Align::Start,
                None => self.align,
            },
            justify: match st.text_align.as_deref() {
                Some(a) => a == "justify",
                None => self.justify,
            },
            hover_color: match (color(&st.hover_color), own_color) {
                (Some(c), _) => Some(c),
                (None, Some(_)) => None,
                (None, None) => self.hover_color,
            },
        }
    }

    pub fn style(&self) -> TextStyle {
        let mut s = TextStyle::new(self.size, self.weight);
        s.line_height = self.line;
        s.tracking = self.tracking;
        s.italic = self.italic;
        if self.mono {
            // Rune bundles no mono face on native; SF Mono is what browsers draw for `font-mono`.
            s.family = Family::SystemMono;
        }
        s
    }

    /// Everything a memoised subtree's look depends on besides its own content.
    pub fn key(&self) -> impl std::hash::Hash + use<> {
        (
            self.color.hex(),
            [self.size, self.line, self.weight, self.tracking].map(f32::to_bits),
            (self.truncate, self.nowrap, self.mono, self.italic, self.pre),
            (self.case, self.decoration, self.justify),
            self.align as u8,
            self.hover_color.map(|c| c.hex()),
        )
    }
}

/// A text run with the inherited text properties applied.
pub fn text_run(s: &str, inh: &Inherit) -> El {
    let content = if inh.case == Case::Capitalize {
        capitalize(s)
    } else {
        s.to_string()
    };
    let len = content.len();
    let mut t = text(content).font(inh.style()).color(inh.color);
    t = match inh.case {
        Case::Upper => t.text_case(TextCase::Uppercase),
        Case::Lower => t.text_case(TextCase::Lowercase),
        _ => t,
    };
    t = match inh.decoration {
        Decoration::Underline => t.spans(vec![Span::new(0, len).underline(inh.color)]),
        Decoration::Strike => t.strike(0, len, None),
        Decoration::None => t,
    };
    t = if inh.pre {
        // `white-space: pre`: Rune keeps newlines and runs of spaces as given.
        if inh.nowrap { t } else { t.wrap().shrink() }
    } else if inh.truncate {
        t.single_line().truncate().shrink()
    } else if inh.nowrap {
        t.single_line()
    } else {
        t.wrap().shrink()
    };
    if inh.align != Align::Start {
        t = t.align(inh.align)
    }
    if inh.justify {
        t = t.justify()
    }
    if let Some(c) = inh.hover_color {
        t = t.group_color(c)
    }
    t
}

fn capitalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut at_start = true;
    for c in s.chars() {
        if at_start && c.is_alphabetic() {
            out.extend(c.to_uppercase());
        } else {
            out.push(c);
        }
        // A word starts after any break but the joiners Unicode keeps inside a word (UAX #29
        // MidLetter/MidNumLet): "hello-world" is two words, "node.js" and "it's" are one.
        let joins_word = matches!(c, '.' | '\'' | '\u{2019}' | ':' | '\u{00B7}');
        at_start = !c.is_alphanumeric() && !(joins_word && !at_start);
    }
    out
}

/// Box model, paint and flex-item properties shared by every element kind.
pub fn apply_box(mut e: El, st: &Style) -> El {
    // `position: sticky`: Rune holds it in the nearest vertical scroller, pushed out by its parent.
    if let Some(F(top)) = st.sticky_top {
        e = e.sticky_top(top);
    }
    match st.w {
        Some(Len::Px(F(v))) => e = e.w(v),
        Some(Len::Full) => e = e.w_full(),
        Some(Len::Frac(F(f))) => e = e.w_frac(f),
        _ => {}
    }
    match st.h {
        Some(Len::Px(F(v))) => e = e.h(v),
        Some(Len::Full) => e = e.h_full(),
        _ => {}
    }
    // Rune items keep their size by default (`flex-shrink: 0`); a positive shrink lets them go.
    // Rune's `shrink` also zeroes the minimum width, so an element's own `min-w` comes after it.
    if f(st.shrink).is_some_and(|s| s > 0.0) {
        e = e.shrink()
    }
    if let Some(v) = px(&st.min_w) {
        e = e.min_w(v)
    }
    if let Some(v) = px(&st.min_h) {
        e = e.min_h(v)
    }
    if let Some(v) = px(&st.max_w) {
        e = e.max_w(v)
    }
    if let Some(v) = px(&st.max_h) {
        e = e.max_h(v)
    }
    if let Some(r) = f(st.aspect_ratio) {
        e = e.aspect_ratio(r)
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
    if let Some(BgImage {
        gradient: Some(g), ..
    }) = &st.bg_image
    {
        let n = g.stops.len().max(2) as f32 - 1.0;
        let stops: Vec<(f32, Color)> = g
            .stops
            .iter()
            .enumerate()
            .filter_map(|(i, s)| {
                // Stops arrive as fractions; tolerate percentages.
                let at = f(s.at).map_or(i as f32 / n, |a| if a > 1.0 { a / 100.0 } else { a });
                Some((at, rune::color::hex(&s.color)?))
            })
            .collect();
        if stops.len() >= 2 {
            e = e.linear_gradient(g.angle.0.to_radians(), stops)
        }
    }
    if let Some(c) = color(&st.hover_bg) {
        e = e.hover(c)
    }
    if let Some(row) = &st.hover_share {
        e = e.hover_group_shared(row.as_str())
    }
    if let Some(span) = st.col_span.filter(|&n| n > 1) {
        e = e.grid_column_span(span)
    }
    let radius = st.radius.map(|r| r.map(|F(v)| v.min(999.0)));
    if let Some(r) = radius {
        e = if r.iter().all(|v| *v == r[0]) {
            e.radius(r[0])
        } else {
            e.corners(r)
        };
    }
    // `overflow: hidden`: a hard clip, rounded with the box's own corners.
    if st.clip == Some(true) {
        e = match radius {
            Some(r) if r.iter().any(|v| *v > 0.0) => e.clip_corners(r),
            _ => e.clip_soft(0.0),
        }
    }
    e = apply_shadows(e, st);
    if let Some(o) = &st.outline
        && let Some(c) = color(&Some(o.color.clone()))
        && o.width.0 > 0.0
    {
        e = e.outline(o.width.0, o.offset.0, c)
    }
    match (f(st.opacity), f(st.group_opacity)) {
        // An ancestor's hover reveals this element; Rune animates it without re-running the view.
        (rest, Some(hovered)) => e = e.group_opacity(rest.unwrap_or(1.0), hovered),
        (Some(o), None) => e = e.opacity(o),
        _ => {}
    }
    if st.hover_group == Some(true) || color(&st.hover_color).is_some() {
        e = e.hover_group()
    }
    match st.align_self.as_deref() {
        Some("center") => e = e.self_center(),
        Some("flex-start" | "start") => e = e.self_start(),
        Some("flex-end" | "end") => e = e.self_end(),
        Some("stretch") => e = e.self_stretch(),
        _ => {}
    }
    if let Some([l, t, r, b]) = st.absolute
        && st.center_y != Some(true)
        && st.center_x != Some(true)
    {
        e = e.pin(f(l), f(t), f(r), f(b))
    }
    if let Some([x, y]) = st.translate
        && (x.0 != 0.0 || y.0 != 0.0)
    {
        e = e.offset(x.0, y.0)
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
    if st.visibility.as_deref() == Some("hidden") {
        e = e.opacity(0.0).inert()
    }
    apply_motion(e, st)
}

/// CSS changes land at once unless a transition names them; Rune animates by default, so every
/// element states its own motion (children don't inherit a transition, as in CSS).
fn apply_motion(e: El, st: &Style) -> El {
    let t = st.transition.clone().unwrap_or_default();
    let tween = |t: &Option<Timing>| match t {
        Some(t) => {
            let [x1, y1, x2, y2] = t.ease.map(|F(v)| v);
            Anim::from(Curve::tween(t.duration.0, Easing::cubic(x1, y1, x2, y2))).delay(t.delay.0)
        }
        None => Anim::INSTANT,
    };
    // Rune moves layout and colours on one spring: the longer of the two, critically damped.
    let spring = [&t.colors, &t.layout]
        .into_iter()
        .flatten()
        .map(|t| t.duration.0)
        .fold(0.0, f32::max);
    let colors = tween(&t.colors);
    let spring = if spring > 0.0 {
        Spring::new(spring, 0.0)
    } else {
        Spring::NONE
    };
    // `token_motion` keeps Rune's motion checks out of it, and writes no per-element cold state.
    let mut e = e.token_motion(spring);
    // Curves only where the property can change; each one is an allocation per element.
    let hovers = st.hover_bg.is_some() || st.hover_color.is_some() || st.hover_group == Some(true);
    if hovers || st.group_opacity.is_some() {
        e = e.hover_motion(colors, colors)
    }
    if st.opacity.is_some() || st.group_opacity.is_some() || t.opacity.is_some() {
        e = e.opacity_motion(tween(&t.opacity))
    }
    if st.translate.is_some() || t.transform.is_some() {
        e = e.offset_motion(tween(&t.transform))
    }
    match &st.animation {
        Some(Animation::Spin { period }) => e
            .looping(LoopSpec::rotation(f64::from(period.0)))
            .transition(Transition::none()),
        Some(Animation::Pulse {
            period,
            delay,
            from,
            to,
        }) => e
            .looping(LoopSpec::opacity(
                f64::from(period.0),
                f64::from(delay.0),
                from.0,
                to.0,
            ))
            .transition(Transition::none()),
        Some(Animation::Enter {
            duration,
            delay,
            opacity,
            x,
            y,
            scale,
        }) => {
            let insertion = Effect {
                opacity: opacity.0,
                scale: scale.0,
                offset: Vec2::new(x.0, y.0),
                ..Effect::IDENTITY
            };
            // Rune plays entrances on springs: one as long as the CSS animation, no overshoot.
            let springs = SpringPair {
                enter: Spring::new(duration.0.max(0.01), 0.0),
                exit: Spring::NONE,
            };
            let transition = Transition {
                insertion,
                removal: Effect::IDENTITY,
                pop_layout: true,
                springs,
            };
            e.transition(transition).enter_delay(delay.0)
        }
        None => e.transition(Transition::none()),
    }
}

/// The fill a press shows and the rings focus draws. A field's focus is its text field's, inside
/// `e`, and a browser shows `:focus-visible` on a focused field from the pointer too.
pub fn focus_styles(mut e: El, st: &Style, field: bool) -> El {
    if let Some(c) = color(&st.press_bg) {
        e = e.press(c)
    }
    let ring = |o: &OutlineSpec| color(&Some(o.color.clone())).map(|c| (o.width.0, o.offset.0, c));
    let keyboard = match &st.focus_ring {
        Some(FocusRing::Ring(o)) => Some(o),
        _ => None,
    };
    let within = st.focus_within_ring.as_ref().or(keyboard.filter(|_| field));
    if let Some((w, off, c)) = within.and_then(ring) {
        return e.focus_within_ring(w, off, c);
    }
    if let Some((w, off, c)) = keyboard.and_then(ring) {
        e = e.focus_ring(w, off, c)
    } else if let Some(FocusRing::Hidden(_)) = &st.focus_ring {
        e = e.no_focus_ring()
    }
    e
}

/// Elements HTML puts in the Tab order (or `tabindex` adds), unless disabled. A negative
/// `tabindex` takes them out: in Rune a focusable element keeps the presses on it, where a
/// browser lets the click bubble, and the host has no script focus that would need it.
/// `tabindex="-1"`: focusable by script (`element.focus()`, a menu moving its highlight) and
/// by a press, but no Tab stop.
pub fn script_focusable(attrs: &HashMap<String, String>) -> bool {
    !attrs.contains_key("disabled")
        && attrs
            .get("tabindex")
            .and_then(|t| t.trim().parse::<i32>().ok())
            .is_some_and(|order| order < 0)
}

/// A checkbox or radio: a control a press or Space checks, not a text field.
pub fn is_checkable(tag: &str, attrs: &HashMap<String, String>) -> bool {
    tag == "input"
        && attrs
            .get("type")
            .is_some_and(|t| t == "checkbox" || t == "radio")
}

/// An element Rune edits as text: a textarea, or an `<input>` of a typing type.
pub fn is_text_field(tag: &str, attrs: &HashMap<String, String>) -> bool {
    tag == "textarea"
        || (tag == "input"
            && !attrs.get("type").is_some_and(|t| {
                matches!(
                    t.as_str(),
                    "checkbox"
                        | "radio"
                        | "button"
                        | "submit"
                        | "reset"
                        | "image"
                        | "range"
                        | "color"
                )
            }))
}

pub fn focusable(tag: &str, attrs: &HashMap<String, String>) -> Option<i32> {
    if attrs.contains_key("disabled") {
        return None;
    }
    let native = matches!(tag, "button" | "select" | "summary")
        || (tag == "a" && attrs.contains_key("href"))
        || is_checkable(tag, attrs);
    match attrs
        .get("tabindex")
        .and_then(|t| t.trim().parse::<i32>().ok())
    {
        Some(order) if order < 0 => None,
        Some(order) => Some(order),
        None => native.then_some(0),
    }
}

/// `box-shadow` layers. The outermost spread-only ring (Tailwind `ring-*`, with any
/// `ring-offset-*` inside it) becomes Rune's crisp outline; the rest are analytic shadows.
fn apply_shadows(mut e: El, st: &Style) -> El {
    let Some(shadows) = &st.shadows else {
        return e;
    };
    let is_ring = |s: &crate::wire::BoxShadow| {
        !s.inset && s.blur.0 == 0.0 && s.x.0 == 0.0 && s.y.0 == 0.0 && s.spread.0 > 0.0
    };
    let outer_ring = if st.outline.is_none() {
        shadows
            .iter()
            .enumerate()
            .filter(|(_, s)| is_ring(s) && color(&Some(s.color.clone())).is_some())
            .max_by(|a, b| a.1.spread.0.total_cmp(&b.1.spread.0))
            .map(|(i, _)| i)
    } else {
        None
    };
    for (i, s) in shadows.iter().enumerate() {
        let Some(c) = color(&Some(s.color.clone())) else {
            continue;
        };
        if Some(i) == outer_ring {
            let inner = shadows
                .iter()
                .filter(|o| is_ring(o) && o.spread.0 < s.spread.0)
                .map(|o| o.spread.0)
                .fold(0.0, f32::max);
            e = e.outline(s.spread.0 - inner, inner, c);
            continue;
        }
        e = e.box_shadow(Shadow {
            x: s.x.0,
            y: s.y.0,
            blur: s.blur.0,
            spread: s.spread.0,
            color: c,
            inset: s.inset,
        });
    }
    e
}

/// `inset-y-1/2 -translate-y-1/2`: Rune has no percentage insets, so centre in a full-height slot.
pub fn center_vertically(e: El, st: &Style) -> El {
    match (st.absolute, st.center_y) {
        // `left-1/2 -translate-x-1/2` (and both axes): centred in a full-width slot at its insets.
        (Some([_, t, _, b]), centre_y) if st.center_x == Some(true) => {
            let both = centre_y == Some(true);
            let slot = if both {
                row()
                    .pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0))
                    .items_center()
            } else {
                row().pin(Some(0.0), f(t), Some(0.0), f(b)).items_start()
            };
            slot.justify_center().child(e)
        }
        (Some([l, _, r, _]), Some(true)) => {
            // Pinned on both sides with no width of its own, CSS stretches it between them
            // (`inset-x-0 top-1/2`: a full-width divider or overlay).
            let spans = f(l).is_some() && f(r).is_some() && st.w.is_none();
            row()
                .pin(f(l), Some(0.0), f(r), Some(0.0))
                .items_center()
                .child(if spans { e.grow(1.0) } else { e })
        }
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
        // Rune has no baseline alignment; lines of different sizes sharing a row (a name and
        // its timestamp) sit bottom-aligned, within a point or two of their shared baseline.
        Some("flex-end" | "end" | "baseline") => e = e.items_end(),
        Some("stretch") => e = e.items_stretch(),
        _ => {}
    }
    match st.justify.as_deref() {
        Some("center") => e = e.justify_center(),
        Some("space-between") => e = e.justify_between(),
        Some("space-around") => e = e.justify_around(),
        Some("space-evenly") => e = e.justify_evenly(),
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

/// Auto margins, which Rune lacks. On the parent's main axis the child sits in a growing slot
/// that takes the free space and places it at the slot's end, start or centre (so no extra gap
/// appears); on the cross axis they align the child itself.
/// `sibling_grows`: a sibling has `flex-grow`, which takes the free space before auto margins
/// see any (CSS flexbox §9.4), so this child's main-axis auto margins resolve to zero.
pub fn auto_margins(
    child: El,
    st: &Style,
    parent_is_row: bool,
    parent_items: Option<&str>,
    sibling_grows: bool,
) -> El {
    let Some([top, right, bottom, left]) = st.margin_auto else {
        return child;
    };
    if st.absolute.is_some() {
        return child;
    }
    let (main_start, main_end, cross_start, cross_end) = if parent_is_row {
        (left, right, top, bottom)
    } else {
        (top, bottom, left, right)
    };
    let child = match (cross_start, cross_end) {
        (true, true) => child.self_center(),
        (true, false) => child.self_end(),
        (false, true) => child.self_start(),
        (false, false) => child,
    };
    if (!main_start && !main_end) || sibling_grows {
        return child;
    }
    let slot = if parent_is_row {
        row().min_w(0.0)
    } else {
        rune::col().min_h(0.0)
    };
    let slot = match (main_start, main_end) {
        (true, true) => slot.justify_center(),
        (true, false) => slot.justify_end(),
        _ => slot.justify_start(),
    };
    let slot = match parent_items {
        Some("center") => slot.items_center(),
        Some("flex-start" | "start") => slot.items_start(),
        Some("flex-end" | "end") => slot.items_end(),
        _ => slot.items_stretch(),
    };
    slot.grow(1.0).child(child)
}

/// One `grid-template-columns` track as the resolver sends it (`1fr`, `auto`, `1.5rem`, `320px`).
/// `minmax(0, 1fr)` arrives as `1fr`; anything else sizes to its content.
pub fn grid_track(template: &str) -> GridTrack {
    let num = |v: &str| v.parse::<f32>().ok();
    if let Some(fr) = template.strip_suffix("fr").and_then(num) {
        GridTrack::Fr(fr)
    } else if let Some(rem) = template.strip_suffix("rem").and_then(num) {
        GridTrack::Px(rem * 16.0)
    } else if let Some(px) = template.strip_suffix("px").and_then(num) {
        GridTrack::Px(px)
    } else {
        match template {
            "min-content" => GridTrack::MinContent,
            "max-content" => GridTrack::MaxContent,
            _ => GridTrack::Auto,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::capitalize;

    #[test]
    fn capitalize_uppercases_each_word_start() {
        assert_eq!(capitalize("hello wide world"), "Hello Wide World");
        assert_eq!(capitalize("(quoted) it's"), "(Quoted) It's");
        assert_eq!(capitalize("hello-world a/b"), "Hello-World A/B");
        assert_eq!(capitalize("node.js"), "Node.js");
    }
}

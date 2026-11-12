//! CSS flow emulated on Rune's flex layout: inline formatting contexts, line boxes, baselines,
//! paint order, and the style rewrites that make Rune's `grow` and scrolling match CSS.

use std::sync::Arc;

use rune::{El, row};

use crate::layout::{ASCENT, DESCENT, Inherit, auto_margins};
use crate::wire::{self, F, Node, Style};

use super::state::{child_path, is_portal};
use super::{Ctx, build};

pub(super) fn is_inline_tag(tag: &str) -> bool {
    matches!(
        tag,
        "span" | "a" | "strong" | "em" | "code" | "b" | "i" | "kbd" | "time" | "label"
    )
}

pub(super) fn is_inline(node: &Arc<Node>) -> bool {
    match node.as_ref() {
        Node::Text(_) => true,
        Node::Svg { .. } => false,
        Node::Elem {
            tag, st, children, ..
        } => match (st.inline, st.display.as_deref()) {
            // `display: contents` adds no box: inline when what it holds is.
            (_, Some("contents")) => children.iter().all(is_inline),
            (Some(true), _) | (_, Some("inline")) => true,
            (_, None) => matches!(
                tag.as_str(),
                "span"
                    | "a"
                    | "strong"
                    | "em"
                    | "code"
                    | "b"
                    | "i"
                    | "s"
                    | "u"
                    | "mark"
                    | "time"
                    | "br"
                    | "label"
                    | "kbd"
                    | "small"
                    | "abbr"
                    | "sub"
                    | "sup"
            ),
            _ => false,
        },
    }
}

/// A track-less grid of definite height (a sheet's panel, placed by its insets) stretches its
/// one in-flow child over its one implicit row; Rune lays it out as a block, so grow the child.
pub(super) fn grid_fill(st: &Style, children: &[Arc<Node>]) -> Option<Vec<Arc<Node>>> {
    let stretches = |v: &Option<String>| {
        v.as_deref()
            .is_none_or(|v| matches!(v, "stretch" | "normal"))
    };
    let definite = matches!(st.h, Some(wire::Len::Px(_) | wire::Len::Full))
        || matches!(st.absolute, Some([_, Some(_), _, Some(_)]));
    if st.display.as_deref() != Some("grid")
        || st.grid_cols.is_some()
        || st.grid_rows.is_some()
        || !definite
        || !stretches(&st.justify)
        || !stretches(&st.items)
    {
        return None;
    }
    let in_flow = |node: &Arc<Node>| match node.as_ref() {
        Node::Elem { st, .. } => {
            st.display.as_deref() != Some("none") && st.absolute.is_none() && !is_portal(node)
        }
        Node::Svg { .. } => true,
        Node::Text(text) => !text.trim().is_empty(),
    };
    let mut flow = children.iter().enumerate().filter(|(_, c)| in_flow(c));
    let (at, only) = flow.next()?;
    if flow.next().is_some() {
        return None;
    }
    let Node::Elem { st: child, .. } = only.as_ref() else {
        return None;
    };
    let auto_block_margin = child.margin_auto.is_some_and(|m| m[0] || m[2]);
    // `h-fit` is a size, never stretched.
    if matches!(
        child.h,
        Some(wire::Len::Px(_) | wire::Len::Full | wire::Len::Frac(_) | wire::Len::Fit)
    ) || child.grow.is_some()
        || !stretches(&child.align_self)
        || auto_block_margin
    {
        return None;
    }
    let mut out = children.to_vec();
    out[at] = restyle(
        only,
        "fill",
        Style {
            grow: Some(F(1.0)),
            ..child.clone()
        },
    )?;
    Some(out)
}

/// `node` with the style `st`, under its own memo key: the same wire node styled otherwise is a
/// different El.
pub(super) fn restyle(node: &Node, suffix: &str, st: Style) -> Option<Arc<Node>> {
    let Node::Elem {
        hash,
        tag,
        key,
        attrs,
        on,
        observed,
        ov,
        children,
        ..
    } = node
    else {
        return None;
    };
    Some(Arc::new(Node::Elem {
        hash: format!("{hash}~{suffix}"),
        tag: tag.clone(),
        key: key.clone(),
        st,
        attrs: attrs.clone(),
        on: on.clone(),
        observed: *observed,
        ov: ov.clone(),
        children: children.clone(),
    }))
}

pub(super) fn size_to_content(node: &Arc<Node>) -> Arc<Node> {
    drop_grow(node, true)
}

/// `node` without its `grow` (and its `min-h`, with `min_h_too`), under its own memo key.
pub(super) fn drop_grow(node: &Arc<Node>, min_h_too: bool) -> Arc<Node> {
    match node.as_ref() {
        Node::Elem { st, .. } if st.grow.is_some() && st.absolute.is_none() => {
            let st = Style {
                grow: None,
                min_h: if min_h_too { None } else { st.min_h.clone() },
                ..st.clone()
            };
            restyle(node, if min_h_too { "content" } else { "basis" }, st)
                .unwrap_or_else(|| node.clone())
        }
        _ => node.clone(),
    }
}

/// A child that keeps a scrolling flex column from overflowing, as CSS flexes it: one that
/// fills with a scroller, or one that grows and may shrink to nothing (`flex-1 min-h-0`, or
/// `overflow: hidden`, whose automatic minimum size is zero).
pub(super) fn bounds_scroller(node: &Arc<Node>) -> bool {
    if fills_with_scroll(node) {
        return true;
    }
    let Node::Elem { st, .. } = node.as_ref() else {
        return false;
    };
    st.grow.is_some_and(|g| g.0 > 0.0)
        && st.shrink.is_none_or(|s| s.0 > 0.0)
        && (st.min_h == Some(wire::Len::Px(wire::F(0.0))) || st.clip == Some(true))
}

/// A child that fills its parent (grows, or is full height) and either scrolls itself or holds
/// such a child: a chain of filling elements down to a scroller (`display: contents` is seen through).
fn fills_with_scroll(node: &Arc<Node>) -> bool {
    let Node::Elem { st, children, .. } = node.as_ref() else {
        return false;
    };
    if st.display.as_deref() == Some("contents") {
        return children.iter().any(fills_with_scroll);
    }
    let fills = st.grow.is_some_and(|g| g.0 > 0.0) || st.h == Some(wire::Len::Full);
    fills && (st.scroll_y == Some(true) || children.iter().any(fills_with_scroll))
}

/// `children` with each run of adjacent text nodes as one, at the first one's index: the DOM
/// lays `["6", " users"]` out as one text (and one flex item). `None` when no two are adjacent.
pub(super) fn join_text(children: &[Arc<Node>]) -> Option<Vec<(usize, Arc<Node>)>> {
    let is_text = |node: &Arc<Node>| matches!(node.as_ref(), Node::Text(_));
    if !children
        .windows(2)
        .any(|pair| is_text(&pair[0]) && is_text(&pair[1]))
    {
        return None;
    }
    let mut out: Vec<(usize, Arc<Node>)> = Vec::with_capacity(children.len());
    for (i, child) in children.iter().enumerate() {
        match (out.last_mut(), child.as_ref()) {
            (Some((_, last)), Node::Text(more)) if is_text(last) => {
                let Node::Text(text) = last.as_ref() else {
                    continue;
                };
                *last = Arc::new(Node::Text(format!("{text}{more}")));
            }
            _ => out.push((i, child.clone())),
        }
    }
    Some(out)
}

/// How a container lays out its children, for the children's auto margins.
#[derive(Clone, Copy)]
pub(super) struct Parent<'a> {
    pub(super) is_row: bool,
    pub(super) items: Option<&'a str>,
    /// A block container: its inline-level children (`inline-flex`, `inline-block`) keep their
    /// own width and sit where `text-align` puts them, rather than stretching across it.
    pub(super) block: bool,
}

pub(super) fn style_of(node: &Node) -> Option<&Style> {
    match node {
        Node::Elem { st, .. } | Node::Svg { st, .. } => Some(st),
        Node::Text(_) => None,
    }
}

/// Paint order among siblings. Rune paints in tree order, so positioned children move after
/// the flow (CSS paints them above it), sorted by `z-index`; a negative one, or one below a flow
/// child's own `z-index`, goes under the flow.
/// Out-of-flow children take no part in layout, so moving them changes only paint.
fn paint_order<'a>(kids: &[(usize, &'a Arc<Node>)]) -> Vec<(usize, &'a Arc<Node>)> {
    let layer = |node: &Arc<Node>| -> Option<f32> {
        let st = style_of(node)?;
        st.absolute?;
        Some(st.z_index.map_or(0.0, |z| z.0))
    };
    if !kids
        .iter()
        .any(|(_, c)| style_of(c).is_some_and(|st| st.z_index.is_some()))
    {
        return kids.to_vec();
    }
    let mut ordered: Vec<(usize, &Arc<Node>)> = Vec::with_capacity(kids.len());
    let mut positioned: Vec<(f32, usize, &Arc<Node>)> = Vec::new();
    for &(i, child) in kids {
        match layer(child) {
            Some(z) => positioned.push((z, i, child)),
            None => ordered.push((i, child)),
        }
    }
    positioned.sort_by(|a, b| a.0.total_cmp(&b.0));
    // A flow child with a `z-index` (`relative z-20`, a flex item's) stacks above a positioned
    // sibling with a lower one: that sibling paints under the flow (a background image).
    let flow_z = ordered
        .iter()
        .filter_map(|(_, c)| style_of(c).and_then(|st| st.z_index).map(|z| z.0))
        .fold(0.0, f32::max);
    let below = positioned
        .iter()
        .take_while(|p| p.0 < 0.0 || p.0 < flow_z)
        .count();
    let mut out: Vec<(usize, &Arc<Node>)> =
        positioned[..below].iter().map(|p| (p.1, p.2)).collect();
    out.extend(ordered);
    out.extend(positioned[below..].iter().map(|p| (p.1, p.2)));
    out
}

pub(super) fn add_children(
    mut e: El,
    kids: &[(usize, &Arc<Node>)],
    path: &str,
    inh: Inherit,
    ctx: &Ctx,
    parent: Parent,
) -> El {
    let grows = |node: &Arc<Node>| {
        style_of(node).is_some_and(|st| st.absolute.is_none() && st.grow.is_some_and(|g| g.0 > 0.0))
    };
    // `align-items: baseline`: the children start at the top and each drops by what its first
    // baseline lacks of the deepest one. One with no text keeps to the bottom, as before.
    let deepest = if parent.is_row && parent.items == Some("baseline") {
        kids.iter()
            .filter_map(|(_, child)| first_baseline(child, inh))
            .reduce(f32::max)
    } else {
        None
    };
    if deepest.is_some() {
        e = e.items_start();
    }
    for (i, child) in paint_order(kids) {
        let child_path = child_path(path, i, child);
        if is_portal(child) && ctx.portal != Some(child_path.as_str()) {
            continue;
        }
        // `display: contents`: no box of its own; its children join this one's layout.
        if let Node::Elem { st, children, .. } = child.as_ref()
            && st.display.as_deref() == Some("contents")
        {
            let inner: Vec<(usize, &Arc<Node>)> = children.iter().enumerate().collect();
            // It has no box to trim either: its text is still this box's own.
            let through = Inherit {
                trim: inh.trim,
                ..inh.from(st)
            };
            e = add_children(e, &inner, &child_path, through, ctx, parent);
            continue;
        }
        if let Some(b) = build(child, &child_path, inh, ctx) {
            let b = match style_of(child) {
                Some(st)
                    if parent.block
                        && st.absolute.is_none()
                        && (is_atomic_inline(child, st) || is_inline(child)) =>
                {
                    let [mt, _, mb, _] = st.margin.map_or([0.0; 4], |m| m.map(|v| v.0));
                    let atomic = is_atomic_inline(child, st);
                    let (top, bottom) = line_box_space(child, st, inh, atomic);
                    if top > 0.0 || bottom > 0.0 {
                        b.mt(mt + top).mb(mb + bottom)
                    } else {
                        b
                    }
                }
                _ => b,
            };
            let b = match style_of(child) {
                Some(st)
                    if parent.block
                        && (st.inline == Some(true) || is_inline(child))
                        && st.absolute.is_none()
                        && st.w.is_none() =>
                {
                    // A line across the block: the inline box keeps its own width but shrinks to
                    // the line, so its text wraps instead of running past the block's edge.
                    let line = row().items_start();
                    let line = match inh.align {
                        rune::Align::Center => line.justify_center(),
                        rune::Align::End => line.justify_end(),
                        _ => line,
                    };
                    line.child(b)
                }
                _ => b,
            };
            let b = match (deepest, first_baseline(child, inh)) {
                (Some(deepest), Some(own)) => {
                    let mt = style_of(child)
                        .and_then(|st| st.margin)
                        .map_or(0.0, |m| m[0].0);
                    b.mt(mt + deepest - own)
                }
                (Some(_), None) => b.self_end(),
                _ => b,
            };
            // `fit-content` across the parent's cross axis is a size, so `align-items: stretch`
            // (and a block's own stretch) leaves the box at its content's, at the start.
            let b = match style_of(child) {
                Some(st) if st.absolute.is_none() && st.align_self.is_none() => {
                    let cross = if parent.is_row { &st.h } else { &st.w };
                    if *cross == Some(wire::Len::Fit) {
                        b.self_start()
                    } else {
                        b
                    }
                }
                _ => b,
            };
            // CSS's default `flex-shrink: 1` in a row, where Rune boxes keep their size unless
            // told to shrink: a `w-full` item beside others gives them their room, and a
            // `min-w-0` one (the idiom for "may shrink below its content") shrinks to the row, so
            // its text wraps or truncates instead of running past the row's edge.
            let b = match style_of(child) {
                Some(st)
                    if parent.is_row
                        && kids.len() > 1
                        && st.shrink.is_none()
                        && st.absolute.is_none()
                        && match &st.min_w {
                            None => st.w == Some(wire::Len::Full),
                            Some(wire::Len::Px(min)) => min.0 == 0.0,
                            Some(_) => false,
                        } =>
                {
                    b.shrink()
                }
                _ => b,
            };
            e = match style_of(child) {
                Some(st) => {
                    let sibling_grows =
                        kids.iter().any(|(_, k)| !Arc::ptr_eq(k, child) && grows(k));
                    e.child(auto_margins(
                        b,
                        st,
                        parent.is_row,
                        parent.items,
                        sibling_grows,
                    ))
                }
                None => e.child(b),
            }
        }
    }
    e
}

/// Space a CSS line box adds above and below an atomic inline child (`inline-block`) of a
/// block: the child sits on the baseline of a line at least as tall as the parent's strut. A
/// child with no text has its baseline at its bottom edge, so the strut's descent shows below
/// it. A text child aligns its first line's baseline (one line assumed). Others: none.
fn line_box_space(node: &Node, st: &Style, inh: Inherit, atomic: bool) -> (f32, f32) {
    let metrics = |size: f32, line: f32| {
        let half_leading = (line - (ASCENT + DESCENT) * size) / 2.0;
        (half_leading + ASCENT * size, half_leading + DESCENT * size)
    };
    let (strut_above, strut_below) = metrics(inh.size, inh.line);
    // An inline box's own padding, border and margin do not size its line; an inline-block's do.
    let edge = |side: usize| {
        if !atomic {
            return 0.0;
        }
        [st.margin, st.border, st.pad]
            .iter()
            .map(|b| b.map_or(0.0, |b| b[side].0))
            .sum::<f32>()
    };
    let (above, below) = if has_text(node) {
        if st.h.is_some() {
            return (0.0, 0.0);
        }
        let own = inh.from(st);
        let (a, b) = metrics(own.size, own.line);
        // A trimmed box ends at its metric: that much less of it lies above and below the baseline.
        (edge(0) + a - own.trim[0], edge(2) + b - own.trim[1])
    } else {
        let Some(wire::Len::Px(h)) = st.h else {
            return (0.0, 0.0);
        };
        let [mt, _, mb, _] = st.margin.map_or([0.0; 4], |m| m.map(|v| v.0));
        (mt + h.0 + mb, 0.0)
    };
    (
        (strut_above - above).max(0.0),
        (strut_below - below).max(0.0),
    )
}

/// How far below a node's top margin edge its first line of text has its baseline; `None`
/// when it holds no text in flow. Chromium lays lines out on whole-pixel font metrics.
fn first_baseline(node: &Node, inh: Inherit) -> Option<f32> {
    match node {
        Node::Text(text) if text.trim().is_empty() => None,
        Node::Text(_) => {
            let (ascent, descent) = ((ASCENT * inh.size).round(), (DESCENT * inh.size).round());
            let half_leading = ((inh.line - ascent - descent) / 2.0).floor();
            Some(half_leading + ascent - inh.trim[0])
        }
        Node::Svg { .. } => None,
        Node::Elem { st, children, .. } => {
            if st.display.as_deref() == Some("none") || st.absolute.is_some() {
                return None;
            }
            let own = inh.from(st);
            let edge: f32 = [st.margin, st.border, st.pad]
                .iter()
                .map(|b| b.map_or(0.0, |b| b[0].0))
                .sum();
            children
                .iter()
                .find_map(|child| first_baseline(child, own))
                .map(|inner| edge + inner)
        }
    }
}

/// An `inline-block`-like box: `inline-flex`/`inline-block`, or a control a browser draws so.
fn is_atomic_inline(node: &Node, st: &Style) -> bool {
    match (st.inline, st.display.as_deref(), node) {
        (Some(inline), _, _) => inline,
        (None, None, Node::Elem { tag, .. }) => {
            matches!(
                tag.as_str(),
                "button" | "img" | "input" | "select" | "textarea"
            )
        }
        _ => false,
    }
}

/// Whether text flows inside the node (not in an absolutely placed descendant).
fn has_text(node: &Node) -> bool {
    match node {
        Node::Text(t) => !t.trim().is_empty(),
        Node::Svg { .. } => false,
        Node::Elem { st, children, .. } => {
            st.display.as_deref() != Some("none")
                && st.absolute.is_none()
                && children.iter().any(|c| has_text(c))
        }
    }
}

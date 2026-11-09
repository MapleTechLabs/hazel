//! CSS margin collapsing, which Rune's flex layout does not do: in block flow, adjacent
//! siblings' vertical margins merge into the larger of the two, and a block's first (last)
//! child's top (bottom) margin passes through it when nothing separates them. Applied to each
//! tree before it is built; a subtree with nothing to collapse comes back as the same `Arc`.

use std::sync::Arc;

use crate::wire::{F, Len, Node, Style};

/// Tags whose default display is inline: they take part in a line, not in block flow.
const INLINE_TAGS: [&str; 18] = [
    "span", "a", "strong", "em", "code", "b", "i", "s", "u", "mark", "time", "br", "label", "kbd",
    "small", "abbr", "sub", "sup",
];
/// Elements the host lays out as replaced boxes or tables: their insides are their own.
const OPAQUE_TAGS: [&str; 6] = ["input", "textarea", "img", "table", "select", "button"];

fn margin(st: &Style, side: usize) -> f32 {
    st.margin.map_or(0.0, |m| m[side].0)
}

fn edge(st: &Style, side: usize) -> f32 {
    st.pad.map_or(0.0, |p| p[side].0) + st.border.map_or(0.0, |b| b[side].0)
}

/// Lays its children out in block flow: a block box that is neither flex, grid, nor a table.
fn is_block_container(tag: &str, st: &Style) -> bool {
    let block = match st.display.as_deref() {
        Some("block") => true,
        None => !INLINE_TAGS.contains(&tag),
        _ => false,
    };
    block && st.inline != Some(true) && !OPAQUE_TAGS.contains(&tag)
}

/// A block-level box in its parent's flow: it collapses margins with its siblings.
fn is_block_level(node: &Node) -> bool {
    match node {
        Node::Elem { tag, st, .. } => {
            let out_of_flow = st.absolute.is_some() || st.fixed == Some(true);
            let shown =
                st.display.as_deref() != Some("none") && st.display.as_deref() != Some("contents");
            let inline = match st.display.as_deref() {
                Some("block" | "flex" | "grid") => st.inline == Some(true),
                Some(_) => true,
                None => st.inline == Some(true) || INLINE_TAGS.contains(&tag.as_str()),
            };
            shown && !out_of_flow && !inline
        }
        _ => false,
    }
}

/// Takes no part in the flow at all (hidden, or placed out of it).
fn is_absent(node: &Node) -> bool {
    match node {
        Node::Text(t) => t.trim().is_empty(),
        Node::Elem { st, .. } => {
            st.display.as_deref() == Some("none") || st.absolute.is_some() || st.fixed == Some(true)
        }
        Node::Svg { .. } => false,
    }
}

/// A block container whose children's margins can pass through it: in its parent's flow, not
/// clipping, scrolling or contained (those start a new formatting context).
fn lets_margins_through(tag: &str, st: &Style) -> bool {
    is_block_container(tag, st)
        && st.clip != Some(true)
        && st.isolated != Some(true)
        && st.scroll_y != Some(true)
        && st.absolute.is_none()
        && st.fixed != Some(true)
}

fn with_margins(
    node: &Arc<Node>,
    top: f32,
    bottom: f32,
    children: Option<Vec<Arc<Node>>>,
) -> Arc<Node> {
    let Node::Elem {
        hash,
        tag,
        key,
        st,
        attrs,
        on,
        observed,
        ov,
        children: own,
    } = node.as_ref()
    else {
        return node.clone();
    };
    let mut m = st.margin.unwrap_or([F(0.0); 4]);
    let changed_margins = m[0].0 != top || m[2].0 != bottom;
    if !changed_margins && children.is_none() {
        return node.clone();
    }
    m[0] = F(top);
    m[2] = F(bottom);
    Arc::new(Node::Elem {
        hash: format!("{hash}~m{top}/{bottom}"),
        tag: tag.clone(),
        key: key.clone(),
        st: Style {
            margin: Some(m),
            ..st.clone()
        },
        attrs: attrs.clone(),
        on: on.clone(),
        observed: *observed,
        ov: ov.clone(),
        children: children.unwrap_or_else(|| own.clone()),
    })
}

/// `node` with its margins collapsed as CSS would. `in_flow`: it is a block-level box in a
/// parent's block flow, so its first and last children's margins may pass through it.
pub fn collapse(node: &Arc<Node>, in_flow: bool) -> Arc<Node> {
    let Node::Elem {
        tag, st, children, ..
    } = node.as_ref()
    else {
        return node.clone();
    };
    let flow = is_block_container(tag, st);
    // Children first: their own children's margins may have passed up into them.
    let mut kids: Vec<Arc<Node>> = children
        .iter()
        .map(|c| collapse(c, flow && is_block_level(c)))
        .collect();
    let mut changed = kids.iter().zip(children).any(|(a, b)| !Arc::ptr_eq(a, b));
    let (mut top, mut bottom) = (margin(st, 0), margin(st, 2));
    if flow {
        // Adjacent siblings: the gap is the larger margin (with `space-y`, the gap is its own).
        let gap = st.child_gap.map_or(0.0, |g| g.0);
        let mut prev_bottom: Option<f32> = None;
        for kid in kids.iter_mut() {
            if is_absent(kid) {
                continue;
            }
            if !is_block_level(kid) {
                prev_bottom = None;
                continue;
            }
            let Node::Elem { st: kst, .. } = kid.as_ref() else {
                continue;
            };
            let (mt, mb) = (margin(kst, 0), margin(kst, 2));
            let new_top = match prev_bottom {
                Some(pb) if mt >= 0.0 && pb >= 0.0 => (mt.max(pb) - pb - gap).max(0.0),
                _ => mt,
            };
            if new_top != mt {
                *kid = with_margins(kid, new_top, mb, None);
                changed = true;
            }
            prev_bottom = Some(mb);
        }
        // First and last children's margins pass through a block nothing separates them from.
        if in_flow && lets_margins_through(tag, st) {
            let first = kids.iter().position(|k| !is_absent(k));
            if let Some(i) = first.filter(|&i| is_block_level(&kids[i]) && edge(st, 0) == 0.0)
                && let Node::Elem { st: kst, .. } = kids[i].as_ref()
            {
                let mt = margin(kst, 0);
                if mt > 0.0 && top >= 0.0 {
                    top = top.max(mt);
                    let mb = margin(kst, 2);
                    kids[i] = with_margins(&kids[i], 0.0, mb, None);
                    changed = true;
                }
            }
            let auto_height = st.h.is_none() || matches!(st.h, Some(Len::Auto));
            let last = kids.iter().rposition(|k| !is_absent(k));
            if let Some(i) = last.filter(|&i| {
                is_block_level(&kids[i]) && edge(st, 2) == 0.0 && auto_height && st.min_h.is_none()
            }) && let Node::Elem { st: kst, .. } = kids[i].as_ref()
            {
                let mb = margin(kst, 2);
                if mb > 0.0 && bottom >= 0.0 {
                    bottom = bottom.max(mb);
                    let mt = margin(kst, 0);
                    kids[i] = with_margins(&kids[i], mt, 0.0, None);
                    changed = true;
                }
            }
        }
    }
    if !changed && top == margin(st, 0) && bottom == margin(st, 2) {
        return node.clone();
    }
    with_margins(node, top, bottom, changed.then_some(kids))
}

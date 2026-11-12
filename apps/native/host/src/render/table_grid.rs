//! `<table>` and CSS grid on Rune's grid tracks.

use std::sync::Arc;

use rune::{El, el};

use crate::html::lays_out_inline;
use crate::layout::{Inherit, apply_box, grid_track};
use crate::wire::{self, F, Node, Style};

use super::flow::{is_inline, restyle};
use super::handlers::{behaviour, presses};
use super::state::{child_path, is_portal};
use super::{Ctx, build};

/// A `<table>`: one grid whose columns every row shares, so cells line up as in CSS table
/// layout. Each row's cells take its background, bottom border and hover (shared across the
/// row); a cell's `colspan` spans columns. Cells keep their own paths.
pub(super) fn build_table<'a>(
    path: &str,
    st: &Style,
    children: &'a [Arc<Node>],
    inh: Inherit,
    ctx: &Ctx,
) -> El {
    struct Row<'a> {
        path: String,
        st: Style,
        cells: Vec<(String, &'a Arc<Node>)>,
    }
    let mut rows: Vec<Row<'a>> = Vec::new();
    let mut add_row = |row_path: String, row: &'a Arc<Node>, group: Option<&Style>| {
        let Node::Elem {
            st: rst, children, ..
        } = row.as_ref()
        else {
            return;
        };
        let mut merged = group.cloned().unwrap_or_default();
        for (field, value) in [
            (&mut merged.bg, &rst.bg),
            (&mut merged.hover_bg, &rst.hover_bg),
        ] {
            if value.is_some() {
                *field = value.clone();
            }
        }
        if rst.border.is_some() {
            merged.border = rst.border;
            merged.border_color = rst.border_color.clone();
        }
        merged.color = rst.color.clone().or(merged.color);
        let cells = children
            .iter()
            .enumerate()
            .filter(
                |(_, c)| matches!(c.as_ref(), Node::Elem { tag, .. } if tag == "td" || tag == "th"),
            )
            .map(|(i, c)| (child_path(&row_path, i, c), c))
            .collect();
        rows.push(Row {
            path: row_path,
            st: merged,
            cells,
        });
    };
    for (i, child) in children.iter().enumerate() {
        let group_path = child_path(path, i, child);
        match child.as_ref() {
            Node::Elem { tag, .. } if tag == "tr" => add_row(group_path, child, None),
            Node::Elem {
                tag,
                st: gst,
                children: rows_of,
                ..
            } if matches!(tag.as_str(), "thead" | "tbody" | "tfoot") => {
                for (j, row) in rows_of.iter().enumerate() {
                    add_row(child_path(&group_path, j, row), row, Some(gst));
                }
            }
            _ => {}
        }
    }
    let span = |cell: &Arc<Node>| match cell.as_ref() {
        Node::Elem { attrs, .. } => attrs
            .get("colspan")
            .and_then(|n| n.parse::<u16>().ok())
            .unwrap_or(1)
            .max(1),
        _ => 1,
    };
    let columns = rows
        .iter()
        .map(|r| {
            r.cells
                .iter()
                .map(|(_, c)| usize::from(span(c)))
                .sum::<usize>()
        })
        .max()
        .unwrap_or(1);
    // CSS's automatic table layout: each column gets its widest cell's max-content width and
    // a share of the spare width in proportion to it, which `fr` tracks so weighted give.
    let mut widths = vec![0.0_f32; columns];
    for row in &rows {
        let row_inh = inh.from(&row.st);
        let mut at = 0;
        for (_, cell) in &row.cells {
            let n = usize::from(span(cell));
            if n == 1
                && let Some(w) = widths.get_mut(at)
            {
                *w = w.max(max_content(cell, row_inh));
            }
            at += n;
        }
    }
    let tracks = widths.iter().map(|w| rune::GridTrack::Fr(w.max(1.0)));
    let mut grid = el().grid_columns(tracks.collect::<Vec<_>>());
    for row in &rows {
        let row_inh = inh.from(&row.st);
        for (cell_path, cell) in &row.cells {
            let Node::Elem { st: cst, .. } = cell.as_ref() else {
                continue;
            };
            let border_bottom = row.st.border.map_or(0.0, |b| b[2].0);
            let decorated = Style {
                bg: cst.bg.clone().or_else(|| row.st.bg.clone()),
                hover_bg: cst.hover_bg.clone().or_else(|| row.st.hover_bg.clone()),
                hover_share: row.st.hover_bg.as_ref().map(|_| row.path.clone()),
                border: if cst.border.is_none() && border_bottom > 0.0 {
                    Some([F(0.0), F(0.0), F(border_bottom), F(0.0)])
                } else {
                    cst.border
                },
                border_color: cst
                    .border_color
                    .clone()
                    .or_else(|| row.st.border_color.clone()),
                col_span: Some(span(cell)),
                ..cst.clone()
            };
            let Some(decorated) = restyle(cell, "row", decorated) else {
                continue;
            };
            if let Some(cell) = build(&decorated, cell_path, row_inh, ctx) {
                // A cell's content sits in the middle of its row (`vertical-align: middle`).
                let block = matches!(cst.display.as_deref(), None | Some("block" | "table-cell"));
                grid = grid.child(if block { cell.justify_center() } else { cell });
            }
        }
    }
    apply_box(grid.key(path), st)
}

/// A box's max-content width, estimated: text measured as drawn, a row's children side by side,
/// a column's widest child, an explicit width as given, plus padding and borders.
fn max_content(node: &Node, inh: Inherit) -> f32 {
    match node {
        Node::Text(t) => rune::text::measure(t.trim(), &[], inh.style(), None).0,
        Node::Svg { st, .. } => match st.w {
            Some(wire::Len::Px(w)) => w.0,
            _ => 16.0,
        },
        Node::Elem {
            st, children, tag, ..
        } => {
            if st.display.as_deref() == Some("none") || st.absolute.is_some() {
                return 0.0;
            }
            let side = |b: Option<[F; 4]>| b.map_or(0.0, |b| b[1].0 + b[3].0);
            let edges = side(st.pad) + side(st.border) + side(st.margin);
            if let Some(wire::Len::Px(w)) = st.w {
                return w.0 + side(st.margin);
            }
            let own = inh.from(st);
            let kids = children.iter().map(|c| max_content(c, own));
            let row = match st.display.as_deref() {
                Some("flex") => st.dir.as_deref() != Some("col"),
                Some("grid") => false,
                _ => lays_out_inline(tag) || children.iter().all(is_inline),
            };
            let inner = if row {
                let gap = st.gap_col.map_or(0.0, |g| g.0) * children.len().saturating_sub(1) as f32;
                kids.sum::<f32>() + gap
            } else {
                kids.fold(0.0, f32::max)
            };
            inner + edges
        }
    }
}

/// CSS grid on Rune's grid tracks. `display: contents` children are grid items through their own
/// children. Taffy has no subgrid, so a subgrid item spans its row and lays its children out on
/// the same column tracks (an `auto` column then sizes per row, not across the grid).
pub(super) fn build_grid(
    kids: &[(usize, &Arc<Node>)],
    cols: &[String],
    path: &str,
    inh: Inherit,
    ctx: &Ctx,
    st: &Style,
) -> El {
    let mut grid = el().grid_columns(cols.iter().map(|c| grid_track(c))).gaps(
        st.gap_row.map(|g| g.0).unwrap_or(0.0),
        st.gap_col.map(|g| g.0).unwrap_or(0.0),
    );
    grid = match st.items.as_deref() {
        Some("start" | "flex-start") => grid.items_start(),
        Some("center") => grid.items_center(),
        Some("end" | "flex-end") => grid.items_end(),
        _ => grid,
    };
    if let Some(rows) = &st.grid_rows {
        grid = grid.grid_rows(rows.iter().map(|r| grid_track(r)));
    }
    if st.justify_items.as_deref() == Some("center") {
        grid = grid.grid_justify_center();
    }
    let mut items: Vec<(String, &Arc<Node>)> = Vec::new();
    fn flatten<'a>(
        children: impl Iterator<Item = (usize, &'a Arc<Node>)>,
        path: &str,
        items: &mut Vec<(String, &'a Arc<Node>)>,
    ) {
        for (i, child) in children {
            let child_path = child_path(path, i, child);
            // A portal draws at the window's root (`view`), not in the grid.
            if is_portal(child) {
                continue;
            }
            match child.as_ref() {
                Node::Elem { st, children, .. } if st.display.as_deref() == Some("contents") => {
                    flatten(children.iter().enumerate(), &child_path, items);
                }
                _ => items.push((child_path, child)),
            }
        }
    }
    flatten(kids.iter().map(|(i, c)| (*i, *c)), path, &mut items);
    for (path, child) in items {
        let path = path.as_str();
        let built = match child.as_ref() {
            Node::Elem {
                st: cst,
                children: grand,
                on,
                tag,
                attrs,
                ..
            } if cst.subgrid == Some(true) && cst.absolute.is_none() => {
                let inner: Vec<(usize, &Arc<Node>)> = grand.iter().enumerate().collect();
                let sub = Style {
                    grid_cols: Some(cols.to_vec()),
                    gap_col: cst.gap_col.or(st.gap_col),
                    ..cst.clone()
                };
                let e = build_grid(&inner, cols, path, inh.from(cst), ctx, &sub).key(path);
                let e = presses(apply_box(e, cst), path, tag, attrs, on, ctx);
                let e = behaviour(e, path, tag, attrs, on, cst, ctx.keys).grid_column_full();
                // A subgrid always stretches across its tracks: `justify-items` does not place it.
                let centred = st.justify_items.as_deref() == Some("center");
                Some(if centred && cst.w.is_none() {
                    e.w_full()
                } else {
                    e
                })
            }
            Node::Elem { st: cst, .. } if cst.col_span_full == Some(true) => {
                build(child, path, inh, ctx).map(El::grid_column_full)
            }
            _ => build(child, path, inh, ctx),
        };
        let row_start = match child.as_ref() {
            Node::Elem { st: cst, .. } => cst.row_start,
            _ => None,
        };
        if let Some(b) = built {
            grid = grid.child(match row_start {
                Some(line) => b.grid_row_start(line),
                None => b,
            })
        }
    }
    grid
}

/// A rough height for a scrolling grid's rows: a menu item per row, and a header and gap more
/// for each `role="group"` section of rows (the command palette's). Only decides whether the
/// grid overflows its `max-h`.
pub(super) fn grid_height_estimate(kids: &[(usize, &Arc<Node>)]) -> f32 {
    const ROW: f32 = 34.0;
    const SECTION: f32 = 24.0;
    kids.iter()
        .map(|(_, node)| match node.as_ref() {
            Node::Elem {
                children, attrs, ..
            } if attrs.get("role").is_some_and(|r| r == "group") && !children.is_empty() => {
                SECTION + children.len() as f32 * ROW
            }
            _ => ROW,
        })
        .sum()
}

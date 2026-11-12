//! Native islands: an element the app marks `data-native="<component>"` is shown or driven by a
//! native view (UIKit on iOS) laid over the box Rune draws for it, the way `frames` lays a web
//! view over an `<iframe>`'s box. The element's children are its fallback: what Rune draws where
//! no shell realises the component (macOS today, and the web app, which ignores the attribute).
//!
//! This module is the platform-free half: it finds the islands of a tree (`collect`), places each
//! one after every frame with the placement `frames` uses (`sync`), and turns what the native
//! view reports back into the DOM events the fallback's own handlers expect (`press`, `change`).
//! A shell installs the other half, a `Realiser`, which owns the native views.
//!
//! Nothing new crosses to the runtime: a native tab press is the `click` of the fallback link it
//! stands for, and a native picker's choice is a `change` on the island's element.
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use serde_json::json;

use crate::frames::{self, Placement};
use crate::outbox::{generation, next_seq, write_line};
use crate::wire::Node;

/// The attribute that names an island's component.
pub const ATTR: &str = "data-native";
/// JSON the component reads: what it cannot take from the fallback's own elements.
const PROPS: &str = "data-native-props";
/// Marks a descendant the native view shows as one of its items (a tab), with its id.
const ITEM: &str = "data-native-item";
/// The item's SF Symbol name.
const SYMBOL: &str = "data-native-symbol";
/// The item is the selected one.
const SELECTED: &str = "data-native-selected";
/// A count the native item shows as its badge (unread activity).
const BADGE: &str = "data-native-badge";
/// Marks a part of an item the native view shows another way (the badge's own digits): not
/// part of its title.
const SKIP: &str = "data-native-skip";

/// Who draws an island's pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Draws {
    /// The native view: Rune lays the fallback out, for the box's size, and paints none of it.
    Native,
    /// Rune, as everywhere else: the native view is clear and adds only its interaction (a menu
    /// that opens from a button Rune drew).
    Fallback,
}

/// One element of the fallback the native view shows as an item of its own: a tab for a link.
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub id: String,
    /// The element's text.
    pub title: String,
    pub symbol: Option<String>,
    pub selected: bool,
    pub badge: Option<String>,
    /// The element's own icon, the first inline SVG in it: its viewBox size and body. A native
    /// view shows it rather than the SF Symbol, so the item looks as the app draws it.
    pub icon: Option<(f32, String)>,
    /// The element's text colour, as the app styled it: the selected item's is the view's tint.
    pub color: Option<String>,
    /// The element's `click` handler, and the `href` a link follows.
    click: Option<u32>,
    href: Option<String>,
}

/// An island in the tree.
#[derive(Debug, Clone, PartialEq)]
pub struct IslandSpec {
    /// The element's path, which is also its Rune key.
    pub path: String,
    /// The component: `tab-bar`, `menu`, `date-picker`.
    pub name: String,
    pub props: serde_json::Value,
    pub items: Vec<Item>,
    /// The element's own `change` handler: where a picker's choice goes.
    change: Option<u32>,
    /// The ancestors that clip it, by path.
    pub clips: Vec<String>,
}

/// An island and where its native view goes; `None` when nothing of it shows.
pub type Placed<'a> = (&'a IslandSpec, Option<Placement>);

/// A shell's native half. Both run on the main thread.
pub struct Realiser {
    /// Whether the shell has the component, and who draws it.
    pub draws: fn(name: &str) -> Option<Draws>,
    /// Brings the native views in line with the islands of the frame just drawn: creates the new
    /// ones, removes the ones whose island is gone, and puts each where its box was drawn
    /// (`None`: nothing of it shows). `dark`: the page is dark, whatever the system's appearance
    /// (the app has a theme of its own), so the views must be too.
    pub apply: fn(placed: &[Placed], dark: bool),
}

static REALISER: OnceLock<Realiser> = OnceLock::new();

/// Installs the shell's native half; without one every island stays its fallback.
pub fn set_realiser(realiser: Realiser) {
    let _ = REALISER.set(realiser);
}

/// Who draws the component, when the shell realises it.
pub fn draws(name: &str) -> Option<Draws> {
    REALISER.get().and_then(|realiser| (realiser.draws)(name))
}

/// The islands of a tree the shell realises, in document order.
pub fn collect(root: &Arc<Node>) -> Vec<IslandSpec> {
    let mut out = Vec::new();
    if REALISER.get().is_some() {
        walk(root, "r", &mut Vec::new(), &mut out);
    }
    out
}

fn walk(node: &Arc<Node>, path: &str, clips: &mut Vec<String>, out: &mut Vec<IslandSpec>) {
    let Node::Elem {
        st,
        attrs,
        on,
        children,
        ..
    } = node.as_ref()
    else {
        return;
    };
    if st.display.as_deref() == Some("none") {
        return;
    }
    if let Some(name) = attrs.get(ATTR).filter(|name| draws(name).is_some()) {
        let mut items = Vec::new();
        for (i, child) in children.iter().enumerate() {
            collect_items(child, &crate::child_path(path, i, child), &mut items);
        }
        out.push(IslandSpec {
            path: path.to_string(),
            name: name.clone(),
            props: attrs
                .get(PROPS)
                .and_then(|props| serde_json::from_str(props).ok())
                .unwrap_or(serde_json::Value::Null),
            items,
            change: on.get("change").copied(),
            clips: clips.clone(),
        });
        // An island's own subtree is its fallback: no islands inside it.
        return;
    }
    // A portal draws at the window's root: what clips the place it left does not clip it.
    let mut own_clips = Vec::new();
    let clips = if crate::is_portal(node) {
        &mut own_clips
    } else {
        clips
    };
    let clipping = st.scroll_y == Some(true) || st.clip == Some(true);
    if clipping {
        clips.push(path.to_string());
    }
    for (i, child) in children.iter().enumerate() {
        walk(child, &crate::child_path(path, i, child), clips, out);
    }
    if clipping {
        clips.pop();
    }
}

fn collect_items(node: &Arc<Node>, path: &str, out: &mut Vec<Item>) {
    let Node::Elem {
        tag,
        st,
        attrs,
        on,
        children,
        ..
    } = node.as_ref()
    else {
        return;
    };
    if let Some(id) = attrs.get(ITEM) {
        let mut title = String::new();
        text_of(node, &mut title);
        out.push(Item {
            id: id.clone(),
            title: title.trim().to_string(),
            symbol: attrs.get(SYMBOL).cloned(),
            selected: attrs.contains_key(SELECTED),
            badge: attrs.get(BADGE).cloned(),
            icon: icon_of(node),
            color: st.color.clone(),
            click: on.get("click").copied(),
            href: attrs.get("href").filter(|_| tag == "a").cloned(),
        });
        return;
    }
    for (i, child) in children.iter().enumerate() {
        collect_items(child, &crate::child_path(path, i, child), out);
    }
}

/// The first inline SVG under `node`, outside the parts the native view skips.
fn icon_of(node: &Arc<Node>) -> Option<(f32, String)> {
    match node.as_ref() {
        Node::Svg { view, body, .. } => Some((*view, body.clone())),
        Node::Elem {
            attrs, children, ..
        } if !attrs.contains_key(SKIP) => children.iter().find_map(icon_of),
        _ => None,
    }
}

fn text_of(node: &Arc<Node>, out: &mut String) {
    match node.as_ref() {
        Node::Text(text) => out.push_str(text),
        Node::Elem {
            attrs, children, ..
        } if !attrs.contains_key(SKIP) => children.iter().for_each(|child| text_of(child, out)),
        Node::Elem { .. } => {}
        Node::Svg { .. } => {}
    }
}

/// The element as Rune builds it under a view that draws itself: the same box, for its size and
/// place, with nothing painted and nothing to press.
pub(crate) fn ghost(node: &Arc<Node>) -> Arc<Node> {
    let Node::Elem {
        hash,
        tag,
        key,
        st,
        attrs,
        observed,
        ov,
        children,
        ..
    } = node.as_ref()
    else {
        return node.clone();
    };
    let mut st = st.clone();
    st.bg = None;
    st.bg_image = None;
    st.border = None;
    st.shadows = None;
    let mut attrs = attrs.clone();
    // Built as a plain element from here on.
    attrs.remove(ATTR);
    Arc::new(Node::Elem {
        hash: hash.clone(),
        tag: tag.clone(),
        key: key.clone(),
        st,
        attrs,
        on: HashMap::new(),
        observed: *observed,
        ov: ov.clone(),
        children: children.iter().map(hidden).collect(),
    })
}

/// `visibility: hidden` on an element: laid out, not painted, not pressed.
fn hidden(node: &Arc<Node>) -> Arc<Node> {
    let Node::Elem {
        hash,
        tag,
        key,
        st,
        attrs,
        on,
        observed,
        ov,
        children,
    } = node.as_ref()
    else {
        return node.clone();
    };
    let mut st = st.clone();
    st.visibility = Some("hidden".to_string());
    Arc::new(Node::Elem {
        hash: hash.clone(),
        tag: tag.clone(),
        key: key.clone(),
        st,
        attrs: attrs.clone(),
        on: on.clone(),
        observed: *observed,
        ov: ov.clone(),
        children: children.clone(),
    })
}

/// Puts every island's native view where its box was drawn in the frame just presented.
pub fn sync(runtime: &rune::Runtime<crate::State>) {
    let Some(realiser) = REALISER.get() else {
        return;
    };
    let state = &runtime.state;
    let placed: Vec<Placed> = state
        .islands
        .iter()
        .map(|island| {
            let placement = frames::placement_of(runtime, &island.path, &island.clips)
                // The fallback under a view that draws itself is not painted: its opacity is
                // not the view's.
                .map(|placement| Placement {
                    opacity: 1.0,
                    ..placement
                });
            (island, placement)
        })
        .collect();
    // The page's own background says which appearance the app is in.
    let dark = crate::layout::color(&state.page.bg)
        .map(|bg| 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b < 0.18)
        .unwrap_or(state.dark);
    (realiser.apply)(&placed, dark);
}

/// The native view's item was pressed: the `click` of the fallback element it stands for, which
/// follows the element's link unless its handler prevents it, as a press on it in Rune's drawing.
pub fn press(item: &Item) {
    let (seq, generation) = (next_seq(), generation());
    write_line(match (item.click, &item.href) {
        (Some(id), Some(href)) => json!({
            "t": "event", "seq": seq, "gen": generation, "id": id, "type": "click", "href": href,
        }),
        (Some(id), None) => json!({
            "t": "event", "seq": seq, "gen": generation, "id": id, "type": "click",
        }),
        (None, Some(href)) => json!({
            "t": "event", "seq": seq, "gen": generation, "id": 0, "type": "link", "value": href,
        }),
        (None, None) => return,
    });
}

/// The native view's value changed (a menu's choice, a picked date): a `change` on the island's
/// element, carrying the value as an `<input>`'s does.
pub fn change(island: &IslandSpec, value: &str) {
    let Some(id) = island.change else {
        return;
    };
    write_line(json!({
        "t": "event", "seq": next_seq(), "gen": generation(), "id": id, "type": "change",
        "value": value,
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::Style;

    fn elem(
        tag: &str,
        attrs: &[(&str, &str)],
        on: &[(&str, u32)],
        children: Vec<Arc<Node>>,
    ) -> Arc<Node> {
        Arc::new(Node::Elem {
            hash: String::new(),
            tag: tag.to_string(),
            key: None,
            st: Style {
                bg: Some("#000000".to_string()),
                ..Style::default()
            },
            attrs: attrs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            on: on.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            observed: false,
            ov: None,
            children,
        })
    }

    fn text(s: &str) -> Arc<Node> {
        Arc::new(Node::Text(s.to_string()))
    }

    /// A shell that has a tab bar it draws and a menu it lays over Rune's drawing.
    fn realise() {
        set_realiser(Realiser {
            draws: |name| match name {
                "tab-bar" => Some(Draws::Native),
                "menu" => Some(Draws::Fallback),
                _ => None,
            },
            apply: |_, _| {},
        });
    }

    #[test]
    fn an_island_takes_its_items_and_props_from_its_own_markup() {
        realise();
        let nav = elem(
            "nav",
            &[(ATTR, "tab-bar")],
            &[],
            vec![elem(
                "div",
                &[],
                &[],
                vec![
                    elem(
                        "button",
                        &[(ITEM, "Menu"), (SYMBOL, "line.3.horizontal")],
                        &[("click", 7)],
                        vec![text("Menu")],
                    ),
                    elem(
                        "a",
                        &[(ITEM, "Home"), (SELECTED, "true"), ("href", "/hazel")],
                        &[],
                        vec![text(" Home ")],
                    ),
                ],
            )],
        );
        let select = elem(
            "button",
            &[(ATTR, "menu"), (PROPS, r#"{"selected":"all"}"#)],
            &[("change", 9)],
            vec![],
        );
        let unknown = elem("div", &[(ATTR, "map")], &[], vec![]);
        let root = elem("div", &[], &[], vec![nav, select, unknown]);
        let found = collect(&root);
        assert_eq!(
            found
                .iter()
                .map(|island| (island.path.as_str(), island.name.as_str()))
                .collect::<Vec<_>>(),
            vec![("r/0", "tab-bar"), ("r/1", "menu")],
            "the components the shell has, in document order"
        );
        let items = &found[0].items;
        assert_eq!(items.len(), 2);
        assert_eq!(
            (
                items[0].title.as_str(),
                items[0].symbol.as_deref(),
                items[0].click
            ),
            ("Menu", Some("line.3.horizontal"), Some(7))
        );
        assert_eq!(
            (
                items[1].title.as_str(),
                items[1].selected,
                items[1].href.as_deref()
            ),
            ("Home", true, Some("/hazel"))
        );
        assert_eq!(found[1].props["selected"], "all");
        assert_eq!(found[1].change, Some(9));
    }

    #[test]
    fn a_view_that_draws_itself_leaves_a_box_rune_does_not_paint() {
        let nav = elem(
            "nav",
            &[(ATTR, "tab-bar")],
            &[("click", 1)],
            vec![elem("div", &[], &[], vec![text("Home")])],
        );
        let ghost = ghost(&nav);
        let Node::Elem {
            st,
            attrs,
            on,
            children,
            ..
        } = ghost.as_ref()
        else {
            panic!("an element");
        };
        assert_eq!(st.bg, None);
        assert!(!attrs.contains_key(ATTR), "built as a plain element");
        assert!(on.is_empty());
        let Node::Elem { st: child, .. } = children[0].as_ref() else {
            panic!("an element");
        };
        assert_eq!(
            child.visibility.as_deref(),
            Some("hidden"),
            "laid out, not painted"
        );
    }
}

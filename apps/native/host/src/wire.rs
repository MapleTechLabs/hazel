//! The tree the Bun runtime sends: resolved styles, handler ids, and references to subtrees the
//! previous commit already carried (by content hash).
use std::collections::HashMap;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub display: Option<String>,
    pub dir: Option<String>,
    pub wrap: Option<bool>,
    pub gap_row: Option<F>,
    pub gap_col: Option<F>,
    pub child_gap: Option<F>,
    pub pad: Option<[F; 4]>,
    pub margin: Option<[F; 4]>,
    pub w: Option<Len>,
    pub h: Option<Len>,
    pub min_w: Option<Len>,
    pub min_h: Option<Len>,
    pub max_w: Option<Len>,
    pub grow: Option<F>,
    pub items: Option<String>,
    pub justify: Option<String>,
    #[serde(rename = "self")]
    pub align_self: Option<String>,
    pub bg: Option<String>,
    pub hover_bg: Option<String>,
    pub color: Option<String>,
    pub border: Option<[F; 4]>,
    pub border_color: Option<String>,
    pub radius: Option<[F; 4]>,
    pub font_size: Option<F>,
    pub line_height: Option<F>,
    pub font_weight: Option<F>,
    pub opacity: Option<F>,
    pub scroll_y: Option<bool>,
    pub clip: Option<bool>,
    pub truncate: Option<bool>,
    pub nowrap: Option<bool>,
    pub inline: Option<bool>,
    pub absolute: Option<[Option<F>; 4]>,
    pub grid_cols: Option<Vec<String>>,
    pub col_span_full: Option<bool>,
    pub subgrid: Option<bool>,
    pub hover_group: Option<bool>,
    pub group_opacity: Option<F>,
    pub center_y: Option<bool>,
    // Fields below arrive from newer resolvers. Each decodes leniently: a value of an unexpected
    // shape drops that field, never the whole tree.
    #[serde(default, deserialize_with = "lenient")]
    pub margin_auto: Option<[bool; 4]>,
    #[serde(default, deserialize_with = "lenient")]
    pub sticky_top: Option<F>,
    #[serde(default, deserialize_with = "lenient")]
    pub shadows: Option<Vec<BoxShadow>>,
    #[serde(default, deserialize_with = "lenient")]
    pub outline: Option<OutlineSpec>,
    #[serde(default, deserialize_with = "lenient")]
    pub bg_image: Option<BgImage>,
    #[serde(default, deserialize_with = "lenient")]
    pub object_fit: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub aspect_ratio: Option<F>,
    #[serde(default, deserialize_with = "lenient")]
    pub max_h: Option<Len>,
    #[serde(default, deserialize_with = "lenient")]
    pub font_family: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub italic: Option<bool>,
    #[serde(default, deserialize_with = "lenient")]
    pub letter_spacing: Option<F>,
    #[serde(default, deserialize_with = "lenient")]
    pub text_transform: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub text_decoration: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub white_space_pre: Option<bool>,
    #[serde(default, deserialize_with = "lenient")]
    pub visibility: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub z_index: Option<F>,
    #[serde(default, deserialize_with = "lenient")]
    pub translate: Option<[F; 2]>,
    #[serde(default, deserialize_with = "lenient")]
    pub text_align: Option<String>,
    /// `flex-shrink`: 0 keeps the element at its size (Rune's default); above 0 lets it shrink.
    #[serde(default, deserialize_with = "lenient")]
    pub shrink: Option<F>,
    #[serde(default, deserialize_with = "lenient")]
    pub hover_color: Option<String>,
    /// The ring keyboard focus draws (`:focus-visible`), or `"none"` when the outline is hidden.
    #[serde(default, deserialize_with = "lenient")]
    pub focus_ring: Option<FocusRing>,
    /// The ring while focus is on the element or in it (`:focus`, `:focus-within`).
    #[serde(default, deserialize_with = "lenient")]
    pub focus_within_ring: Option<OutlineSpec>,
    /// The fill while a press is held (`:active`).
    #[serde(default, deserialize_with = "lenient")]
    pub press_bg: Option<String>,
    /// CSS transitions by what Rune animates separately; a missing channel changes at once.
    #[serde(default, deserialize_with = "lenient")]
    pub transition: Option<Transitions>,
    /// A keyframe animation: a loop, or an entrance played on mount.
    #[serde(default, deserialize_with = "lenient")]
    pub animation: Option<Animation>,
}

#[derive(Deserialize, Clone, Debug, Hash, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Animation {
    Spin {
        period: F,
    },
    /// Opacity `from` at the start of each period, `to` at its middle.
    Pulse {
        period: F,
        delay: F,
        from: F,
        to: F,
    },
    /// Starts from these values (px, and a scale) and settles on the element's own.
    Enter {
        duration: F,
        delay: F,
        opacity: F,
        x: F,
        y: F,
        scale: F,
    },
}

#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
pub struct Transitions {
    pub colors: Option<Timing>,
    pub opacity: Option<Timing>,
    pub layout: Option<Timing>,
    pub transform: Option<Timing>,
}

/// Seconds, and the `cubic-bezier` control points.
#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
pub struct Timing {
    pub duration: F,
    #[serde(default)]
    pub delay: F,
    pub ease: [F; 4],
}

#[derive(Deserialize, Clone, Debug, Hash, PartialEq)]
#[serde(untagged)]
pub enum FocusRing {
    Ring(OutlineSpec),
    /// `"none"`: the author hid the outline and drew no focus style of their own.
    Hidden(String),
}

/// `Some(value)` when the JSON decodes as `T`, else `None`.
fn lenient<'de, D: serde::Deserializer<'de>, T: serde::de::DeserializeOwned>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Ok(serde_json::from_value(Value::deserialize(d)?).ok())
}

/// One CSS `box-shadow` layer; a 0-blur, 0-offset one is a ring (Tailwind `ring-*`).
#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
pub struct BoxShadow {
    #[serde(default)]
    pub x: F,
    #[serde(default)]
    pub y: F,
    #[serde(default)]
    pub blur: F,
    #[serde(default)]
    pub spread: F,
    pub color: String,
    #[serde(default)]
    pub inset: bool,
}

#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
pub struct OutlineSpec {
    pub width: F,
    pub color: String,
    #[serde(default)]
    pub offset: F,
}

/// An overlay the runtime's overlay helpers asked for (`ov` on an element).
#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Overlay {
    /// Drawn at the window's root, above the page, rather than in place.
    #[serde(default)]
    pub portal: Option<u8>,
    pub anchor: Option<OverlayAnchor>,
    /// The overlay root a press outside this element (or Escape in it) dismisses.
    pub modal: Option<String>,
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct OverlayAnchor {
    /// The trigger's element path, which is also its Rune key.
    pub to: String,
    pub side: String,
    pub align: String,
    pub gap: F,
}

/// `background-image`: a picture by URL or a linear gradient (`angle` in CSS degrees).
#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
pub struct BgImage {
    pub url: Option<String>,
    pub gradient: Option<Gradient>,
}

#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
pub struct Gradient {
    #[serde(default)]
    pub angle: F,
    pub stops: Vec<GradientStop>,
}

#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
pub struct GradientStop {
    pub color: String,
    pub at: Option<F>,
}

/// An `f32` that hashes, so a style can key a memo.
#[derive(Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(transparent)]
pub struct F(pub f32);
impl std::hash::Hash for F {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.0.to_bits().hash(state)
    }
}

/// A CSS length: px, `"full"` for 100%, `{ "frac": f }` for a share of the parent, or `"auto"`.
#[derive(Clone, Debug, PartialEq, Hash)]
pub enum Len {
    Px(F),
    Full,
    Frac(F),
    Auto,
}
impl<'de> Deserialize<'de> for Len {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match Value::deserialize(d)? {
            Value::Number(n) => Len::Px(F(n.as_f64().unwrap_or(0.0) as f32)),
            Value::String(s) if s == "full" => Len::Full,
            Value::Object(o) => match o.get("frac").and_then(Value::as_f64) {
                Some(f) => Len::Frac(F(f as f32)),
                None => Len::Auto,
            },
            _ => Len::Auto,
        })
    }
}

#[derive(Deserialize, Debug)]
#[serde(tag = "k")]
pub enum WireNode {
    #[serde(rename = "t")]
    Text { s: String },
    #[serde(rename = "svg")]
    Svg {
        h: String,
        view: f32,
        body: String,
        st: Style,
        /// The svg's `preserveAspectRatio`, when it sets one.
        #[serde(default)]
        par: Option<String>,
    },
    #[serde(rename = "e")]
    Elem {
        h: String,
        tag: String,
        key: Option<String>,
        st: Style,
        attrs: HashMap<String, String>,
        on: HashMap<String, u32>,
        #[allow(dead_code)]
        mount: Option<String>,
        #[serde(default)]
        o: Option<u8>,
        #[serde(default, deserialize_with = "lenient")]
        ov: Option<Box<Overlay>>,
        c: Vec<WireNode>,
    },
    #[serde(rename = "r")]
    Ref { h: String },
}

// One message at a time crosses the channel; boxing the tree would only add an allocation.
#[allow(clippy::large_enum_variant)]
#[derive(Deserialize)]
#[serde(tag = "t")]
pub enum RuntimeMsg {
    #[serde(rename = "tree")]
    Tree(TreeMsg),
    /// Set a scroll viewport's offset (an `element.scrollTop = …` in the runtime).
    #[serde(rename = "scroll")]
    Scroll { path: String, top: f32 },
}

#[derive(Deserialize)]
pub struct TreeMsg {
    pub ack: u64,
    /// The runtime's generation for this tree; events pressed on it carry it back.
    #[serde(default, rename = "gen")]
    pub generation: u64,
    #[serde(default)]
    pub page: Page,
    pub root: WireNode,
}

#[derive(Deserialize, Default, Clone, Debug)]
pub struct Page {
    pub bg: Option<String>,
    pub color: Option<String>,
}

/// A resolved node. Children are shared, so a reused subtree costs one pointer copy.
#[derive(Debug)]
pub enum Node {
    Text(String),
    Svg {
        hash: String,
        view: f32,
        body: String,
        st: Style,
        par: Option<String>,
    },
    Elem {
        hash: String,
        tag: String,
        key: Option<String>,
        st: Style,
        attrs: HashMap<String, String>,
        on: HashMap<String, u32>,
        observed: bool,
        ov: Option<Box<Overlay>>,
        children: Vec<Arc<Node>>,
    },
}

impl Node {
    pub fn hash(&self) -> Option<&str> {
        match self {
            Node::Text(_) => None,
            Node::Svg { hash, .. } | Node::Elem { hash, .. } => Some(hash),
        }
    }
}

/// Every hashed subtree of the tree on screen, for the next commit's references.
#[derive(Default)]
pub struct Subtrees(HashMap<String, Arc<Node>>);

impl Subtrees {
    /// Resolves `wire` against the previous tree's subtrees and returns the new index with it.
    pub fn resolve(&self, wire: WireNode) -> (Arc<Node>, Subtrees) {
        let mut next = HashMap::new();
        let root = self.resolve_into(wire, &mut next);
        (root, Subtrees(next))
    }

    fn resolve_into(&self, wire: WireNode, next: &mut HashMap<String, Arc<Node>>) -> Arc<Node> {
        let node = match wire {
            WireNode::Text { s } => return Arc::new(Node::Text(s)),
            WireNode::Ref { h } => {
                let node = self
                    .0
                    .get(&h)
                    .cloned()
                    .unwrap_or_else(|| Arc::new(Node::Text(String::new())));
                index(&node, next);
                return node;
            }
            WireNode::Svg {
                h,
                view,
                body,
                st,
                par,
            } => Arc::new(Node::Svg {
                hash: h,
                view,
                body,
                st,
                par,
            }),
            WireNode::Elem {
                h,
                tag,
                key,
                st,
                attrs,
                on,
                o,
                ov,
                c,
                ..
            } => {
                let children = c
                    .into_iter()
                    .map(|child| self.resolve_into(child, next))
                    .collect();
                Arc::new(Node::Elem {
                    hash: h,
                    tag,
                    key,
                    st,
                    attrs,
                    on,
                    observed: o.is_some(),
                    ov,
                    children,
                })
            }
        };
        if let Some(h) = node.hash() {
            next.insert(h.to_string(), node.clone());
        }
        node
    }
}

/// A reused subtree brings all its hashed descendants into the new index.
fn index(node: &Arc<Node>, next: &mut HashMap<String, Arc<Node>>) {
    if let Some(h) = node.hash() {
        next.insert(h.to_string(), node.clone());
    }
    if let Node::Elem { children, .. } = node.as_ref() {
        for child in children {
            index(child, next);
        }
    }
}

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
    /// Its own formatting context (`contain: layout`, `display: flow-root`).
    pub isolated: Option<bool>,
    pub truncate: Option<bool>,
    pub nowrap: Option<bool>,
    pub inline: Option<bool>,
    pub absolute: Option<[Option<F>; 4]>,
    pub grid_cols: Option<Vec<String>>,
    /// Host-only: a table row's key, so its cells hover together (`hover_group_shared`).
    #[serde(skip)]
    pub hover_share: Option<String>,
    /// Host-only: a table cell's `colspan`.
    #[serde(skip)]
    pub col_span: Option<u16>,
    /// `position: fixed`: drawn at the window's root and placed against the window.
    pub fixed: Option<bool>,
    pub grid_rows: Option<Vec<String>>,
    pub row_start: Option<i16>,
    pub justify_items: Option<String>,
    pub col_span_full: Option<bool>,
    pub subgrid: Option<bool>,
    pub hover_group: Option<bool>,
    pub group_opacity: Option<F>,
    /// `group-hover:right-8` on a positioned element: [dx, dy] while its group is hovered.
    pub group_shift: Option<[F; 2]>,
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
    /// `pointer-events`: `none` or `auto`, inherited by the host as CSS does.
    pub pointer_events: Option<String>,
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
    /// `left-1/2 -translate-x-1/2`: centred horizontally in its containing block.
    #[serde(default, deserialize_with = "lenient")]
    pub center_x: Option<bool>,
    /// The fill while a press is held (`:active`).
    #[serde(default, deserialize_with = "lenient")]
    pub press_bg: Option<String>,
    /// CSS transitions by what Rune animates separately; a missing channel changes at once.
    #[serde(default, deserialize_with = "lenient")]
    pub transition: Option<Transitions>,
    /// A keyframe animation: a loop, or an entrance played on mount.
    #[serde(default, deserialize_with = "lenient")]
    pub animation: Option<Animation>,
    /// `mask-image`: edges that fade out, and a picture whose alpha shows the box.
    #[serde(default, deserialize_with = "lenient")]
    pub mask: Option<Mask>,
    /// `text-box-trim`: the font metric each trimmed side of the text's box ends at.
    #[serde(default, deserialize_with = "lenient")]
    pub text_box: Option<TextBox>,
}

/// `over`: `cap`, `ex` or `text`; `under`: `alphabetic` or `text`. An absent side is untrimmed.
#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
pub struct TextBox {
    pub over: Option<String>,
    pub under: Option<String>,
}

#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
pub struct Mask {
    /// left top right bottom: the share of the box each edge fades out over, linearly.
    pub fade: Option<[F; 4]>,
    pub image: Option<MaskImage>,
}

/// A mask picture, centred and drawn once at `w` by `h` of the box.
#[derive(Deserialize, Clone, Debug, Default, Hash, PartialEq)]
pub struct MaskImage {
    pub url: String,
    pub w: F,
    pub h: F,
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
    /// Along the trigger, as Floating UI's `crossOffset` (a context menu opens at the pointer).
    #[serde(default)]
    pub cross: Option<F>,
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

/// A CSS length: px, `"full"` for 100%, `{ "frac": f }` for a share of the parent, `"fit"` for
/// the content's own size (`fit-content`: never stretched by its parent), or `"auto"`.
#[derive(Clone, Debug, PartialEq, Hash)]
pub enum Len {
    Px(F),
    Full,
    Frac(F),
    Fit,
    Auto,
}
impl<'de> Deserialize<'de> for Len {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match Value::deserialize(d)? {
            Value::Number(n) => Len::Px(F(n.as_f64().unwrap_or(0.0) as f32)),
            Value::String(s) if s == "full" => Len::Full,
            Value::String(s) if s == "fit" => Len::Fit,
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

impl WireNode {
    /// The node's content hash; text has none.
    pub fn hash(&self) -> Option<&str> {
        match self {
            WireNode::Text { .. } => None,
            WireNode::Svg { h, .. } | WireNode::Elem { h, .. } | WireNode::Ref { h } => Some(h),
        }
    }
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
    Scroll {
        path: String,
        top: f32,
        /// Echoed in the next offset report, so the runtime can tell reports from before it.
        #[serde(default)]
        seq: Option<u64>,
    },
    /// Focus the element keyed `key` (an `element.focus()` in the runtime).
    #[serde(rename = "focus")]
    Focus { key: String },
    /// Show an Open dialog for the file input at `path` (an `input.click()`).
    #[serde(rename = "pickFile")]
    PickFile { path: String, accept: String },
    /// Scroll the element at `path` into view (an `element.scrollIntoView()`).
    #[serde(rename = "reveal")]
    Reveal { path: String, block: String },
    /// Report the element at `path`'s rect now: it was laid out before the runtime observed it.
    #[serde(rename = "measure")]
    Measure { path: String },
    /// A full page load (`location.assign`, `reload()`): start a fresh runtime at `path`.
    #[serde(rename = "reload")]
    Reload { path: String },
    /// Read or replace the sign-in vault's record in the keychain; answered as `vault` with `id`.
    #[serde(rename = "vault")]
    Vault {
        id: u64,
        op: String,
        #[serde(default)]
        record: Option<String>,
    },
    /// An updater step (`check`, `download`, `install`); answered as `update` with `id`, and a
    /// download reports `updateProgress` as it goes.
    #[serde(rename = "update")]
    Update { id: u64, op: String },
    /// Quit, and open the app again once this process has gone (after an update installs).
    #[serde(rename = "relaunch")]
    Relaunch,
}

/// A `vault` request's operation; `None` for an unknown one or a write without a record.
pub fn vault_op(op: &str, record: Option<String>) -> Option<crate::platform::VaultOp> {
    match (op, record) {
        ("read", _) => Some(crate::platform::VaultOp::Read),
        ("write", Some(record)) => Some(crate::platform::VaultOp::Write(record)),
        _ => None,
    }
}

/// What a runtime request does to the host's Rune runtime, sent to its update thread.
pub type HostRequest = Box<dyn FnOnce(&mut rune::Tx) + Send>;

impl RuntimeMsg {
    /// A focus or reveal request, run against the host's next commit.
    pub fn request(self) -> Option<HostRequest> {
        match self {
            RuntimeMsg::Focus { key } => Some(Box::new(move |tx: &mut rune::Tx| tx.focus(key))),
            RuntimeMsg::PickFile { path, accept } => Some(Box::new(move |tx: &mut rune::Tx| {
                let options = file_dialog_options(&accept);
                tx.open_file(options, move |_: &mut crate::State, picked, _| {
                    let files: Vec<String> = picked
                        .ok()
                        .flatten()
                        .map(|p| p.display().to_string())
                        .into_iter()
                        .collect();
                    crate::write_line(
                        serde_json::json!({ "t": "files", "path": path, "files": files }),
                    );
                });
            })),
            RuntimeMsg::Reveal { path, block } if block == "center" => {
                Some(Box::new(move |tx: &mut rune::Tx| tx.scroll_center(path)))
            }
            RuntimeMsg::Reveal { path, .. } => {
                Some(Box::new(move |tx: &mut rune::Tx| tx.scroll_into_view(path)))
            }
            RuntimeMsg::Measure { path } => Some(Box::new(move |tx: &mut rune::Tx| {
                tx.drawn_rects(vec![path.clone()], move |_: &mut crate::State, rects, _| {
                    if let Some(Some([x, y, w, h])) = rects.first().copied() {
                        crate::write_line(serde_json::json!({
                            "t": "layout", "path": path, "x": x, "y": y, "w": w, "h": h,
                        }));
                    }
                });
            })),
            _ => None,
        }
    }
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

#[derive(Deserialize, Default, Clone, Debug, PartialEq)]
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

/// An Open dialog for an `<input type=file accept=...>`: its types as the dialog's filter.
fn file_dialog_options(accept: &str) -> rune::FileDialogOptions {
    let mut extensions: Vec<&str> = Vec::new();
    for kind in accept.split(',').map(str::trim).filter(|k| !k.is_empty()) {
        match kind {
            "image/*" => extensions.extend(["png", "jpg", "jpeg", "gif", "webp", "heic"]),
            "video/*" => extensions.extend(["mp4", "mov", "webm"]),
            "audio/*" => extensions.extend(["mp3", "m4a", "wav"]),
            _ => {
                let ext = kind
                    .trim_start_matches('.')
                    .rsplit('/')
                    .next()
                    .unwrap_or(kind);
                extensions.push(if ext == "jpeg" { "jpg" } else { ext });
            }
        }
    }
    let options = rune::FileDialogOptions::default();
    if extensions.is_empty() {
        options
    } else {
        options.filter("Files", &extensions)
    }
}

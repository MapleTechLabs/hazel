//! The host's CSS emulation driven end to end: handwritten wire trees go through `State::apply`
//! and the real view into Rune's in-process runtime, and the tests read back presented rects,
//! field state and rendered pixels.
use std::sync::atomic::{AtomicU64, Ordering};

use rune::edit::{Key, KeyEvent, Mods};
use rune::render::{Gpu, Offscreen, Renderer};
use rune::{Env, Runtime};
use serde_json::{Value, json};

use crate::wire::{RuntimeMsg, TreeMsg};
use crate::{State, view};

static HASH: AtomicU64 = AtomicU64::new(0);

/// An element node with a fresh content hash.
fn e(tag: &str, st: Value, children: Vec<Value>) -> Value {
    let h = HASH.fetch_add(1, Ordering::SeqCst);
    json!({ "k": "e", "h": format!("t{h}"), "tag": tag, "st": st, "attrs": {}, "on": {}, "c": children })
}

fn with_attrs(mut node: Value, attrs: Value) -> Value {
    node["attrs"] = attrs;
    node
}

fn t(s: &str) -> Value {
    json!({ "k": "t", "s": s })
}

fn state(root: Value) -> State {
    let msg: TreeMsg =
        serde_json::from_value(json!({ "ack": 0, "page": { "bg": "#ffffffff" }, "root": root }))
            .expect("wire tree");
    let mut s = State::default();
    s.apply(msg);
    s
}

fn runtime(root: Value, size: (f32, f32)) -> Runtime<State> {
    crate::dom_motion();
    let mut rt = Runtime::new(state(root), view, size, Env::new(false, 1.0));
    rt.on_key = Some(crate::window_key);
    rt.frame(0.0);
    rt.settle_all();
    rt.frame(0.0);
    rt
}

fn rect(rt: &Runtime<State>, path: &str) -> [f32; 4] {
    rt.presented(path)
        .unwrap_or_else(|| panic!("{path} not drawn"))
        .0
}

/// The frame rendered at 1x as RGBA rows.
struct Frame {
    width: u32,
    rgba: Vec<u8>,
}

impl Frame {
    fn at(&self, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * self.width + x) * 4) as usize;
        [
            self.rgba[i],
            self.rgba[i + 1],
            self.rgba[i + 2],
            self.rgba[i + 3],
        ]
    }
    fn is(&self, x: u32, y: u32, want: [u8; 3]) -> bool {
        let p = self.at(x, y);
        (0..3).all(|c| (p[c] as i32 - want[c] as i32).abs() <= 12)
    }
}

fn render(rt: &mut Runtime<State>, size: (u32, u32)) -> Frame {
    rt.settle_all();
    rt.frame(0.0);
    draw(rt, size)
}

/// The last frame as drawn, running animations included.
fn draw(rt: &mut Runtime<State>, (w, h): (u32, u32)) -> Frame {
    const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
    let gpu = Gpu::headless();
    let mut renderer = Renderer::new(&gpu.device, FORMAT);
    renderer.set_srgb_blend(true);
    rt.set_srgb_blend(true);
    let target = Offscreen::with_format(&gpu.device, w, h, FORMAT);
    renderer.upload_images(&gpu.device, &gpu.queue, &mut rt.images);
    renderer.prepare(
        &gpu.device,
        &gpu.queue,
        &mut rt.text.atlas,
        &rt.instances,
        (w, h),
    );
    let mut encoder = gpu.device.create_command_encoder(&Default::default());
    renderer.draw(&mut encoder, &target.view, rt.clear_color());
    target.copy(&mut encoder);
    renderer.submit(&gpu.queue, encoder);
    Frame {
        width: w,
        rgba: target.read(&gpu.device),
    }
}

const RED: [u8; 3] = [255, 0, 0];
const BLUE: [u8; 3] = [0, 0, 255];
const WHITE: [u8; 3] = [255, 255, 255];

#[test]
fn ml_auto_pushes_a_row_child_to_the_right_edge() {
    let rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "w": 400, "h": 40, "gapCol": 8 }),
            vec![
                e("div", json!({ "w": 50, "h": 20 }), vec![]),
                e(
                    "div",
                    json!({ "w": 30, "h": 20, "marginAuto": [false, false, false, true] }),
                    vec![],
                ),
            ],
        ),
        (400.0, 40.0),
    );
    let chevron = rect(&rt, "r/1");
    assert_eq!(chevron[0] + chevron[2], 400.0, "{chevron:?}");
    assert_eq!(rect(&rt, "r/0")[0], 0.0);
}

#[test]
fn mx_auto_centres_a_block_child() {
    let rt = runtime(
        e(
            "div",
            json!({ "w": 300, "h": 100 }),
            vec![e(
                "div",
                json!({ "w": 100, "h": 20, "marginAuto": [false, true, false, true] }),
                vec![],
            )],
        ),
        (300.0, 100.0),
    );
    assert_eq!(rect(&rt, "r/0")[0], 100.0);
}

#[test]
fn mt_auto_in_a_column_sits_at_the_bottom() {
    let rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "dir": "col", "w": 100, "h": 200 }),
            vec![
                e("div", json!({ "h": 20 }), vec![]),
                e(
                    "div",
                    json!({ "h": 30, "marginAuto": [true, false, false, false] }),
                    vec![],
                ),
            ],
        ),
        (100.0, 200.0),
    );
    let footer = rect(&rt, "r/1");
    assert_eq!(footer[1] + footer[3], 200.0, "{footer:?}");
}

#[test]
fn display_contents_children_join_the_parent_row() {
    let rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "w": 200, "h": 20 }),
            vec![
                e("div", json!({ "w": 20, "h": 20 }), vec![]),
                e(
                    "div",
                    json!({ "display": "contents" }),
                    vec![
                        e("div", json!({ "w": 30, "h": 20 }), vec![]),
                        e("div", json!({ "w": 40, "h": 20 }), vec![]),
                    ],
                ),
            ],
        ),
        (200.0, 20.0),
    );
    assert_eq!(rect(&rt, "r/1/0")[0], 20.0);
    assert_eq!(rect(&rt, "r/1/1")[0], 50.0);
}

#[test]
fn overflow_hidden_with_radius_clips_children_to_the_rounded_box() {
    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 100, "h": 100 }),
            vec![e(
                "div",
                json!({ "w": 60, "h": 60, "margin": [20, 0, 0, 20], "radius": [20, 20, 20, 20], "clip": true }),
                vec![e(
                    "div",
                    json!({ "w": "full", "h": "full", "bg": "#ff0000ff" }),
                    vec![],
                )],
            )],
        ),
        (100.0, 100.0),
    );
    let frame = render(&mut rt, (100, 100));
    assert!(frame.is(50, 50, RED), "centre {:?}", frame.at(50, 50));
    assert!(frame.is(21, 21, WHITE), "corner {:?}", frame.at(21, 21));
    assert!(frame.is(78, 78, WHITE), "corner {:?}", frame.at(78, 78));
}

#[test]
fn z_index_paints_a_positioned_child_over_its_later_sibling() {
    let layers = |z: Option<f32>| {
        let mut first = json!({ "absolute": [0, 0, 0, 0], "bg": "#ff0000ff" });
        if let Some(z) = z {
            first["zIndex"] = json!(z);
        }
        e(
            "div",
            json!({ "w": 40, "h": 40 }),
            vec![
                e("div", first, vec![]),
                e(
                    "div",
                    json!({ "absolute": [0, 0, 0, 0], "bg": "#0000ffff" }),
                    vec![],
                ),
            ],
        )
    };
    let mut rt = runtime(layers(Some(1.0)), (40.0, 40.0));
    assert!(render(&mut rt, (40, 40)).is(20, 20, RED));
    let mut rt = runtime(layers(None), (40.0, 40.0));
    assert!(render(&mut rt, (40, 40)).is(20, 20, BLUE));
}

#[test]
fn a_flow_child_with_a_z_index_paints_over_an_absolute_background() {
    let background = e(
        "div",
        json!({ "absolute": [0, 0, 0, 0], "bg": "#ff0000ff" }),
        vec![],
    );
    let card = e(
        "div",
        json!({ "w": 40, "h": 20, "zIndex": 20, "bg": "#0000ffff" }),
        vec![],
    );
    let panel = e(
        "div",
        json!({ "w": 40, "h": 40, "display": "flex", "dir": "col" }),
        vec![background, card],
    );
    let mut rt = runtime(panel, (40.0, 40.0));
    let frame = render(&mut rt, (40, 40));
    assert!(
        frame.is(20, 10, BLUE),
        "the z-20 card paints over the background"
    );
    assert!(
        frame.is(20, 30, RED),
        "the background shows where nothing covers it"
    );
}

#[test]
fn a_single_side_border_draws_only_that_side() {
    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 50, "h": 50, "bg": "#ffffffff", "border": [0, 0, 2, 0], "borderColor": "#ff0000ff" }),
            vec![],
        ),
        (50.0, 50.0),
    );
    let frame = render(&mut rt, (50, 50));
    assert!(frame.is(25, 49, RED), "{:?}", frame.at(25, 49));
    assert!(frame.is(25, 0, WHITE), "{:?}", frame.at(25, 0));
    assert!(frame.is(0, 25, WHITE), "{:?}", frame.at(0, 25));
}

#[test]
fn a_ring_shadow_draws_outside_the_box() {
    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 80, "h": 80 }),
            vec![e(
                "div",
                json!({ "w": 40, "h": 40, "margin": [20, 0, 0, 20],
                    "shadows": [{ "x": 0, "y": 0, "blur": 0, "spread": 3, "color": "#ff0000ff", "inset": false }] }),
                vec![],
            )],
        ),
        (80.0, 80.0),
    );
    let frame = render(&mut rt, (80, 80));
    assert!(frame.is(18, 40, RED), "ring {:?}", frame.at(18, 40));
    assert!(frame.is(14, 40, WHITE), "outside {:?}", frame.at(14, 40));
    assert!(frame.is(40, 40, WHITE), "inside {:?}", frame.at(40, 40));
}

/// A 2x2 solid red PNG as a data: URL.
fn red_png_data_url() -> String {
    use base64::Engine;
    let path = std::env::temp_dir().join(format!("hazel-host-test-{}.png", std::process::id()));
    rune::render::write_png(&path, 2, 2, &[255, 0, 0, 255].repeat(4)).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let _ = std::fs::remove_file(&path);
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[test]
fn an_img_with_a_data_png_draws_its_pixels() {
    let src = red_png_data_url();
    let s = state(e(
        "div",
        json!({ "w": 40, "h": 40 }),
        vec![with_attrs(
            e(
                "img",
                json!({ "w": 40, "h": 40, "objectFit": "cover" }),
                vec![],
            ),
            json!({ "src": src }),
        )],
    ));
    s.images
        .get(&src, 40.0)
        .expect("decodes")
        .wait()
        .expect("a png");
    let mut rt = Runtime::new(s, view, (40.0, 40.0), Env::new(false, 1.0));
    rt.frame(0.0);
    assert!(render(&mut rt, (40, 40)).is(20, 20, RED));
}

#[test]
fn a_multicolour_svg_draws_its_own_oklch_fill_filling_its_box() {
    let body = r#"<path d="M0 0h16v16h-16z" fill="oklch(0.628 0.2577 29.23)"/>"#;
    let s = state(e(
        "div",
        json!({ "w": 32, "h": 32, "bg": "#0000ffff" }),
        vec![json!({ "k": "svg", "h": "svg-test", "view": 16, "body": body, "st": {} })],
    ));
    s.images.svg(16.0, body, 128.0).wait().expect("an svg");
    let mut rt = Runtime::new(s, view, (32.0, 32.0), Env::new(false, 1.0));
    rt.frame(0.0);
    let frame = render(&mut rt, (32, 32));
    // oklch(0.628 0.2577 29.23) is sRGB red.
    assert!(frame.is(3, 3, RED), "{:?}", frame.at(3, 3));
    assert!(frame.is(28, 28, RED), "{:?}", frame.at(28, 28));
}

#[test]
fn a_zero_font_size_inherits_so_the_avatar_letter_shows() {
    let rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "w": 32, "h": 32, "fontSize": 14 }),
            vec![e(
                "span",
                json!({ "fontSize": 0, "lineHeight": 16 }),
                vec![t("A")],
            )],
        ),
        (32.0, 32.0),
    );
    let letter = rect(&rt, "r/0");
    assert!(letter[2] > 4.0 && letter[3] >= 16.0, "{letter:?}");
}

#[test]
fn text_align_center_centres_an_inline_line() {
    let rt = runtime(
        e(
            "div",
            json!({ "w": 300, "textAlign": "center" }),
            vec![t("Hi "), e("span", json!({}), vec![t("there")])],
        ),
        (300.0, 60.0),
    );
    let span = rect(&rt, "r/1");
    assert!(span[0] > 120.0 && span[0] + span[2] < 200.0, "{span:?}");
}

#[test]
fn shrink_zero_keeps_an_inline_box_at_its_size() {
    let row = |tag: &str, extra: Value| {
        let mut st = json!({ "w": 80, "h": 20 });
        for (k, v) in extra.as_object().unwrap() {
            st[k] = v.clone();
        }
        e(
            "div",
            json!({ "display": "flex", "w": 100, "h": 20 }),
            vec![
                e("div", json!({ "w": 60, "h": 20 }), vec![]),
                e(tag, st, vec![]),
            ],
        )
    };
    let width = |tag: &str, extra: Value| rect(&runtime(row(tag, extra), (100.0, 20.0)), "r/1")[2];
    assert_eq!(
        width("span", json!({ "shrink": 0 })),
        80.0,
        "shrink-0 keeps its size"
    );
    assert_eq!(
        width("span", json!({})),
        40.0,
        "an inline box shrinks by default"
    );
    // A block flex item shrinks by its own `shrink`, and `min-w-0 truncate` must not stop it.
    assert_eq!(
        width("div", json!({ "shrink": 1 })),
        40.0,
        "shrink 1 gives up the overflow"
    );
    assert_eq!(
        width("div", json!({ "shrink": 1, "minW": 0 })),
        40.0,
        "min-w-0 still shrinks"
    );
    assert_eq!(
        width("div", json!({ "shrink": 1, "minW": 70 })),
        70.0,
        "a positive min-w is the floor"
    );
}

#[test]
fn visibility_hidden_keeps_the_box_but_draws_nothing() {
    let rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "w": 100, "h": 20 }),
            vec![
                e(
                    "div",
                    json!({ "w": 30, "h": 20, "bg": "#ff0000ff", "visibility": "hidden" }),
                    vec![],
                ),
                e("div", json!({ "w": 30, "h": 20 }), vec![]),
            ],
        ),
        (100.0, 20.0),
    );
    let (hidden, opacity) = rt.presented("r/0").unwrap();
    assert_eq!(hidden[2], 30.0);
    assert_eq!(opacity, 0.0);
    assert_eq!(rect(&rt, "r/1")[0], 30.0);
}

#[test]
fn translate_offsets_the_drawn_box() {
    let rt = runtime(
        e(
            "div",
            json!({ "w": 100, "h": 100 }),
            vec![e(
                "div",
                json!({ "w": 20, "h": 20, "translate": [10, 5] }),
                vec![],
            )],
        ),
        (100.0, 100.0),
    );
    let moved = rect(&rt, "r/0");
    assert_eq!((moved[0], moved[1]), (10.0, 5.0));
}

#[test]
fn aspect_ratio_and_max_height_size_the_box() {
    let rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "dir": "col", "w": 200, "h": 400, "items": "start" }),
            vec![
                e("div", json!({ "w": 100, "aspectRatio": 2.0 }), vec![]),
                e("div", json!({ "w": 50, "h": 300, "maxH": 40 }), vec![]),
            ],
        ),
        (200.0, 400.0),
    );
    assert_eq!(rect(&rt, "r/0")[3], 50.0);
    assert_eq!(rect(&rt, "r/1")[3], 40.0);
}

#[test]
fn unexpected_field_shapes_drop_only_that_field() {
    let rt = runtime(
        e(
            "div",
            json!({ "w": 70, "h": 30, "minW": "full", "maxW": "full", "zIndex": "auto",
                "shadows": "none", "translate": { "x": 1 }, "somethingNew": [1, 2] }),
            vec![],
        ),
        (100.0, 100.0),
    );
    assert_eq!(rect(&rt, "r")[2..], [70.0, 30.0]);
}

fn field_text(rt: &Runtime<State>, path: &str) -> String {
    rt.state.fields[path].edit.text.clone()
}

fn type_into(rt: &mut Runtime<State>, field: &str, keys: &[Key]) {
    let (x, y) = rt.find(field).expect("field drawn");
    rt.pointer_move(x, y);
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rt.frame(0.0);
    for key in keys {
        rt.key(KeyEvent {
            key: key.clone(),
            mods: Mods::default(),
        });
        rt.frame(0.0);
    }
}

#[test]
fn a_textarea_is_multi_line_and_return_types_a_newline() {
    let keys = [Key::Text("a".into()), Key::Enter, Key::Text("b".into())];
    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 300 }),
            vec![e("textarea", json!({ "w": 200, "h": 60 }), vec![])],
        ),
        (300.0, 100.0),
    );
    type_into(&mut rt, "r/0/field", &keys);
    assert_eq!(field_text(&rt, "r/0"), "a\nb");

    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 300 }),
            vec![e("input", json!({ "w": 200, "h": 30 }), vec![])],
        ),
        (300.0, 100.0),
    );
    type_into(&mut rt, "r/0/field", &keys);
    assert_eq!(field_text(&rt, "r/0"), "ab", "an input stays one line");
}

#[test]
fn emoji_draw_as_colour_images() {
    let rt = runtime(
        e("div", json!({ "w": 100, "h": 40 }), vec![t("\u{1F389}")]),
        (100.0, 40.0),
    );
    if !std::path::Path::new("/System/Library/Fonts/Apple Color Emoji.ttc").exists() {
        eprintln!("skipping: no colour emoji font installed");
        return;
    }
    let images = rt
        .instances
        .iter()
        .filter(|i| i.params[1] == rune::render::KIND_IMAGE)
        .count();
    assert_eq!(images, 1);
}

#[test]
fn hover_color_recolours_text_while_the_element_is_hovered() {
    let mut rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "w": 100, "h": 30, "color": "#000000ff", "hoverColor": "#ff0000ff" }),
            vec![e("span", json!({}), vec![t("Label")])],
        ),
        (100.0, 30.0),
    );
    let ink = |rt: &Runtime<State>| {
        rt.instances
            .iter()
            .filter(|i| i.params[1] == rune::render::KIND_GLYPH)
            .map(|i| i.fill)
            .next()
            .expect("glyphs")
    };
    assert!(ink(&rt)[0] < 0.1, "rest {:?}", ink(&rt));
    rt.pointer_move(50.0, 15.0);
    rt.settle_all();
    rt.frame(1.0);
    assert!(ink(&rt)[0] > 0.9, "hovered {:?}", ink(&rt));
}

#[test]
fn a_mention_inside_display_contents_stays_in_its_sentence() {
    let rt = runtime(
        e(
            "p",
            json!({ "w": 600 }),
            vec![
                e("span", json!({}), vec![t("Ready for review ")]),
                e(
                    "div",
                    json!({ "display": "contents" }),
                    vec![e(
                        "button",
                        json!({ "display": "inline", "pad": [2, 4, 2, 4] }),
                        vec![t("@Grace"), e("br", json!({}), vec![])],
                    )],
                ),
                e("span", json!({}), vec![t(".")]),
            ],
        ),
        (600.0, 100.0),
    );
    let (sentence, chip, stop) = (rect(&rt, "r/0"), rect(&rt, "r/1/0"), rect(&rt, "r/2"));
    assert!(
        chip[0] >= sentence[0] + sentence[2] && stop[0] >= chip[0] + chip[2],
        "{chip:?}"
    );
    assert!(
        (chip[1] - sentence[1]).abs() < 4.0 && chip[2] < 200.0,
        "{chip:?}"
    );
}

/// Every line the host writes to the runtime, for tests that check what it reports.
static SENT: std::sync::Mutex<Vec<u8>> = std::sync::Mutex::new(Vec::new());

struct Capture;
impl std::io::Write for Capture {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        SENT.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn sent_events(id: u32) -> Vec<Value> {
    let _ = crate::OUT.set(std::sync::Mutex::new(Box::new(Capture)));
    String::from_utf8_lossy(&SENT.lock().unwrap())
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|event| event["id"] == id)
        .collect()
}

#[test]
fn a_field_with_a_keydown_handler_gets_its_navigation_keys() {
    sent_events(0);
    let mut input = e("input", json!({ "w": 200, "h": 30 }), vec![]);
    input["on"] = json!({ "keydown": 4242 });
    let mut rt = runtime(e("div", json!({ "w": 300 }), vec![input]), (300.0, 100.0));
    let keys = [Key::Text("a".into()), Key::Down, Key::Enter];
    type_into(&mut rt, "r/0/field", &keys);
    let keys: Vec<Value> = sent_events(4242).iter().map(|e| e["key"].clone()).collect();
    assert_eq!(keys, vec![json!("ArrowDown"), json!("Enter")]);
    assert_eq!(
        field_text(&rt, "r/0"),
        "a",
        "the handler's keys do not edit the text"
    );
}

#[test]
fn a_fields_keys_bubble_to_the_keydown_handlers_around_it() {
    sent_events(0);
    let input = e("input", json!({ "w": 200, "h": 30 }), vec![]);
    let mut inner = e("div", json!({ "w": 300 }), vec![input]);
    inner["on"] = json!({ "keydown": 4301 });
    let mut outer = e("div", json!({ "w": 300 }), vec![inner]);
    outer["on"] = json!({ "keydown": 4302 });
    let mut rt = runtime(outer, (300.0, 100.0));
    type_into(
        &mut rt,
        "r/0/0/field",
        &[Key::Text("g".into()), Key::Escape, Key::Text("h".into())],
    );
    // One keydown for the field's chain: the runtime runs each handler as the DOM bubbles it.
    let sent = sent_events(4301);
    let keys: Vec<Value> = sent.iter().map(|e| e["key"].clone()).collect();
    assert_eq!(keys, vec![json!("Escape")]);
    assert_eq!(sent[0]["chain"], json!([4302]));
    assert_eq!(
        field_text(&rt, "r/0/0"),
        "gh",
        "typing still edits the field"
    );
}

#[test]
fn a_space_between_two_inline_chips_keeps_them_apart() {
    let chip = |name: &str| e("button", json!({ "display": "inline" }), vec![t(name)]);
    let rt = runtime(
        e(
            "p",
            json!({ "w": 600 }),
            vec![chip("@Ada"), t(" "), chip("@Grace")],
        ),
        (600.0, 100.0),
    );
    let (first, second) = (rect(&rt, "r/0"), rect(&rt, "r/2"));
    assert!(
        second[0] - (first[0] + first[2]) >= 2.0,
        "{first:?} {second:?}"
    );
}

#[test]
fn an_svg_with_display_none_takes_no_space() {
    let hidden = json!({ "k": "svg", "h": "svg-hidden", "view": 16, "body": "<path d=\"M0 0h16v16z\"/>", "st": { "display": "none", "w": 50, "h": 16 } });
    let rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "w": 300 }),
            vec![hidden, e("span", json!({ "w": 40, "h": 10 }), vec![])],
        ),
        (300.0, 50.0),
    );
    assert_eq!(rect(&rt, "r/1")[0], 0.0);
}

#[test]
fn a_disabled_input_takes_no_typing() {
    let input = with_attrs(
        e("input", json!({ "w": 200, "h": 30 }), vec![]),
        json!({ "disabled": "true" }),
    );
    let mut rt = runtime(e("div", json!({ "w": 300 }), vec![input]), (300.0, 100.0));
    type_into(&mut rt, "r/0/field", &[Key::Text("a".into())]);
    assert_eq!(field_text(&rt, "r/0"), "");
}

#[test]
fn a_growing_sibling_takes_the_space_before_an_auto_margin() {
    // The sidebar: header, a `flex-1` scroller, and a footer with `mt-auto`.
    let rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "dir": "col", "w": 100, "h": 400 }),
            vec![
                e("div", json!({ "h": 50 }), vec![]),
                e("div", json!({ "grow": 1, "minH": 0 }), vec![]),
                e(
                    "div",
                    json!({ "h": 30, "marginAuto": [true, false, false, false] }),
                    vec![],
                ),
            ],
        ),
        (100.0, 400.0),
    );
    assert_eq!(rect(&rt, "r/1")[3], 320.0, "{:?}", rect(&rt, "r/1"));
    assert_eq!(rect(&rt, "r/2")[1], 370.0);
}

#[test]
fn a_sticky_header_stays_at_the_top_of_its_scroller() {
    let mut rows = vec![e("div", json!({ "h": 20, "stickyTop": 0 }), vec![])];
    rows.extend((0..20).map(|_| e("div", json!({ "h": 40 }), vec![])));
    let mut rt = runtime(
        e(
            "div",
            json!({ "h": 200, "w": 100, "scrollY": true }),
            vec![e("div", json!({}), rows)],
        ),
        (100.0, 200.0),
    );
    let before = rect(&rt, "r/0/0")[1];
    rt.update(|_, tx| tx.scroll_to_instant("r".to_string(), 0.0, 300.0));
    rt.frame(0.0);
    assert!(rect(&rt, "r/0/1")[1] < -200.0, "the rows scrolled");
    assert_eq!(
        rect(&rt, "r/0/0")[1],
        before,
        "the header stays put while its rows scroll"
    );
}

#[test]
fn a_dom_backed_editor_takes_its_roots_padding_and_min_height() {
    let editor = with_attrs(
        e(
            "div",
            json!({ "w": 400 }),
            vec![e(
                "div",
                json!({ "pad": [8, 12, 8, 12], "minH": 40, "fontSize": 14, "lineHeight": 21 }),
                vec![],
            )],
        ),
        json!({ "data-editable": "1", "placeholder": "Type a message..." }),
    );
    let rt = runtime(e("div", json!({ "w": 400 }), vec![editor]), (400.0, 100.0));
    let field = rect(&rt, "r/0/field");
    assert_eq!(field[0], 12.0, "{field:?}");
    assert!(rect(&rt, "r/0")[3] >= 40.0, "{:?}", rect(&rt, "r/0"));
}

#[test]
fn a_centred_element_pinned_on_both_sides_spans_between_them() {
    // `absolute inset-x-0 top-1/2 -translate-y-1/2 h-px`: a divider across its parent.
    let rt = runtime(
        e(
            "div",
            json!({ "w": 200, "h": 100 }),
            vec![e(
                "div",
                json!({ "absolute": [0, 50, 0, null], "centerY": true, "h": 2, "bg": "#ff0000ff" }),
                vec![],
            )],
        ),
        (200.0, 100.0),
    );
    assert_eq!(rect(&rt, "r/0")[2], 200.0, "{:?}", rect(&rt, "r/0"));
}

#[test]
fn an_svg_keeps_its_aspect_ratio_unless_it_asks_to_stretch() {
    let body = r#"<path d="M0 0h16v16h-16z" fill="oklch(0.628 0.2577 29.23)"/>"#;
    let left_edge = |par: Option<&str>| {
        let mut svg =
            json!({ "k": "svg", "h": format!("svg-{par:?}"), "view": 16, "body": body, "st": {} });
        if let Some(p) = par {
            svg["par"] = json!(p);
        }
        let s = state(e(
            "div",
            json!({ "w": 64, "h": 32, "bg": "#0000ffff" }),
            vec![svg],
        ));
        s.images.svg(16.0, body, 128.0).wait().expect("an svg");
        let mut rt = Runtime::new(s, view, (64.0, 32.0), Env::new(false, 1.0));
        rt.frame(0.0);
        let frame = render(&mut rt, (64, 32));
        assert!(frame.is(32, 16, RED), "{:?}", frame.at(32, 16));
        frame.at(3, 16)
    };
    // `meet` (the default): a square picture centred in a wide box leaves its sides empty.
    let fitted = left_edge(None);
    assert!(fitted[2] > 200 && fitted[0] < 60, "{fitted:?}");
    let stretched = left_edge(Some("none"));
    assert!(stretched[0] > 200 && stretched[2] < 60, "{stretched:?}");
}

/// Two 40x40 buttons 20 pt apart, the first with `st`; Tab focuses it from the keyboard.
fn tabbed_button(st: Value) -> Runtime<State> {
    let mut rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "dir": "row", "gapCol": 20, "pad": [20, 20, 20, 20] }),
            vec![
                e("button", st, vec![]),
                e("button", json!({ "w": 40, "h": 40 }), vec![]),
            ],
        ),
        (140.0, 80.0),
    );
    rt.key(KeyEvent {
        key: Key::Tab,
        mods: Mods::default(),
    });
    rt
}

#[test]
fn a_button_is_a_tab_stop_with_its_focus_visible_ring() {
    let mut rt = tabbed_button(
        json!({ "w": 40, "h": 40, "focusRing": { "width": 3, "offset": 0, "color": "#ff0000ff" } }),
    );
    let frame = render(&mut rt, (140, 80));
    assert!(frame.is(18, 40, RED), "ring {:?}", frame.at(18, 40));
    assert!(frame.is(40, 40, WHITE), "inside {:?}", frame.at(40, 40));
}

#[test]
fn a_hidden_outline_draws_no_focus_ring() {
    let mut rt = tabbed_button(json!({ "w": 40, "h": 40, "focusRing": "none" }));
    let frame = render(&mut rt, (140, 80));
    for x in 15..20 {
        assert!(frame.is(x, 40, WHITE), "x {x}: {:?}", frame.at(x, 40));
    }
}

#[test]
fn press_bg_fills_the_button_while_pressed() {
    let mut button = e(
        "button",
        json!({ "w": 40, "h": 40, "bg": "#ffffffff", "pressBg": "#ff0000ff" }),
        vec![],
    );
    button["on"] = json!({ "click": 7 });
    let mut rt = runtime(button, (40.0, 40.0));
    let rest = render(&mut rt, (40, 40));
    assert!(rest.is(20, 20, WHITE), "rest {:?}", rest.at(20, 20));
    rt.pointer_move(20.0, 20.0);
    rt.pointer_down(20.0, 20.0);
    rt.frame(0.5);
    let pressed = render(&mut rt, (40, 40));
    assert!(pressed.is(20, 20, RED), "pressed {:?}", pressed.at(20, 20));
}

/// A root holding `child`; trees differ by `tag` so their hashes never collide.
fn holder(tag: &str, children: Vec<Value>) -> Value {
    json!({ "k": "e", "h": format!("holder-{tag}"), "tag": "div", "st": { "w": 200, "h": 40 },
        "attrs": {}, "on": {}, "c": children })
}

fn child(tag: &str, st: Value) -> Value {
    json!({ "k": "e", "h": format!("child-{tag}"), "tag": "div", "st": st, "attrs": {}, "on": {}, "c": [] })
}

/// Sends `root` as the runtime's next tree and draws one 16 ms frame.
fn commit(rt: &mut Runtime<State>, root: Value) {
    let msg: TreeMsg =
        serde_json::from_value(json!({ "ack": 1, "root": root })).expect("wire tree");
    rt.update(move |s: &mut State, _| s.apply(msg));
    rt.frame(0.016);
}

#[test]
fn a_runtime_commit_lands_at_once_without_a_transition() {
    let box_of = |w: f32| {
        child(
            &format!("w{w}"),
            json!({ "w": w, "h": 40, "bg": "#ff0000ff" }),
        )
    };
    let mut rt = runtime(holder("a", vec![box_of(40.0)]), (200.0, 40.0));
    commit(&mut rt, holder("b", vec![box_of(160.0)]));
    assert_eq!(rect(&rt, "r/0")[2], 160.0);
}

#[test]
fn a_new_element_shows_at_once_without_a_transition() {
    let mut rt = runtime(holder("a", vec![]), (200.0, 40.0));
    commit(
        &mut rt,
        holder(
            "b",
            vec![child("new", json!({ "w": 40, "h": 40, "bg": "#ff0000ff" }))],
        ),
    );
    let (_, opacity) = rt.presented("r/0").expect("drawn");
    assert_eq!(opacity, 1.0);
}

#[test]
fn transition_opacity_fades_on_its_own_curve() {
    let faded = |o: f32| {
        child(
            &format!("o{o}"),
            json!({ "w": 40, "h": 40, "bg": "#ff0000ff", "opacity": o,
                "transition": { "opacity": { "duration": 0.2, "delay": 0, "ease": [0, 0, 1, 1] } } }),
        )
    };
    let mut rt = runtime(holder("a", vec![faded(0.0)]), (200.0, 40.0));
    commit(&mut rt, holder("b", vec![faded(1.0)]));
    rt.frame(0.1);
    let (_, halfway) = rt.presented("r/0").expect("drawn");
    assert!((0.3..0.7).contains(&halfway), "halfway {halfway}");
    rt.frame(0.3);
    assert_eq!(rt.presented("r/0").expect("drawn").1, 1.0);
}

#[test]
fn animate_spin_turns_an_icon_on_its_period() {
    // Rune turns an element's icon, not its box: the spinners Hazel draws are SVG icons.
    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 40, "h": 40 }),
            vec![
                json!({ "k": "svg", "h": "spinner", "view": 24, "body": "<path d=\"M0 0h24v6H0z\"/>",
                "st": { "w": 40, "h": 40, "color": "#ff0000ff", "animation": { "kind": "spin", "period": 1 } } }),
            ],
        ),
        (40.0, 40.0),
    );
    // A quarter turn clockwise: the band along the top now runs down the right side.
    rt.frame(0.25);
    let frame = draw(&mut rt, (40, 40));
    assert!(frame.is(37, 20, RED), "right {:?}", frame.at(37, 20));
    assert!(frame.is(20, 3, WHITE), "top {:?}", frame.at(20, 3));
}

#[test]
fn animate_pulse_dips_to_its_mid_opacity() {
    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 40, "h": 40, "bg": "#ff0000ff",
                "animation": { "kind": "pulse", "period": 2, "delay": 0, "from": 1, "to": 0.5 } }),
            vec![],
        ),
        (40.0, 40.0),
    );
    let red_at = |rt: &mut Runtime<State>, t: f64| {
        rt.frame(t);
        draw(rt, (40, 40)).at(20, 20)[1]
    };
    // Red over white: the green channel rises as the red fades.
    assert!(red_at(&mut rt, 0.0) < 20);
    let mid = red_at(&mut rt, 1.0);
    assert!((100..160).contains(&mid), "mid {mid}");
}

#[test]
fn animate_in_plays_its_entrance_on_mount() {
    let entering = json!({ "w": 40, "h": 40, "bg": "#ff0000ff",
        "animation": { "kind": "enter", "duration": 0.2, "delay": 0, "opacity": 0, "x": 0, "y": 8, "scale": 1 } });
    let mut rt = runtime(holder("a", vec![]), (200.0, 40.0));
    commit(&mut rt, holder("b", vec![child("enter", entering)]));
    let (_, early) = rt.presented("r/0").expect("drawn");
    assert!(early < 0.5, "early {early}");
    rt.frame(1.0);
    assert_eq!(rt.presented("r/0").expect("drawn").1, 1.0);
}

#[test]
fn w_frac_takes_a_share_of_the_parent_width() {
    let rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "w": 200, "h": 40 }),
            vec![e(
                "div",
                json!({ "w": { "frac": 0.25 }, "h": 40, "bg": "#ff0000ff" }),
                vec![],
            )],
        ),
        (200.0, 40.0),
    );
    assert_eq!(rect(&rt, "r/0")[2], 50.0);
}

#[test]
fn text_inside_an_svg_icon_draws_at_its_anchor() {
    let body = "<rect x=\"1.5\" y=\"3.5\" width=\"15\" height=\"11\" rx=\"2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"/>\
        <text x=\"9\" y=\"10.5\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"currentColor\" font-size=\"6\" font-weight=\"700\">GIF</text>";
    let rt = runtime(
        e(
            "div",
            json!({ "w": 36, "h": 36 }),
            vec![json!({ "k": "svg", "h": "gif", "view": 18, "body": body,
                "st": { "w": 36, "h": 36, "color": "#000000ff", "clip": true } })],
        ),
        (36.0, 36.0),
    );
    let glyphs: Vec<[f32; 4]> = rt
        .instances
        .iter()
        .filter(|i| i.params[1] == rune::render::KIND_GLYPH && i.rect[2] < 20.0)
        .map(|i| i.rect)
        .collect();
    // The icon's drawing is one glyph the size of the box; its letters are the rest.
    assert_eq!(glyphs.len(), 3, "glyphs {glyphs:?}");
    // Centred on (9, 10.5) in the viewBox: (18, 21) at twice the size.
    let left = glyphs.iter().map(|r| r[0]).fold(f32::MAX, f32::min);
    let right = glyphs.iter().map(|r| r[0] + r[2]).fold(f32::MIN, f32::max);
    let top = glyphs.iter().map(|r| r[1]).fold(f32::MAX, f32::min);
    let bottom = glyphs.iter().map(|r| r[1] + r[3]).fold(f32::MIN, f32::max);
    assert!(
        ((left + right) / 2.0 - 18.0).abs() < 1.5,
        "x {left}..{right}"
    );
    assert!(
        ((top + bottom) / 2.0 - 21.0).abs() < 2.0,
        "y {top}..{bottom}"
    );
}

#[test]
fn an_opacity_removed_without_a_transition_lands_at_once() {
    let faded = child(
        "half",
        json!({ "w": 40, "h": 40, "bg": "#ff0000ff", "opacity": 0.5 }),
    );
    let mut rt = runtime(holder("a", vec![faded]), (200.0, 40.0));
    commit(
        &mut rt,
        holder(
            "b",
            vec![child(
                "whole",
                json!({ "w": 40, "h": 40, "bg": "#ff0000ff" }),
            )],
        ),
    );
    assert_eq!(rt.presented("r/0").expect("drawn").1, 1.0);
}

#[test]
fn a_press_sends_pointerdown_pointerup_and_click_in_order() {
    sent_events(0);
    let mut button = e("button", json!({ "w": 40, "h": 40 }), vec![]);
    button["on"] = json!({ "pointerdown": 31, "pointerup": 31, "click": 31 });
    let mut rt = runtime(button, (40.0, 40.0));
    rt.pointer_move(20.0, 20.0);
    rt.pointer_down(20.0, 20.0);
    rt.pointer_up(20.0, 20.0);
    rt.frame(0.1);
    let kinds: Vec<String> = sent_events(31)
        .iter()
        .map(|e| e["type"].as_str().unwrap_or("").to_string())
        .collect();
    assert_eq!(kinds, ["pointerdown", "pointerup", "click"]);
}

#[test]
fn a_focused_trigger_gets_its_keydown_keys() {
    sent_events(0);
    let mut trigger = e("button", json!({ "w": 40, "h": 40 }), vec![]);
    trigger["on"] = json!({ "pointerdown": 32, "keydown": 33 });
    let mut rt = runtime(trigger, (40.0, 40.0));
    rt.key(KeyEvent {
        key: Key::Tab,
        mods: Mods::default(),
    });
    rt.key(KeyEvent {
        key: Key::Down,
        mods: Mods::default(),
    });
    rt.frame(0.1);
    let keys: Vec<String> = sent_events(33)
        .iter()
        .map(|e| e["key"].as_str().unwrap_or("").to_string())
        .collect();
    assert_eq!(keys, ["ArrowDown"]);
}

#[test]
fn a_runtime_focus_request_focuses_the_element_and_a_field_by_key() {
    let mut first = e("button", json!({ "w": 40, "h": 20 }), vec![]);
    first["on"] = json!({ "click": 40 });
    let mut second = e("button", json!({ "w": 40, "h": 20 }), vec![]);
    second["on"] = json!({ "click": 41 });
    let field = e("input", json!({ "w": 80, "h": 20 }), vec![]);
    let mut rt = runtime(
        e("div", json!({ "flex": "col" }), vec![first, second, field]),
        (100.0, 100.0),
    );
    let focused = |rt: &Runtime<State>| {
        rt.elements()
            .into_iter()
            .find(|e| e.focused)
            .and_then(|e| e.key)
    };
    let request = |rt: &mut Runtime<State>, msg: Value| {
        let msg: RuntimeMsg = serde_json::from_value(msg).expect("wire request");
        let run = msg.request().expect("a host request");
        rt.update(move |_, tx| run(tx));
        rt.frame(0.1);
    };
    request(&mut rt, json!({ "t": "focus", "key": "r/1" }));
    assert_eq!(focused(&rt).as_deref(), Some("r/1"));
    request(&mut rt, json!({ "t": "focus", "key": "r/2/field" }));
    assert_eq!(focused(&rt).as_deref(), Some("r/2/field"));
    request(&mut rt, json!({ "t": "focus", "key": "r/9" }));
    assert_eq!(
        focused(&rt).as_deref(),
        Some("r/2/field"),
        "an unknown key leaves focus where it was"
    );
}

fn sent_lines() -> Vec<Value> {
    let _ = crate::OUT.set(std::sync::Mutex::new(Box::new(Capture)));
    String::from_utf8_lossy(&SENT.lock().unwrap())
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect()
}

#[test]
fn a_portalled_panel_anchors_to_its_trigger_and_dismisses_on_an_outside_press() {
    sent_lines();
    let mut panel = e(
        "div",
        json!({ "w": 80, "h": 60, "bg": "#ff0000ff" }),
        vec![],
    );
    panel["ov"] = json!({ "anchor": { "to": "r/0", "side": "bottom", "align": "start", "gap": 4 }, "modal": "r/1/0" });
    // As the app renders it: the panel inside a `display: contents` wrapper inside the portal.
    let wrapper = e("div", json!({ "display": "contents" }), vec![panel]);
    let mut portal = e("div", json!({ "display": "contents" }), vec![wrapper]);
    portal["ov"] = json!({ "portal": 1 });
    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 300, "h": 200, "pad": [20, 20, 20, 20] }),
            vec![
                e("button", json!({ "w": 100, "h": 30 }), vec![]),
                // The panel renders inside a clipping box, as a menu does inside its trigger.
                e(
                    "div",
                    json!({ "w": 100, "h": 30, "clip": true }),
                    vec![portal],
                ),
            ],
        ),
        (300.0, 200.0),
    );
    // Below the trigger (20, 20, 100x30), 4 points away, its start edges aligned.
    assert_eq!(rect(&rt, "r/1/0/0/0"), [20.0, 54.0, 80.0, 60.0]);
    rt.pointer_move(250.0, 150.0);
    rt.pointer_down(250.0, 150.0);
    rt.pointer_up(250.0, 150.0);
    rt.frame(0.1);
    let dismissed = sent_lines()
        .iter()
        .any(|m| m["t"] == "dismiss" && m["path"] == "r/1/0");
    assert!(dismissed, "no dismiss for r/1/0");
}

#[test]
fn an_anchored_panel_holding_a_scroller_takes_its_content_height() {
    let item = |n: usize| e("div", json!({ "h": 30 }), vec![t(&format!("Item {n}"))]);
    let scroller = e(
        "div",
        json!({ "minH": 0, "grow": 1, "shrink": 1, "scrollY": true }),
        vec![e(
            "div",
            json!({ "display": "flex", "dir": "col", "pad": [4, 4, 4, 4] }),
            vec![item(1), item(2)],
        )],
    );
    let mut panel = e(
        "div",
        json!({ "display": "flex", "dir": "col", "minW": 128, "maxW": 320 }),
        vec![scroller],
    );
    panel["ov"] =
        json!({ "anchor": { "to": "r/0", "side": "bottom", "align": "start", "gap": 8 } });
    let mut portal = e("div", json!({ "display": "contents" }), vec![panel]);
    portal["ov"] = json!({ "portal": 1 });
    let rt = runtime(
        e(
            "div",
            json!({ "w": 400, "h": 300, "pad": [20, 20, 20, 20] }),
            vec![e("button", json!({ "w": 100, "h": 30 }), vec![]), portal],
        ),
        (400.0, 300.0),
    );
    // Two 30-point items and 4 points of padding above and below.
    assert_eq!(rect(&rt, "r/1/0")[3], 68.0);
}

#[test]
fn an_auto_grid_column_is_as_wide_as_its_widest_cell_on_every_row() {
    let cell = |w: Option<f32>| match w {
        Some(w) => e("div", json!({ "w": w, "h": 20 }), vec![]),
        None => e("div", json!({ "h": 20 }), vec![]),
    };
    let rt = runtime(
        e(
            "div",
            json!({ "w": 300 }),
            vec![e(
                "div",
                json!({ "display": "grid", "gridCols": ["auto", "1fr"], "gapCol": 10, "gapRow": 4 }),
                vec![cell(Some(60.0)), cell(None), cell(Some(30.0)), cell(None)],
            )],
        ),
        (300.0, 100.0),
    );
    // Both value cells start after the widest label (60) and the gap, and fill the rest.
    assert_eq!(rect(&rt, "r/0/1"), [70.0, 0.0, 230.0, 20.0]);
    assert_eq!(rect(&rt, "r/0/3"), [70.0, 24.0, 230.0, 20.0]);
}

#[test]
fn closing_a_modal_overlay_gives_focus_back_to_its_trigger() {
    sent_lines();
    let page = |open: bool| {
        let mut trigger = json!({ "k": "e", "h": format!("trigger{open}"), "tag": "button", "st": { "w": 100, "h": 30 },
            "attrs": {}, "on": { "click": 41 }, "c": [] });
        if !open {
            trigger["h"] = json!("trigger-closed");
        }
        let mut children = vec![trigger];
        if open {
            let mut item = e("div", json!({ "w": 80, "h": 20 }), vec![]);
            item["attrs"] = json!({ "tabindex": "0" });
            let mut panel = e("div", json!({ "w": 80, "h": 60 }), vec![item]);
            panel["ov"] = json!({ "anchor": { "to": "r/0", "side": "bottom", "align": "start", "gap": 4 }, "modal": "r/1" });
            let mut portal = e("div", json!({ "display": "contents" }), vec![panel]);
            portal["ov"] = json!({ "portal": 1 });
            children.push(portal);
        }
        json!({ "k": "e", "h": format!("page{open}"), "tag": "div", "st": { "w": 300, "h": 200, "pad": [20, 20, 20, 20] },
            "attrs": {}, "on": {}, "c": children })
    };
    let mut rt = runtime(page(false), (300.0, 200.0));
    commit(&mut rt, page(true));
    rt.frame(0.1);
    commit(&mut rt, page(false));
    rt.frame(0.2);
    rt.key(KeyEvent {
        key: Key::Text(" ".into()),
        mods: Mods::default(),
    });
    rt.frame(0.3);
    let pressed = sent_lines()
        .iter()
        .any(|m| m["id"] == 41 && m["type"] == "click");
    assert!(pressed, "Space did not reach the trigger");
}

#[test]
fn a_subgrid_row_takes_its_press() {
    sent_lines();
    let mut item = e(
        "span",
        json!({ "display": "grid", "subgrid": true, "colSpanFull": true, "gridCols": ["auto", "1fr"], "h": 30,
            "pad": [8, 8, 8, 8], "w": "full", "minW": 0, "items": "center", "clip": true, "radius": [8, 8, 8, 8],
            "hoverBg": "#00000009", "hoverGroup": true, "focusRing": "none", "pressBg": "#00000009",
            "transition": { "colors": { "duration": 0.15, "delay": 0, "ease": [0.4, 0, 0.2, 1] } } }),
        vec![
            e("span", json!({ "w": 20, "h": 20 }), vec![]),
            e("span", json!({}), vec![t("Browse")]),
        ],
    );
    item["on"] = json!({ "click": 51 });
    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 300 }),
            vec![e(
                "div",
                json!({ "display": "grid", "gridCols": ["auto", "1fr"] }),
                vec![item],
            )],
        ),
        (300.0, 100.0),
    );
    let (x, y) = rt.find("r/0/0").expect("drawn");
    rt.pointer_move(x, y);
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rt.frame(0.1);
    assert!(
        sent_lines().iter().any(|m| m["id"] == 51),
        "no click from the subgrid row"
    );
}

#[test]
fn a_press_on_a_tabindex_minus_one_child_reaches_the_row() {
    sent_lines();
    let mut label = e(
        "span",
        json!({ "w": 200, "h": 30 }),
        vec![t("Browse channels")],
    );
    label["attrs"] = json!({ "tabindex": "-1" });
    let mut row = e(
        "span",
        json!({ "display": "flex", "w": 300, "h": 30 }),
        vec![label],
    );
    row["attrs"] = json!({ "role": "link", "tabindex": "0" });
    row["on"] = json!({ "click": 61 });
    let mut rt = runtime(e("div", json!({ "w": 300 }), vec![row]), (300.0, 100.0));
    let (x, y) = rt.find("r/0/0").expect("label");
    rt.pointer_move(x, y);
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rt.frame(0.1);
    assert!(
        sent_lines().iter().any(|m| m["id"] == 61),
        "the label kept the press"
    );
}

#[test]
fn center_x_centres_an_absolute_box_horizontally_at_its_top() {
    let rt = runtime(
        e(
            "div",
            json!({ "w": 400, "h": 300 }),
            vec![e(
                "div",
                json!({ "w": 100, "h": 50, "absolute": [null, 30, null, null], "centerX": true, "bg": "#ff0000ff" }),
                vec![],
            )],
        ),
        (400.0, 300.0),
    );
    assert_eq!(rect(&rt, "r/0"), [150.0, 30.0, 100.0, 50.0]);
}

#[test]
fn a_display_contents_portal_draws_once() {
    let backdrop = e(
        "div",
        json!({ "absolute": [0, 0, 0, 0], "w": 100, "h": 100, "bg": "#00000026" }),
        vec![],
    );
    let mut portal = e("div", json!({ "display": "contents" }), vec![backdrop]);
    portal["ov"] = json!({ "portal": 1, "modal": "r/0" });
    let mut rt = runtime(
        e(
            "div",
            json!({ "display": "flex", "w": 100, "h": 100, "bg": "#ffffffff" }),
            vec![portal],
        ),
        (100.0, 100.0),
    );
    let frame = render(&mut rt, (100, 100));
    // One 15% black layer over white; drawn in place as well as at the root it would be 184.
    assert!(frame.is(50, 50, [217, 217, 217]), "{:?}", frame.at(50, 50));
}

#[test]
fn a_subgrid_row_reports_the_pointer_entering_it() {
    sent_lines();
    let mut item = e(
        "div",
        json!({ "display": "grid", "subgrid": true, "colSpanFull": true, "gridCols": ["auto", "1fr"], "h": 30 }),
        vec![
            e("span", json!({ "w": 20, "h": 20 }), vec![]),
            e("span", json!({}), vec![t("Manage members")]),
        ],
    );
    item["on"] = json!({ "click": 71, "mouseenter": 72, "mouseleave": 73 });
    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 300 }),
            vec![e(
                "div",
                json!({ "display": "grid", "gridCols": ["auto", "1fr"] }),
                vec![item],
            )],
        ),
        (300.0, 100.0),
    );
    let (x, y) = rt.find("r/0/0").expect("drawn");
    rt.pointer_move(x, y);
    rt.frame(0.1);
    assert!(
        sent_lines().iter().any(|m| m["id"] == 72),
        "no mouseenter from the subgrid row"
    );
}

#[test]
fn a_watched_row_reports_the_pointer_to_its_mount() {
    sent_lines();
    let mut row = e("div", json!({ "w": 200, "h": 30 }), vec![]);
    row["attrs"] = json!({ "data-hover-report": "r" });
    let mut rt = runtime(
        e("div", json!({ "w": 200, "h": 100 }), vec![row]),
        (200.0, 100.0),
    );
    rt.pointer_move(50.0, 15.0);
    rt.frame(0.1);
    let reported = sent_lines().iter().any(|m| {
        m["t"] == "pointer" && m["path"] == "r/0" && m["mount"] == "r" && m["inside"] == true
    });
    assert!(reported, "no pointer report for r/0");
}

#[test]
fn a_right_click_on_a_watched_row_reaches_its_mount_at_the_pointer() {
    sent_lines();
    let mut row = e("div", json!({ "w": 200, "h": 30 }), vec![]);
    row["attrs"] = json!({ "data-hover-report": "r" });
    let mut rt = runtime(
        e(
            "div",
            json!({ "w": 200, "h": 100 }),
            vec![e("div", json!({ "h": 40 }), vec![]), row],
        ),
        (200.0, 100.0),
    );
    rt.secondary_down(60.0, 50.0);
    rt.secondary_up(60.0, 50.0);
    rt.frame(0.1);
    let reported = sent_lines()
        .into_iter()
        .find(|m| m["t"] == "contextmenu" && m["path"] == "r/1");
    let reported = reported.expect("no contextmenu report for r/1");
    assert_eq!(
        (
            reported["mount"].clone(),
            reported["x"].clone(),
            reported["y"].clone()
        ),
        (json!("r"), json!(60.0), json!(50.0))
    );
    assert_eq!(
        reported["rects"]["r/1"],
        json!([0.0, 40.0, 200.0, 30.0]),
        "the clicked row's drawn rect"
    );
}

#[test]
fn a_modal_layout_places_its_panel_in_the_middle_row_centred_across() {
    let panel = e("div", json!({ "w": 100, "h": 60, "rowStart": 2 }), vec![]);
    let grid = e(
        "div",
        json!({ "display": "grid", "gridRows": ["1fr", "auto", "3fr"], "justifyItems": "center", "w": 300, "h": 260 }),
        vec![panel],
    );
    let rt = runtime(grid, (300.0, 260.0));
    // 200 left over for 1fr and 3fr: the panel starts a quarter of the way down.
    assert_eq!(rect(&rt, "r/0"), [100.0, 50.0, 100.0, 60.0]);
}

#[test]
fn a_flex_1_body_in_an_overlay_column_takes_its_contents_height() {
    let content = e("div", json!({ "h": 40 }), vec![]);
    let body = e(
        "div",
        json!({ "display": "flex", "dir": "col", "grow": 1, "shrink": 1, "minH": 0, "scrollY": true }),
        vec![content],
    );
    let column = e(
        "div",
        json!({ "display": "flex", "dir": "col", "w": 200, "maxH": 500 }),
        vec![body],
    );
    let mut portal = e("div", json!({}), vec![column]);
    portal["ov"] = json!({ "portal": 1 });
    let rt = runtime(e("div", json!({}), vec![portal]), (300.0, 300.0));
    // In CSS a 0% basis in a column of indefinite height is content-sized; it must not collapse.
    assert_eq!(rect(&rt, "r/0/0/0")[3], 40.0);
}

#[test]
fn elements_appear_and_vanish_at_once_as_in_the_dom() {
    let tree = |children: Vec<Value>| -> TreeMsg {
        serde_json::from_value(json!({
            "ack": 1, "page": { "bg": "#ffffffff" },
            "root": e("div", json!({ "w": 200, "h": 100 }), children),
        }))
        .expect("wire tree")
    };
    let mut rt = runtime(
        e("div", json!({ "w": 200, "h": 100 }), vec![]),
        (200.0, 100.0),
    );
    let shown = |rt: &Runtime<State>, text: &str| {
        rt.elements()
            .iter()
            .any(|e| e.text.as_deref() == Some(text) && !e.exiting && e.opacity > 0.99)
    };
    let next = tree(vec![e("span", json!({}), vec![t("Toolbar")])]);
    rt.update(move |s, _| s.apply(next));
    rt.frame(0.016);
    assert!(
        shown(&rt, "Toolbar"),
        "an inserted element shows in full on its first frame"
    );
    let next = tree(vec![]);
    rt.update(move |s, _| s.apply(next));
    rt.frame(0.016);
    assert!(
        !rt.elements()
            .iter()
            .any(|e| e.text.as_deref() == Some("Toolbar")),
        "a removed element is gone on the next frame"
    );
}

#[test]
fn a_link_inside_a_focusable_wrapper_follows_its_href_on_a_press() {
    sent_lines();
    let link = with_attrs(
        e(
            "a",
            json!({ "display": "grid", "w": 40, "h": 40 }),
            vec![t("H")],
        ),
        json!({ "href": "/hazel", "tabindex": "0" }),
    );
    let wrapper = with_attrs(
        e("span", json!({ "display": "grid" }), vec![link]),
        json!({ "role": "link", "aria-label": "Home", "tabindex": "0" }),
    );
    let mut rt = runtime(
        e("div", json!({ "w": 100, "h": 100 }), vec![wrapper]),
        (100.0, 100.0),
    );
    rt.pointer_move(20.0, 20.0);
    rt.pointer_down(20.0, 20.0);
    rt.pointer_up(20.0, 20.0);
    rt.frame(0.1);
    let followed = sent_lines()
        .iter()
        .any(|m| m["type"] == "link" && m["value"] == "/hazel");
    assert!(followed, "the press did not follow the link");
}

#[test]
fn a_subgrid_link_row_follows_its_href_on_a_press() {
    sent_lines();
    let link = with_attrs(
        e(
            "a",
            json!({ "display": "grid", "subgrid": true, "colSpanFull": true, "gridCols": ["auto", "1fr"], "h": 32 }),
            vec![
                e("span", json!({}), vec![t("#")]),
                e("span", json!({}), vec![t("engineering")]),
            ],
        ),
        json!({ "href": "/hazel/chat/engineering" }),
    );
    let list = e(
        "div",
        json!({ "display": "grid", "gridCols": ["auto", "1fr"], "w": 200 }),
        vec![link],
    );
    let mut rt = runtime(list, (200.0, 100.0));
    rt.pointer_move(100.0, 16.0);
    rt.pointer_down(100.0, 16.0);
    rt.pointer_up(100.0, 16.0);
    rt.frame(0.1);
    let followed = sent_lines()
        .iter()
        .any(|m| m["type"] == "link" && m["value"] == "/hazel/chat/engineering");
    assert!(followed, "a press on a subgrid row did not follow its link");
}

#[test]
fn a_fixed_element_is_placed_against_the_window_in_a_taller_page() {
    let bar = e(
        "div",
        json!({ "fixed": true, "absolute": [0, null, 0, 0], "h": 20, "bg": "#0000ffff" }),
        vec![t("Copied")],
    );
    let page = e(
        "div",
        json!({ "h": 1200 }),
        vec![e("div", json!({ "h": 1200 }), vec![bar])],
    );
    let rt = runtime(page, (300.0, 800.0));
    let [_, y, _, h] = rect(&rt, "r/0/0");
    assert_eq!(
        y + h,
        800.0,
        "a bottom-0 fixed bar sits on the window's bottom edge"
    );
}

#[test]
fn a_fixed_panel_inside_a_dialog_stays_above_the_page() {
    sent_lines();
    let mut cover = e("button", json!({ "w": 200, "h": 200 }), vec![]);
    cover["on"] = json!({ "click": 50 });
    let mut inside = e("button", json!({ "w": 60, "h": 30 }), vec![]);
    inside["on"] = json!({ "click": 51 });
    let panel = e(
        "div",
        json!({ "fixed": true, "absolute": [0, 0, null, null] }),
        vec![inside],
    );
    let mut dialog = e("div", json!({}), vec![panel]);
    dialog["ov"] = json!({ "portal": 1, "modal": "r/1" });
    let mut rt = runtime(e("div", json!({}), vec![cover, dialog]), (200.0, 200.0));
    rt.pointer_move(10.0, 10.0);
    rt.pointer_down(10.0, 10.0);
    rt.pointer_up(10.0, 10.0);
    rt.frame(0.1);
    let clicked: Vec<Value> = sent_lines()
        .into_iter()
        .filter(|m| m["type"] == "click" && (m["id"] == 50 || m["id"] == 51))
        .map(|m| m["id"].clone())
        .collect();
    assert_eq!(clicked, [json!(51)], "the press reached the dialog's panel");
}

#[test]
fn space_on_a_tabbed_unstyled_checkbox_toggles_it_and_a_checked_radio_stays() {
    sent_lines();
    // Unstyled, as inside the app's visually hidden wrappers: a browser's 13px box.
    let mut checkbox = with_attrs(e("input", json!({}), vec![]), json!({ "type": "checkbox" }));
    checkbox["on"] = json!({ "change": 60 });
    let mut radio = with_attrs(
        e("input", json!({ "w": 16, "h": 16 }), vec![]),
        json!({ "type": "radio", "checked": "" }),
    );
    radio["on"] = json!({ "change": 61 });
    let mut rt = runtime(
        e("div", json!({ "flex": "col" }), vec![checkbox, radio]),
        (100.0, 100.0),
    );
    let space = |rt: &mut Runtime<State>| {
        rt.key(KeyEvent {
            key: Key::Text(" ".into()),
            mods: Mods::default(),
        });
        rt.frame(0.1);
    };
    for _ in 0..2 {
        rt.key(KeyEvent {
            key: Key::Tab,
            mods: Mods::default(),
        });
        rt.frame(0.1);
        space(&mut rt);
    }
    assert!(
        rt.state.fields.is_empty(),
        "a checkbox or radio is no text field"
    );
    let changes: Vec<Value> = sent_lines()
        .into_iter()
        .filter(|m| m["type"] == "change" && (m["id"] == 60 || m["id"] == 61))
        .map(|m| m["id"].clone())
        .collect();
    assert_eq!(
        changes,
        [json!(60)],
        "the checkbox toggled; the checked radio did not fire"
    );
}

#[test]
fn tab_reaches_an_empty_button_as_a_browser_does() {
    let first = e("button", json!({ "w": 40, "h": 20 }), vec![]);
    let hidden = e("button", json!({}), vec![]);
    let mut rt = runtime(
        e("div", json!({ "flex": "col" }), vec![first, hidden]),
        (100.0, 100.0),
    );
    for _ in 0..2 {
        rt.key(KeyEvent {
            key: Key::Tab,
            mods: Mods::default(),
        });
        rt.frame(0.1);
    }
    assert!(
        rt.focused_path().is_some_and(|p| p.ends_with("r/1")),
        "the 0x0 button took focus: {:?}",
        rt.focused_path()
    );
}

#[test]
fn an_inline_block_without_text_sits_on_the_baseline_of_its_line() {
    // A 96px avatar button in a block with a 16px/24px strut: the line adds the strut's
    // descent below it, so the block is 102px tall, as in Chromium.
    let zone = e(
        "div",
        json!({}),
        vec![e("button", json!({ "w": 96, "h": 96 }), vec![])],
    );
    let after = e("p", json!({ "h": 16 }), vec![t("Click or drop image")]);
    let rt = runtime(e("div", json!({}), vec![zone, after]), (300.0, 300.0));
    let [_, y, _, _] = rect(&rt, "r/1");
    assert!((y - 102.2).abs() < 0.5, "the text below starts at {y}");
}

#[test]
fn a_full_height_empty_state_leaves_room_for_the_composer() {
    // The channel page: header, a flex-1 min-h-0 list holding an h-full empty state, composer.
    // In CSS the list shrinks to what the scrolling column leaves; it must not push the composer out.
    // The styles the resolver gives the app's classes.
    let picture = e(
        "div",
        json!({ "aspectRatio": 1, "w": "full", "maxW": 384 }),
        vec![with_attrs(
            e(
                "img",
                json!({ "clip": true, "inline": false, "display": "block", "maxW": "full", "h": "full", "w": "full", "objectFit": "cover", "opacity": 0.5 }),
                vec![],
            ),
            json!({ "src": "/images/squirrle_ocean.webp" }),
        )],
    );
    let empty = e(
        "div",
        json!({ "pad": [32, 32, 32, 32], "inline": false, "display": "flex", "w": "full", "h": "full", "dir": "col", "items": "center", "justify": "center" }),
        vec![picture, e("p", json!({ "h": 28 }), vec![t("Quiet")])],
    );
    let list = e(
        "div",
        json!({ "inline": false, "display": "flex", "minH": 0, "grow": 1, "shrink": 1, "dir": "col", "clip": true }),
        vec![empty],
    );
    // The column itself scrolls (`overflow-y-auto`), as the split panel's content does.
    let page = e(
        "div",
        json!({ "display": "flex", "dir": "col", "h": 800, "minH": 0, "grow": 1, "scrollY": true }),
        vec![
            e("div", json!({ "h": 96 }), vec![]),
            list,
            e("div", json!({ "h": 90 }), vec![t("composer")]),
        ],
    );
    let rt = runtime(page, (930.0, 800.0));
    let [_, _, _, h] = rect(&rt, "r/1");
    assert_eq!(h, 614.0, "the list takes what header and composer leave");
    let [_, y, _, _] = rect(&rt, "r/2");
    assert_eq!(y, 710.0, "the composer stays in the window");
}

#[test]
fn an_arrow_on_a_focused_radio_asks_the_runtime_for_the_next_in_its_group() {
    sent_lines();
    let radio = |checked: bool| {
        let mut attrs = json!({ "type": "radio", "name": "mode", "tabindex": "0" });
        if checked {
            attrs["checked"] = json!("");
        }
        with_attrs(e("input", json!({}), vec![]), attrs)
    };
    let mut rt = runtime(
        e(
            "div",
            json!({ "flex": "col" }),
            vec![radio(true), radio(false)],
        ),
        (100.0, 100.0),
    );
    rt.key(KeyEvent {
        key: Key::Tab,
        mods: Mods::default(),
    });
    rt.frame(0.1);
    rt.key(KeyEvent {
        key: Key::Down,
        mods: Mods::default(),
    });
    rt.frame(0.1);
    let asked = sent_lines()
        .into_iter()
        .any(|m| m["t"] == "radio" && m["path"] == "r/0" && m["step"] == 1);
    assert!(asked, "ArrowDown on the radio asks for the next one");
}

#[test]
fn a_press_on_a_label_asks_for_its_controls_activation_unless_it_handles_clicks() {
    sent_lines();
    let plain = e(
        "label",
        json!({ "display": "block", "h": 20 }),
        vec![t("Name")],
    );
    let mut own = e(
        "label",
        json!({ "display": "block", "h": 20 }),
        vec![t("Remember")],
    );
    own["on"] = json!({ "click": 70 });
    let mut rt = runtime(
        e("div", json!({ "flex": "col" }), vec![plain, own]),
        (200.0, 100.0),
    );
    for y in [10.0, 30.0] {
        rt.pointer_move(5.0, y);
        rt.pointer_down(5.0, y);
        rt.pointer_up(5.0, y);
        rt.frame(0.1);
    }
    let labels: Vec<Value> = sent_lines()
        .into_iter()
        .filter(|m| m["t"] == "label")
        .map(|m| m["path"].clone())
        .collect();
    assert_eq!(
        labels,
        [json!("r/0")],
        "only the label without its own click handler"
    );
}

#[test]
fn pointer_events_none_inherits_and_auto_turns_presses_back_on() {
    sent_lines();
    let mut off = e("button", json!({ "w": 100, "h": 20 }), vec![]);
    off["on"] = json!({ "click": 80 });
    let mut on = e(
        "button",
        json!({ "w": 100, "h": 20, "pointerEvents": "auto" }),
        vec![],
    );
    on["on"] = json!({ "click": 81 });
    let wrapper = e(
        "div",
        json!({ "display": "flex", "dir": "col", "pointerEvents": "none" }),
        vec![off, on],
    );
    let mut rt = runtime(wrapper, (200.0, 100.0));
    for y in [10.0, 30.0] {
        rt.pointer_move(50.0, y);
        rt.pointer_down(50.0, y);
        rt.pointer_up(50.0, y);
        rt.frame(0.1);
    }
    let clicked: Vec<Value> = sent_lines()
        .into_iter()
        .filter(|m| m["type"] == "click" && (m["id"] == 80 || m["id"] == 81))
        .map(|m| m["id"].clone())
        .collect();
    assert_eq!(
        clicked,
        [json!(81)],
        "only the pointer-events: auto button takes the press"
    );
}

#[test]
fn the_document_scrolls_when_it_is_taller_than_the_window() {
    let page = e(
        "div",
        json!({}),
        vec![
            e("div", json!({ "h": 1000 }), vec![]),
            e("p", json!({ "h": 20 }), vec![t("Danger Zone")]),
        ],
    );
    let mut rt = runtime(page, (300.0, 800.0));
    let (_, before) = rt.find("r/1").expect("drawn");
    rt.wheel(150.0, 400.0, -300.0);
    rt.frame(0.0);
    let (_, after) = rt.find("r/1").expect("drawn");
    assert!(
        after < before - 200.0,
        "the page scrolled: {before} -> {after}"
    );
}

#[test]
fn a_file_input_click_opens_an_open_dialog_and_reports_the_picked_file() {
    sent_lines();
    let mut rt = runtime(
        e("div", json!({ "w": 100, "h": 100 }), vec![]),
        (100.0, 100.0),
    );
    let msg: RuntimeMsg =
        serde_json::from_value(json!({ "t": "pickFile", "path": "r/0", "accept": "image/*" }))
            .expect("wire request");
    let run = msg.request().expect("a host request");
    rt.update(move |_, tx| run(tx));
    rt.frame(0.1);
    let (kind, options) = rt.file_dialog().expect("an Open dialog shows");
    assert_eq!(kind, rune::FileDialogKind::Open);
    assert!(
        options
            .filters
            .iter()
            .any(|(_, ext)| ext.iter().any(|e| e == "png")),
        "filtered to images"
    );
    rt.resolve_file_dialog(Some("/tmp/avatar.png".into()))
        .expect("answered");
    rt.frame(0.1);
    let reported = sent_lines().into_iter().any(|m| {
        m["t"] == "files" && m["path"] == "r/0" && m["files"] == json!(["/tmp/avatar.png"])
    });
    assert!(reported, "the picked file reaches the runtime");
}

#[test]
fn table_cells_line_up_in_columns_across_rows() {
    let cell = |w: f32, text: &str| e("td", json!({ "w": w }), vec![t(text)]);
    let row = |cells: Vec<Value>| {
        e(
            "tr",
            json!({ "border": [0, 0, 1, 0], "borderColor": "#ff0000ff" }),
            cells,
        )
    };
    let mut wide = e("td", json!({}), vec![t("spans both")]);
    wide["attrs"] = json!({ "colspan": "2" });
    let table = e(
        "table",
        json!({ "w": 300 }),
        vec![e(
            "tbody",
            json!({}),
            vec![
                row(vec![cell(40.0, "a"), cell(120.0, "b")]),
                row(vec![cell(90.0, "c"), cell(20.0, "d")]),
                row(vec![wide]),
            ],
        )],
    );
    let rt = runtime(table, (300.0, 200.0));
    let x = |path: &str| rect(&rt, path)[0];
    let y = |path: &str| rect(&rt, path)[1];
    assert!(
        x("r/0/0/1") >= 90.0,
        "a row's cells sit side by side, past the widest first cell"
    );
    assert_eq!(y("r/0/0/1"), y("r/0/0/0"), "a row's cells share a line");
    assert_eq!(
        x("r/0/0/1"),
        x("r/0/1/1"),
        "the second column starts at the same x in every row"
    );
    assert!(y("r/0/1/0") > y("r/0/0/0"), "rows stack");
    assert!(
        rect(&rt, "r/0/2/0")[2] >= 200.0,
        "a colspan=2 cell spans both columns"
    );
}

#[test]
fn table_columns_share_spare_width_by_content_and_cells_centre_vertically() {
    // Content 100 and 300 wide in an 800-wide table: CSS gives 200 and 600.
    let row = e(
        "tr",
        json!({}),
        vec![
            e(
                "td",
                json!({}),
                vec![e("div", json!({ "w": 100, "h": 60 }), vec![])],
            ),
            e(
                "td",
                json!({}),
                vec![e("div", json!({ "w": 300, "h": 20 }), vec![])],
            ),
        ],
    );
    let table = e(
        "table",
        json!({ "w": 800 }),
        vec![e("tbody", json!({}), vec![row])],
    );
    let rt = runtime(table, (800.0, 200.0));
    let [x, _, w, _] = rect(&rt, "r/0/0/1");
    assert_eq!(
        (x, w),
        (200.0, 600.0),
        "columns in proportion to their content"
    );
    assert_eq!(
        rect(&rt, "r/0/0/1/0")[1],
        20.0,
        "the short cell's content sits in the middle of the 60-tall row"
    );
}

#[test]
fn a_lone_span_of_smaller_text_sits_on_its_blocks_baseline() {
    // A 12/16 span in a 16/24 block: the line is the block's 24, the span 5.45 down.
    let label = e(
        "div",
        json!({}),
        vec![e(
            "span",
            json!({ "fontSize": 12, "lineHeight": 16 }),
            vec![t("Settings")],
        )],
    );
    let rt = runtime(e("div", json!({}), vec![label]), (300.0, 100.0));
    let [_, y, _, _] = rect(&rt, "r/0/0");
    assert!((y - 5.45).abs() < 0.2, "the span starts at {y}");
    assert!(
        (rect(&rt, "r/0")[3] - 24.0).abs() < 0.2,
        "the line is the block's strut"
    );
}

#[test]
fn an_inline_label_in_a_block_is_as_wide_as_its_text() {
    let block = |align: Value| {
        e(
            "div",
            json!({ "w": 300, "textAlign": align }),
            vec![e("label", json!({}), vec![t("Organization Name")])],
        )
    };
    let rt = runtime(
        e(
            "div",
            json!({}),
            vec![block(json!("left")), block(json!("center"))],
        ),
        (300.0, 100.0),
    );
    let [x, _, w, _] = rect(&rt, "r/0/0");
    assert!(
        x == 0.0 && w < 200.0,
        "the label takes its text's width: {w}"
    );
    let [cx, _, cw, _] = rect(&rt, "r/1/0");
    assert!(
        (cx + cw / 2.0 - 150.0).abs() < 1.0,
        "text-align centres the label"
    );
}

#[test]
fn an_inline_flex_child_of_a_block_keeps_its_own_width() {
    let badge = e(
        "span",
        json!({ "display": "flex", "inline": true, "pad": [2, 8, 2, 8] }),
        vec![t("Owner")],
    );
    let cell = e("div", json!({ "w": 300 }), vec![badge]);
    let rt = runtime(cell, (300.0, 100.0));
    let [x, _, w, _] = rect(&rt, "r/0");
    assert!(
        w < 150.0,
        "the badge is as wide as its text, not the block: {w}"
    );
    assert_eq!(x, 0.0, "it starts where text-align puts it");
}

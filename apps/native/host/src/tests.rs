//! The host's CSS emulation driven end to end: handwritten wire trees go through `State::apply`
//! and the real view into Rune's in-process runtime, and the tests read back presented rects,
//! field state and rendered pixels.
use std::sync::atomic::{AtomicU64, Ordering};

use rune::edit::{Key, KeyEvent, Mods};
use rune::render::{Gpu, Offscreen, Renderer};
use rune::{Env, Runtime};
use serde_json::{Value, json};

use crate::wire::TreeMsg;
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
    let mut rt = Runtime::new(state(root), view, size, Env::new(false, 1.0));
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

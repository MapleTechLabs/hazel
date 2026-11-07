//! `<text>` inside an SVG icon. Rune rasterises SVG without fonts, so the host takes the text out
//! of the drawing and lays it over the icon as a Rune text run at the same anchor.
use rune::tok::TextStyle;
use rune::{Align, Color, El, row, text};

/// One `<text>` element, in viewBox units.
#[derive(Debug, PartialEq)]
pub struct SvgText {
    pub x: f32,
    pub y: f32,
    pub size: f32,
    pub weight: f32,
    /// `text-anchor`: `start`, `middle` or `end`.
    pub anchor: String,
    /// `dominant-baseline: middle` (or `central`): `y` is the text's centre, not its baseline.
    pub middle: bool,
    pub content: String,
}

/// The body without its `<text>` elements, and those elements.
pub fn split(body: &str) -> (String, Vec<SvgText>) {
    let mut shape = String::with_capacity(body.len());
    let mut texts = Vec::new();
    let mut rest = body;
    while let Some(at) = rest.find("<text") {
        shape.push_str(&rest[..at]);
        let Some(open_end) = rest[at..].find('>').map(|i| at + i) else {
            break;
        };
        let attrs = &rest[at + 5..open_end];
        let (content, next) = match rest[open_end..].find("</text>") {
            Some(close) => (&rest[open_end + 1..open_end + close], open_end + close + 7),
            None => ("", open_end + 1),
        };
        let attr = |name: &str| attribute(attrs, name);
        let num =
            |name: &str, fallback: f32| attr(name).and_then(|v| v.parse().ok()).unwrap_or(fallback);
        texts.push(SvgText {
            x: num("x", 0.0),
            y: num("y", 0.0),
            size: num("font-size", 16.0),
            weight: num("font-weight", 400.0),
            anchor: attr("text-anchor").unwrap_or("start").to_string(),
            middle: matches!(attr("dominant-baseline"), Some("middle" | "central")),
            content: unescape(content.trim()),
        });
        rest = &rest[next..];
    }
    shape.push_str(rest);
    (shape, texts)
}

fn attribute<'a>(attrs: &'a str, name: &str) -> Option<&'a str> {
    let key = format!(" {name}=\"");
    let at = attrs.find(&key)? + key.len();
    let end = attrs[at..].find('"')?;
    Some(&attrs[at..at + end])
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
}

/// The text over an icon `size` points square drawn from a `view`-unit viewBox.
pub fn overlay(t: &SvgText, view: f32, size: f32, color: Color) -> El {
    let k = size / view;
    let font = t.size * k;
    let line = font * 1.2;
    // A baseline sits about 0.8 em below the line's top; `middle` centres the line on `y`.
    let top = if t.middle {
        t.y * k - line / 2.0
    } else {
        t.y * k - font * 0.8 - (line - font) / 2.0
    };
    let mut style = TextStyle::new(font, t.weight);
    style.line_height = line;
    let label = text(t.content.clone())
        .font(style)
        .color(color)
        .single_line();
    let x = t.x * k;
    // The run spans to the far edge on the anchored side, so aligning it puts the anchor at `x`.
    let (left, right, align) = match t.anchor.as_str() {
        "middle" => (Some(x - size), Some(size - x - size), Align::Center),
        "end" => (Some(-size), Some(size - x), Align::End),
        _ => (Some(x), Some(-size), Align::Start),
    };
    let lane = row()
        .h(line)
        .items_center()
        .pin(left, Some(top), right, None);
    match align {
        Align::Center => lane.justify_center().child(label),
        Align::End => lane.justify_end().child(label),
        _ => lane.child(label),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_takes_text_out_of_the_drawing() {
        let (shape, texts) = split(
            "<rect x=\"1\"/><text x=\"9\" y=\"10.5\" text-anchor=\"middle\" font-size=\"6\">G&amp;F</text><path d=\"M0\"/>",
        );
        assert_eq!(shape, "<rect x=\"1\"/><path d=\"M0\"/>");
        assert_eq!(texts.len(), 1);
        assert_eq!((texts[0].x, texts[0].y, texts[0].size), (9.0, 10.5, 6.0));
        assert_eq!(texts[0].anchor, "middle");
        assert_eq!(texts[0].content, "G&F");
    }
}

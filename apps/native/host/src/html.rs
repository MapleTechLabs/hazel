//! What HTML itself says about an element by its tag and attributes, before any CSS: its default
//! display, whether it is a control, a text field, or a Tab stop.
use std::collections::HashMap;

/// Tags whose default display is inline (and not replaced): they take part in a line, not in
/// block flow, and hold their content in one.
const INLINE_TAGS: [&str; 18] = [
    "span", "a", "strong", "em", "code", "b", "i", "s", "u", "mark", "time", "br", "label", "kbd",
    "small", "abbr", "sub", "sup",
];

/// Controls and pictures a browser draws as `inline-block`: atomic in a line, sized by their own
/// box rather than by the line's text.
const ATOMIC_INLINE_TAGS: [&str; 5] = ["button", "img", "input", "select", "textarea"];

/// An inline (non-replaced) element by default: `display: inline` with no style saying otherwise.
pub fn is_inline_tag(tag: &str) -> bool {
    INLINE_TAGS.contains(&tag)
}

/// A control or picture a browser draws as an `inline-block` by default.
pub fn is_atomic_inline_tag(tag: &str) -> bool {
    ATOMIC_INLINE_TAGS.contains(&tag)
}

/// An element whose own content runs along one line by default: an inline element, or a
/// `<button>`, whose label and icon sit side by side. A button is no inline element in
/// `is_inline_tag`'s sense: it is atomic in its parent's line (it keeps its own box there).
pub fn lays_out_inline(tag: &str) -> bool {
    is_inline_tag(tag) || tag == "button"
}

/// An element the host lays out as a whole (a replaced box, a control, a table): CSS block flow,
/// margin collapsing included, never reaches inside it.
pub fn is_opaque(tag: &str) -> bool {
    is_atomic_inline_tag(tag) || tag == "table"
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

/// Elements HTML puts in the Tab order (or `tabindex` adds), unless disabled. A negative
/// `tabindex` takes them out: in Rune a focusable element keeps the presses on it, where a
/// browser lets the click bubble, and the host has no script focus that would need it.
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

/// `tabindex="-1"`: focusable by script (`element.focus()`, a menu moving its highlight) and
/// by a press, but no Tab stop.
pub fn script_focusable(attrs: &HashMap<String, String>) -> bool {
    !attrs.contains_key("disabled")
        && attrs
            .get("tabindex")
            .and_then(|t| t.trim().parse::<i32>().ok())
            .is_some_and(|order| order < 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_button_runs_its_content_inline_but_is_atomic_in_its_line() {
        assert!(lays_out_inline("button") && is_atomic_inline_tag("button"));
        assert!(!is_inline_tag("button"));
        for tag in ["b", "i", "s", "small", "sup"] {
            assert!(is_inline_tag(tag) && lays_out_inline(tag), "{tag}");
        }
        assert!(!lays_out_inline("div") && !is_opaque("div"));
        assert!(is_opaque("table") && is_opaque("img") && !is_opaque("span"));
    }
}

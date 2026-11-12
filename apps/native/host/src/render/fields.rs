//! Text fields: `<input>`, `<textarea>` and the native field over a DOM-backed editor.

use std::collections::HashMap;
use std::sync::Arc;

use rune::edit::TextEdit;
use rune::{El, row, text_input};

use crate::layout::{Inherit, apply_box, focus_styles};
use crate::wire::{Node, Style};

use super::Ctx;
use super::events::{
    dom_key, element_key_name, pastes_files, send, send_document_key, send_editable, send_key,
    send_paste,
};
use super::flow::style_of;
use super::handlers::focus_field_on_press;
use super::state::{Field, State};

pub(super) fn build_input(
    path: &str,
    tag: &str,
    st: &Style,
    attrs: &HashMap<String, String>,
    on: &HashMap<String, u32>,
    inh: Inherit,
    ctx: &Ctx,
) -> El {
    let single_line = tag == "input";
    let mut field = text_field(path, attrs, inh, ctx, 0.45);
    // An `<input>` is one line; a `<textarea>` keeps Rune's multi-line field.
    if single_line {
        field = field.single_line();
    }
    // A one-line field sits in the middle of its box, a textarea's text at its top.
    let wrapper = if single_line {
        row().items_center()
    } else {
        row().items_start()
    };
    let wrapper = apply_box(wrapper.key(path), st);
    // A disabled field shows its value but takes no edits, keys or submits, as in a browser.
    if attrs.contains_key("disabled") {
        return wrapper.child(field.opacity(0.6));
    }
    field = takes_edits(field, path);
    if let Some(&id) = on.get("input") {
        let key = path.to_string();
        field = field.on_input_change(move |s: &mut State, _| {
            if let Some(f) = s.fields.get_mut(&key) {
                f.last_sent = send(id, "input", Some(&f.edit.text))
            }
        });
    }
    // Return in an `<input>` submits its form; in a `<textarea>` it types a newline, as it does
    // in a browser.
    if single_line && let Some(form_id) = ctx.form {
        field = field.on_submit(move |_: &mut State, _| {
            send(form_id, "submit", None);
        });
    }
    // A field with its own keydown handler (a combo box) gets its navigation keys, and claims
    // the ones a browser listbox prevents: Return picks rather than submits, arrows move the
    // highlight rather than the caret. Rune's multi-line field submits on a plain Return (a chat
    // composer); a textarea breaks the line instead, so insert it here and report the edit as
    // typing would.
    let keydown = on.get("keydown").copied();
    let (key, input, is_textarea) = (path.to_string(), on.get("input").copied(), !single_line);
    let outer = ctx.keys.to_vec();
    if keydown.is_some() || is_textarea || !outer.is_empty() {
        field = field.on_input_key(move |s: &mut State, ev, _| {
            use rune::edit::Key;
            // The field's own handler, then the elements around it as the key bubbles.
            let name = dom_key(&ev.key);
            let chain: Vec<u32> = keydown.iter().chain(&outer).copied().collect();
            if let Some(name) = name.filter(|_| !chain.is_empty()) {
                send_key(&chain, name, ev.mods);
            } else if ev.mods.cmd || ev.mods.ctrl || ev.key == Key::Escape {
                // No handler around the field: a shortcut or Escape still reaches `document`.
                if let Some(name) = element_key_name(&ev.key) {
                    send_document_key(&name, ev.mods);
                }
            }
            // A field with its own handler (a combo box) claims what a listbox prevents; Escape
            // stops at an element around it (a popover closes). Return still submits a form.
            let claimed = keydown.is_some() && matches!(ev.key, Key::Enter | Key::Up | Key::Down);
            if name.is_some()
                && (claimed || ev.key == Key::Escape && (keydown.is_some() || !outer.is_empty()))
            {
                return true;
            }
            let plain = ev.mods == rune::edit::Mods::default();
            if !is_textarea || ev.key != Key::Enter || !plain {
                return false;
            }
            if let Some(f) = s.fields.get_mut(&key) {
                f.edit.insert("\n");
                if let Some(id) = input {
                    f.last_sent = send(id, "input", Some(&f.edit.text))
                }
            }
            true
        });
    }
    focus_styles(focus_field_on_press(wrapper, path), st, true).child(field)
}

/// A multi-line native field over a DOM-backed editor: Return submits, Shift+Return breaks a line.
pub(super) fn build_editable(
    path: &str,
    st: &Style,
    attrs: &HashMap<String, String>,
    children: &[Arc<Node>],
    inh: Inherit,
    ctx: &Ctx,
) -> El {
    // The editor root's own style (padding, text size, minimum height), sent as the one child.
    let field_st = children.first().and_then(|c| style_of(c));
    let inh = field_st.map_or(inh, |fst| inh.from(fst));
    let (change_key, submit_key) = (path.to_string(), path.to_string());
    // The editor's placeholder widget: the text colour at `opacity: 0.333`.
    let field = takes_edits(text_field(path, attrs, inh, ctx, 0.333), path)
        .on_input_change(move |s: &mut State, _| {
            if let Some(f) = s.fields.get_mut(&change_key) {
                let before = std::mem::replace(&mut f.shown, f.edit.text.clone());
                f.last_sent = send_editable(&change_key, Some(&f.edit.text), None, Some(&before))
            }
        })
        .on_submit(move |_: &mut State, _| {
            send_editable(&submit_key, None, Some("Enter"), None);
        })
        // Files and images attach to the composer, as a paste into the web editor does; text
        // stays the field's own paste.
        .on_input_paste(|_: &mut State, content, _| {
            pastes_files(content) && {
                send_paste(content);
                true
            }
        });
    let field = match field_st {
        Some(fst) => apply_box(
            row().items_start().grow(1.0).shrink(),
            &Style {
                w: None,
                h: None,
                ..fst.clone()
            },
        )
        .child(field),
        None => field,
    };
    focus_field_on_press(apply_box(row().items_center().key(path), st), path).child(field)
}

/// The Rune field drawing `path`'s editor as last edited, in the inherited text style, filling
/// its box; its placeholder is the text colour at `placeholder_alpha`.
fn text_field(
    path: &str,
    attrs: &HashMap<String, String>,
    inh: Inherit,
    ctx: &Ctx,
    placeholder_alpha: f32,
) -> El {
    let edit = ctx
        .s
        .fields
        .get(path)
        .map(|f| f.edit.clone())
        .unwrap_or_else(|| TextEdit::new(""));
    text_input(&edit, inh.style())
        .key(format!("{path}/field"))
        .grow(1.0)
        .shrink()
        .color(inh.color)
        .placeholder(
            attrs.get("placeholder").cloned().unwrap_or_default(),
            inh.color.alpha(placeholder_alpha),
        )
}

/// `field`'s edits change `path`'s editor in the host's state (created by the first one).
fn takes_edits(field: El, path: &str) -> El {
    let key = path.to_string();
    field.on_edit(rune::edit_access(move |s: &mut State| {
        &mut s
            .fields
            .entry(key.clone())
            .or_insert_with(|| Field::new(String::new()))
            .edit
    }))
}

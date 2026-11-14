//! Hazel's Foldkit app drawn with Rune: the runtime's wire tree as Rune elements, and the events,
//! layout and edits sent back to it. A shell (the macOS app in `main.rs`) runs the runtime and
//! installs where the messages go (`outbox::set_writer`).
pub mod fetch;
pub mod frames;
pub mod fx;
pub mod html;
pub mod images;
pub mod islands;
pub mod layout;
mod margins;
pub mod notify;
pub mod outbox;
mod render;
pub mod shell;
pub mod sign_in;
mod svg_text;
#[cfg(test)]
mod tests;
pub mod wire;

pub use render::*;

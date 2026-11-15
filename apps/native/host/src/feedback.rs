//! Haptic feedback (`web-foldkit/src/platform/feedback.ts`). A component marks the element whose
//! press means something (`data-native-feedback`); the press plays it here, as the finger lifts,
//! before the event reaches the runtime. Outcomes (a toast's kind) come from the runtime instead.
//! A shell with haptics installs the player (`set_player`); without one nothing plays.
use std::collections::HashMap;
use std::sync::OnceLock;

/// The attribute a component puts on the pressed element.
pub const ATTR: &str = "data-native-feedback";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Feedback {
    /// A discrete value changed.
    Selection,
    /// A deliberate commit with weight.
    Impact,
    Success,
    Warning,
    Error,
}

impl Feedback {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "selection" => Some(Self::Selection),
            "impact" => Some(Self::Impact),
            "success" => Some(Self::Success),
            "warning" => Some(Self::Warning),
            "error" => Some(Self::Error),
            _ => None,
        }
    }
}

static PLAYER: OnceLock<fn(Feedback)> = OnceLock::new();

/// Installs the shell's haptics; called once, on the main thread's side of the shell.
pub fn set_player(play: fn(Feedback)) {
    let _ = PLAYER.set(play);
}

/// Plays `kind`, where the shell has haptics.
pub fn play(kind: Feedback) {
    if let Some(play) = PLAYER.get() {
        play(kind);
    }
}

/// What a press on the element plays: its `data-native-feedback`, if it names a kind.
pub fn of(attrs: &HashMap<String, String>) -> Option<Feedback> {
    attrs.get(ATTR).and_then(|name| Feedback::parse(name))
}

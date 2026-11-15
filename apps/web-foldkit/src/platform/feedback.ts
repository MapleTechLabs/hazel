import type { Attribute, HtmlBuilder } from "foldkit/html"
import { systemUi } from "./system-ui"

/**
 * Haptic feedback, where the shell has it (the iOS app). The app never asks for a buzz; a
 * component plays the one its kind of interaction means, so features get it by using the
 * component:
 *
 * - `selection`: a discrete value changed (Switch, Checkbox, Radio, Tabs, ChoiceBox).
 * - `impact`: a deliberate commit with weight (a message sent).
 * - `success` / `warning` / `error`: how something turned out (a Toast of that kind).
 *
 * Plain buttons, links, navigation and typing play nothing; a menu that opens on a long press
 * plays the system's own. A browser and the desktop shells play nothing either.
 */
export type Feedback = "selection" | "impact" | "success" | "warning" | "error"

/** What a press itself means; an outcome comes later, from `playFeedback`. */
export type PressFeedback = Extract<Feedback, "selection" | "impact">

/**
 * Marks the pressed element: the native host plays it the moment the finger lifts, before the
 * press reaches the runtime (`apps/native/host/src/render/handlers.rs`). Put it on the element
 * that carries the press handler.
 */
export const pressFeedback = <Message>(h: HtmlBuilder<Message>, kind: PressFeedback): Attribute<Message> =>
	h.Attribute("data-native-feedback", kind)

/** Plays an outcome's feedback now: run it from a component's Command (a Toast of that kind). */
export const playFeedback = (kind: Feedback): void => systemUi()?.feedback(kind)

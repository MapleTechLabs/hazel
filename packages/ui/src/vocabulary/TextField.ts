/**
 * `hz:textField` (G5): a controlled single-line field. The Model holds a `State` (`{text, rev, edit}`);
 * the field owns the text while editing and applies `value` by the revision rule in `native/revisions.ts`.
 * The builder is `h.textField` (`spec.ts`); `textArea`, `searchField` and `composer` share this State.
 */
import { Schema } from "effect"

export const tag = "hz:textField"

/** What the Model keeps: its text, the highest field revision taken in, and its own edit count. */
export const State = Schema.Struct({ text: Schema.String, rev: Schema.Finite, edit: Schema.Finite })
export type State = typeof State.Type

/** `change` and `submit` payloads: the field's text at revision `rev`, over Model edit `edit`. */
export const ChangePayload = Schema.Struct({ value: Schema.String, rev: Schema.Finite, edit: Schema.Finite })
export type ChangePayload = typeof ChangePayload.Type

export const empty: State = { text: "", rev: 0, edit: 0 }

/** Whether a change or submit was made over the Model's latest edit (else the field will rebase it). */
export const current = (state: State, payload: ChangePayload): boolean => payload.edit === state.edit

/** The field's edit taken in; one typed over text the Model has since replaced is dropped. */
export const changed = (state: State, payload: ChangePayload): State =>
	current(state, payload) ? { text: payload.value, rev: payload.rev, edit: state.edit } : state

/** A Model edit (clear, transform): new text against the revision the Model has seen. */
export const set = (state: State, text: string): State =>
	text === state.text ? state : { text, rev: state.rev, edit: state.edit + 1 }

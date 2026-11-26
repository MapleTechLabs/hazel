// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `hz:textField` (G5): a controlled single-line field. The Model holds a `State` (`{text, rev, edit}`);
 * the field owns the text while editing and applies `value` by the revision rule in `native/revisions.ts`.
 */
import * as View from "@effect/ui/View"
import { Schema } from "effect"

export const tag = "hz:textField"

/** What the Model keeps: its text, the highest field revision taken in, and its own edit count. */
export const State = Schema.Struct({ text: Schema.String, rev: Schema.Finite, edit: Schema.Finite })
export type State = typeof State.Type

/** `change` and `submit` payloads: the field's text at revision `rev`, over Model edit `edit`. */
export interface ChangePayload {
	readonly value: string
	readonly rev: number
	readonly edit: number
}

export interface Events {
	readonly change: ChangePayload
	readonly submit: ChangePayload
}

export const empty: State = { text: "", rev: 0, edit: 0 }

/** Whether a change or submit was made over the Model's latest edit (else the field will rebase it). */
export const current = (state: State, payload: ChangePayload): boolean => payload.edit === state.edit

/** The field's edit taken in; one typed over text the Model has since replaced is dropped. */
export const changed = (state: State, payload: ChangePayload): State =>
	current(state, payload) ? { text: payload.value, rev: payload.rev, edit: state.edit } : state

/** A Model edit (clear, transform): new text against the revision the Model has seen. */
export const set = (state: State, text: string): State =>
	text === state.text ? state : { text, rev: state.rev, edit: state.edit + 1 }

const banned = (what: string) =>
	new Error(`hazel elements take no raw ${what}: use the vocabulary's typed props (docs/hazel-ui.md)`)

const merge = <B extends HzTextField<any>>(builder: B, props: Readonly<Record<string, unknown>>): B => {
	const next: Record<string, unknown> = { ...builder.props }
	for (const key in props) {
		const value = props[key]
		if (value === undefined) delete next[key]
		else next[key] = value
	}
	return View.withFields(builder, { props: next })
}

export class HzTextField<out Msg> extends View.ElementBuilder<Msg, never, Events, unknown, typeof tag> {
	override attr(_name: never, _value: never): this {
		throw banned("attributes")
	}
	override attrs(_attributes: never): this {
		throw banned("attributes")
	}
	override prop(_name: never, _value: never): this {
		throw banned("props")
	}

	label(label: string): this {
		return merge(this, { label })
	}
	placeholder(placeholder: string): this {
		return merge(this, { placeholder })
	}
	/** The Model's text and counters; crosses the wire as `value {text, rev, edit}`. */
	value(state: State): this {
		return merge(this, { value: { text: state.text, rev: state.rev, edit: state.edit } })
	}
	/** A message under the field; `undefined` clears it. */
	error(message: string | undefined): this {
		return merge(this, { error: message })
	}
}

export const builder: HzTextField<any> = new HzTextField(tag)

/**
 * Controlled text revisions (G5): the field that owns the text while editing (Swift's `HzTextField`,
 * the web's `hz:textField` input) runs this; `EffectUiSpike/HzTextField.swift` mirrors it line by line.
 *
 * Two counters: `rev` counts the field's own edits, `edit` counts the Model's edits (clear, transform).
 * - Field edit: `rev = n + 1`, `history[rev] = text`, send `change {value, rev, edit: e}` where `e` is
 *   the last Model edit the field applied. `submit` sends the same without incrementing.
 * - Model (`TextField.changed`): takes a change only if its `edit` equals the Model's own; an older one
 *   was typed over text the Model has since replaced, and the field answers that edit with a rebase.
 *   A Model edit (`TextField.set`) keeps `rev` and increments `edit`. It renders `value {text, rev, edit}`.
 * - Field, receiving `value {text, rev: r, edit: m}`:
 *   1. `m < e`, or `m == e` and `r < n`: stale (the Model has not caught up). Ignore it.
 *   2. `m == e` and `r >= n`: the Model has every local edit. Apply it (an echo is a no-op), `n = r`.
 *   3. `m > e` (a Model edit) and `r >= n`: apply it, `n = r`, `e = m`. The Model has it already.
 *   4. `m > e` and `r < n` (the user typed on): `e = m`, `n = n + 1`, send a change. If the local edits
 *      since `r` only appended (`history[n]` starts with `history[r]`), show `text + those characters`;
 *      otherwise the local text wins and is sent as is. No keystroke is dropped either way.
 * - History below the last received `r` is pruned: the Model's `rev` never goes back.
 */

export interface Incoming {
	readonly text: string
	readonly rev: number
	readonly edit: number
}

export interface Change {
	readonly value: string
	readonly rev: number
	readonly edit: number
}

export interface Field {
	readonly text: string
	readonly rev: number
	/** The last Model edit this field applied. */
	readonly edit: number
	/** Local revisions the Model may still answer: `history[rev]` is the text at that revision. */
	readonly history: ReadonlyMap<number, string>
}

export const initial: Field = { text: "", rev: 0, edit: 0, history: new Map([[0, ""]]) }

type Step = { readonly field: Field; readonly change?: Change }

/** A local edit: the next revision, and the change to send. A no-op edit sends nothing. */
export const edit = (field: Field, text: string): Step => {
	if (text === field.text) return { field }
	const rev = field.rev + 1
	const history = new Map(field.history).set(rev, text)
	return { field: { ...field, text, rev, history }, change: { value: text, rev, edit: field.edit } }
}

/** What `submit` sends: the text at the current revision. */
export const current = (field: Field): Change => ({ value: field.text, rev: field.rev, edit: field.edit })

/** A `value` from the Model: the field after it, and a change to send when it rebased. */
export const receive = (field: Field, incoming: Incoming): Step => {
	const { text, rev: r, edit: m } = incoming
	if (m < field.edit || (m === field.edit && r < field.rev)) return { field }
	if (r >= field.rev) return { field: { text, rev: r, edit: m, history: new Map([[r, text]]) } }
	// A Model edit against revision `r` while the user typed on.
	const history = new Map([...field.history].filter(([rev]) => rev >= r))
	const base = history.get(r)
	const merged = base !== undefined && field.text.startsWith(base) ? text + field.text.slice(base.length) : field.text
	const next = field.rev + 1
	history.set(next, merged)
	return {
		field: { text: merged, rev: next, edit: m, history },
		change: { value: merged, rev: next, edit: m },
	}
}

/** Reads a wire `value` prop: `{text, rev, edit}`, or nothing usable. */
export const decode = (value: unknown): Incoming | undefined => {
	if (typeof value !== "object" || value === null) return undefined
	const { text, rev, edit } = value as { text?: unknown; rev?: unknown; edit?: unknown }
	return typeof text === "string" && typeof rev === "number" && typeof edit === "number"
		? { text, rev, edit }
		: undefined
}

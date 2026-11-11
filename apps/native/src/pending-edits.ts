export type EditableEvent = {
	readonly value?: string | null
	readonly key?: string | null
	/** The field's text before this edit: the editor may have changed it since. */
	readonly before?: string | null
}

/**
 * Native field edits for an editor that has not mounted yet (the headless DOM loads after boot):
 * queued in order and replayed once `apply` accepts them, so text typed early is never dropped.
 */
export const makePendingEdits = (options: {
	/** Applies one edit; `false` while its editor is not mounted. */
	readonly apply: (path: string, event: EditableEvent) => boolean
	/** Every queued edit landed: the fields can take the editor's text again. */
	readonly onDrained: () => void
	readonly retryMs?: number
}) => {
	const queue: Array<{ readonly path: string; readonly event: EditableEvent }> = []
	let retry: ReturnType<typeof setInterval> | undefined
	const drain = () => {
		while (queue[0] !== undefined && options.apply(queue[0].path, queue[0].event)) queue.shift()
		if (queue.length > 0 || retry === undefined) return
		clearInterval(retry)
		retry = undefined
		options.onDrained()
	}
	return {
		/** Applies the edit now, or queues it behind earlier ones until its editor mounts. */
		push: (path: string, event: EditableEvent) => {
			if (queue.length === 0 && options.apply(path, event)) return
			queue.push({ path, event })
			retry ??= setInterval(drain, options.retryMs ?? 50)
		},
		/** The newest queued text for a field: what it shows until the editor has it. */
		queuedText: (path: string) =>
			queue.findLast((edit) => edit.path === path && edit.event.value != null)?.event.value ??
			undefined,
	}
}

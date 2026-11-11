/** A fake `~/lib/live-socket`: sockets open at once, send a snapshot and two text chunks. */
import { initialLiveState } from "@hazel/domain/live"
import type { LiveSocket } from "~/lib/live-socket"

export const live = {
	opened: [] as Array<string>,
	closed: [] as Array<string>,
	invalidated: [] as Array<string>,
	/** Opening throws. */
	broken: new Set<string>(),
	/** Closed with 4003 (not a viewer). */
	refused: new Set<string>(),
	/** Closed with 4001 on the first open only. */
	reauthOnce: new Set<string>(),
}

export const readAccessToken = async (): Promise<string | null | "unavailable"> => "token"

export const invalidateAccessToken = (token: string) => void live.invalidated.push(token)

export const openLiveSocket = (messageId: string, _channelId: string, _token: string): LiveSocket => {
	if (live.broken.has(messageId)) throw new Error("bad url")
	live.opened.push(messageId)
	const socket: LiveSocket = {
		onopen: null,
		onmessage: null,
		onclose: null,
		onerror: null,
		close: () => void live.closed.push(messageId),
	}
	const frame = (value: unknown) => socket.onmessage?.({ data: JSON.stringify(value) })
	setTimeout(() => {
		if (live.refused.has(messageId)) return socket.onclose?.({ code: 4003 })
		if (live.reauthOnce.delete(messageId)) return socket.onclose?.({ code: 4001 })
		socket.onopen?.()
		frame({ _tag: "Snapshot", state: initialLiveState })
		frame({ _tag: "TextAppended", chunk: "hi " })
		frame({ _tag: "TextAppended", chunk: messageId })
	}, 5)
	return socket
}

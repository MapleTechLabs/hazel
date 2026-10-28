/**
 * A message's live state socket: `<VITE_BACKEND_URL>/live/<messageId>?channelId=<id>`, the access
 * token offered as the second `Sec-WebSocket-Protocol` entry, as for the sync sockets. Tests
 * replace this module with a fake.
 */
import { SYNC_SUBPROTOCOL } from "@hazel/domain/sync"
import type { ChannelId, MessageId } from "@hazel/schema"

export { invalidateAccessToken, readAccessToken } from "~/lib/access-token"

/** The subset of the DOM `WebSocket` the live stream uses. */
export interface LiveSocket {
	onopen: (() => void) | null
	onmessage: ((event: { readonly data: unknown }) => void) | null
	onclose: ((event: { readonly code: number }) => void) | null
	onerror: (() => void) | null
	close(code?: number, reason?: string): void
}

const backendUrl = () => (import.meta.env.VITE_BACKEND_URL || "http://localhost:3003").replace(/\/+$/, "")

export const openLiveSocket = (messageId: MessageId, channelId: ChannelId, token: string): LiveSocket =>
	new WebSocket(
		`${backendUrl().replace(/^http/, "ws")}/live/${encodeURIComponent(messageId)}?channelId=${encodeURIComponent(channelId)}`,
		[SYNC_SUBPROTOCOL, token],
	) as unknown as LiveSocket

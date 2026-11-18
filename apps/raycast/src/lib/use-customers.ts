import { showToast, Toast } from "@raycast/api"
import { useEffect, useState } from "react"
import { accessToken, SignInRequiredError } from "./auth"
import { apiUrl } from "./config"
import {
	CloseCode,
	type CustomersState,
	EMPTY_STATE,
	loadState,
	openCustomersSync,
	saveState,
	type SyncSession,
} from "./sync"

export type SyncStatus = "connecting" | "live" | "offline" | "unavailable"

/** How long to wait before reconnecting after the network or the API dropped the socket. */
const RETRY_MS = 5_000

/**
 * The org's customers: the cached copy at once, then live from the sync socket while the command is
 * open. A 4001 refreshes the token and reconnects (once, if the fresh token is refused too); a
 * dropped socket reconnects after `RETRY_MS`.
 */
export const useCustomers = (organizationId: string | undefined) => {
	const api = apiUrl()
	const [state, setState] = useState<CustomersState>(EMPTY_STATE)
	const [status, setStatus] = useState<SyncStatus>("connecting")

	useEffect(() => {
		if (organizationId === undefined) return
		let session: SyncSession | undefined
		let retry: ReturnType<typeof setTimeout> | undefined
		let stopped = false
		let latest = loadState(api, organizationId)
		setState(latest)
		setStatus("connecting")

		const connect = async (forceRefresh: boolean) => {
			try {
				const token = await accessToken({ interactive: true, forceRefresh })
				if (stopped) return
				let ready = false
				session = openCustomersSync({
					api,
					organizationId,
					token,
					state: latest,
					onCommit: (next) => {
						latest = next
						saveState(api, organizationId, next)
						setState(next)
					},
					onReady: () => {
						ready = true
						setStatus("live")
					},
					onClose: (code) => {
						if (stopped) return
						// The token expired (or was refused): refresh once per attempt that never got going.
						if (code === CloseCode.Reauth && (ready || !forceRefresh)) return void connect(true)
						if (code === CloseCode.Forbidden || code === CloseCode.NotFound) {
							setStatus("unavailable")
							return
						}
						setStatus("offline")
						retry = setTimeout(() => void connect(false), RETRY_MS)
					},
				})
			} catch (error) {
				if (stopped) return
				setStatus("offline")
				await showToast({
					style: Toast.Style.Failure,
					title:
						error instanceof SignInRequiredError ? "Sign in to Hazel" : "Could not reach Hazel",
					message: error instanceof Error ? error.message : String(error),
				})
			}
		}
		void connect(false)

		return () => {
			stopped = true
			clearTimeout(retry)
			session?.close()
		}
	}, [api, organizationId])

	return { state, status }
}

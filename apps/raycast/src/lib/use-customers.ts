import { showToast, Toast } from "@raycast/api"
import { useCallback, useEffect, useRef, useState } from "react"
import { accessToken } from "./auth"
import { apiUrl } from "./config"
import type { Organization } from "./models"
import { CloseCode } from "./protocol"
import {
	type CustomersState,
	EMPTY_STATE,
	lastSyncedAt,
	loadState,
	SyncClosedError,
	syncOrganization,
} from "./sync"

/** An org synced this recently is not synced again on open (`syncNow` still does). */
const DEBOUNCE_MS = 5 * 60 * 1000

/**
 * The selected org's customers, from the cache at once. On open (and when the organizations
 * load), every org not synced within `DEBOUNCE_MS` catches up in the background, the selected one
 * first; `syncNow` catches them all up regardless. A refused token is refreshed once per org.
 */
export const useCustomers = (
	organizations: ReadonlyArray<Organization> | undefined,
	selectedId: string | undefined,
) => {
	const api = apiUrl()
	const [state, setState] = useState<CustomersState>(EMPTY_STATE)
	const [isSyncing, setIsSyncing] = useState(false)
	/** Orgs without a Customers area for this user (the stream refused them). */
	const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(new Set())
	const [syncedAt, setSyncedAt] = useState<number | undefined>(undefined)
	const selected = useRef(selectedId)
	selected.current = selectedId
	const running = useRef<AbortController | undefined>(undefined)

	useEffect(() => {
		if (selectedId === undefined) return
		setState(loadState(api, selectedId))
		setSyncedAt(lastSyncedAt(api, selectedId))
	}, [api, selectedId])

	const sync = useCallback(
		async (force: boolean) => {
			if (organizations === undefined || running.current !== undefined) return
			const now = Date.now()
			const due = organizations
				.filter((org) => force || now - (lastSyncedAt(api, org.id) ?? 0) >= DEBOUNCE_MS)
				.sort((a, b) => Number(b.id === selected.current) - Number(a.id === selected.current))
			if (due.length === 0) return
			const controller = new AbortController()
			running.current = controller
			setIsSyncing(true)
			const failures: Array<string> = []
			for (const organization of due) {
				const once = async (forceRefresh: boolean): Promise<CustomersState | null> => {
					try {
						return await syncOrganization({
							api,
							organizationId: organization.id,
							token: await accessToken({ forceRefresh }),
							signal: controller.signal,
							onCommit: (next) => {
								if (organization.id === selected.current) setState(next)
							},
						})
					} catch (error) {
						if (
							error instanceof SyncClosedError &&
							error.code === CloseCode.Reauth &&
							!forceRefresh
						)
							return once(true)
						throw error
					}
				}
				try {
					const result = await once(false)
					setUnavailable((current) => {
						const next = new Set(current)
						if (result === null) next.add(organization.id)
						else next.delete(organization.id)
						return next
					})
					if (organization.id === selected.current) setSyncedAt(lastSyncedAt(api, organization.id))
				} catch (error) {
					if (controller.signal.aborted) return
					failures.push(
						`${organization.name}: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}
			running.current = undefined
			setIsSyncing(false)
			if (failures.length > 0) {
				await showToast({
					style: Toast.Style.Failure,
					title: "Could not sync customers",
					message: failures.join("\n"),
				})
			}
		},
		[api, organizations],
	)

	const organizationIds = organizations?.map((org) => org.id).join(",")
	useEffect(() => {
		void sync(false)
	}, [organizationIds])
	useEffect(() => () => running.current?.abort(), [])

	return {
		state,
		isSyncing,
		isUnavailable: selectedId !== undefined && unavailable.has(selectedId),
		syncedAt,
		syncNow: () => sync(true),
	}
}

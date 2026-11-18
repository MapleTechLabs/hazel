import { showToast, Toast } from "@raycast/api"
import { useCallback, useEffect, useRef, useState } from "react"
import { accessToken, isSignedIn } from "./auth"
import { apiUrl } from "./config"
import type { Organization } from "./models"
import { CloseCode } from "./protocol"
import { catchUp, SyncClosedError } from "./catch-up"
import { call } from "./rpc"
import {
	clearSavedData,
	type CustomersState,
	customersStore,
	EMPTY_STATE,
	forgetOrganization,
	lastSyncedAt,
	loadOrganizations,
	loadState,
	saveOrganizations,
} from "./sync"

/** An org synced this recently is not synced again on open (`syncNow` still does). */
const DEBOUNCE_MS = 5 * 60 * 1000

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The user's organizations and the chosen one's customers, saved data first (only while signed
 * in: Raycast's own "Log out" leaves it behind, so it is dropped then).
 *
 * On open the organizations are listed again and every org not synced within `DEBOUNCE_MS` catches
 * up from Hazel's store, the chosen one first. `syncNow` lists and catches up every org regardless,
 * preempting a sync in progress. An org whose stream refuses the user loses its saved list.
 */
export const useCustomers = (chosenId: string | undefined) => {
	const api = apiUrl()
	const [organizations, setOrganizations] = useState<ReadonlyArray<Organization> | undefined>(undefined)
	const [state, setState] = useState<CustomersState>(EMPTY_STATE)
	const [isSyncing, setIsSyncing] = useState(true)
	const [syncedAt, setSyncedAt] = useState<number | undefined>(undefined)
	const [failure, setFailure] = useState<string | undefined>(undefined)
	/** Orgs without a Customers area for this user (their stream refused them). */
	const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(new Set())
	const organization = organizations?.find((org) => org.id === chosenId) ?? organizations?.[0]
	const selected = useRef(organization?.id)
	selected.current = organization?.id
	const running = useRef<AbortController | undefined>(undefined)

	useEffect(() => {
		if (organization === undefined) return
		setState(loadState(api, organization.id))
		setSyncedAt(lastSyncedAt(api, organization.id))
	}, [api, organization?.id])

	const syncOne = async (org: Organization, signal: AbortSignal, forceRefresh = false) => {
		try {
			const result = await catchUp({
				api,
				store: customersStore(api),
				organizationId: org.id,
				token: await accessToken({ forceRefresh }),
				signal,
				onCommit: (next) => {
					if (org.id === selected.current) setState(next)
				},
			})
			if (result === null) forgetOrganization(api, org.id)
			setUnavailable((current) => {
				const next = new Set(current)
				if (result === null) next.add(org.id)
				else next.delete(org.id)
				return next
			})
			if (org.id === selected.current) {
				setState(result ?? EMPTY_STATE)
				setSyncedAt(lastSyncedAt(api, org.id))
			}
		} catch (error) {
			// The token expired or was revoked: refresh it and try once more.
			if (error instanceof SyncClosedError && error.code === CloseCode.Reauth && !forceRefresh)
				return syncOne(org, signal, true)
			throw error
		}
	}

	const sync = useCallback(
		async (force: boolean) => {
			if (running.current !== undefined && !force) return
			running.current?.abort()
			const controller = new AbortController()
			running.current = controller
			setIsSyncing(true)
			setFailure(undefined)
			const failures: Array<string> = []
			try {
				const { organizations: listed } = await call<{ organizations: ReadonlyArray<Organization> }>(
					"customers.organizations",
					{},
				)
				if (controller.signal.aborted) return
				saveOrganizations(api, listed)
				setOrganizations(listed)
				const now = Date.now()
				const due = listed
					.filter((org) => force || now - (lastSyncedAt(api, org.id) ?? 0) >= DEBOUNCE_MS)
					.sort((a, b) => Number(b.id === selected.current) - Number(a.id === selected.current))
				for (const org of due) {
					try {
						await syncOne(org, controller.signal)
					} catch (error) {
						if (controller.signal.aborted) return
						failures.push(`${org.name}: ${errorText(error)}`)
					}
				}
			} catch (error) {
				if (controller.signal.aborted) return
				failures.push(errorText(error))
			} finally {
				if (running.current === controller) {
					running.current = undefined
					setIsSyncing(false)
				}
			}
			if (failures.length > 0) {
				setFailure(failures.join("\n"))
				await showToast({
					style: Toast.Style.Failure,
					title: "Could not sync customers",
					message: failures.join("\n"),
				})
			}
		},
		[api],
	)

	useEffect(() => {
		void (async () => {
			if (await isSignedIn()) setOrganizations(loadOrganizations(api))
			else clearSavedData()
			await sync(false)
		})()
		return () => running.current?.abort()
	}, [api])

	return {
		organizations,
		organization,
		state,
		isSyncing,
		syncedAt,
		failure,
		isUnavailable: organization !== undefined && unavailable.has(organization.id),
		syncNow: () => void sync(true),
	}
}

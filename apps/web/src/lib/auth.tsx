import { useAuth as useClerkAuth, useClerk } from "@clerk/react"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { HazelRpcClient } from "./services/common/rpc-atom-client"

interface LoginOptions {
	returnTo?: string
}

/**
 * Hazel DB user (internal UUID, membership, isOnboarded, etc.). Clerk owns
 * identity; this atom is our app-level user record on top of the Clerk JWT.
 */
export const userAtom = HazelRpcClient.query("user.me", void 0, {
	reactivityKeys: ["currentUser"],
})

export const restartWebLogin = (options?: LoginOptions) => {
	const redirectUrl =
		options?.returnTo || window.location.pathname + window.location.search + window.location.hash
	const params = new URLSearchParams({ redirect_url: redirectUrl })
	window.location.assign(`/sign-in?${params.toString()}`)
}

export function useAuth() {
	const clerk = useClerk()
	const { isLoaded: clerkLoaded, isSignedIn } = useClerkAuth({ treatPendingAsSignedOut: false })
	const userResult = useAtomValue(userAtom)

	const userLoading = userResult._tag === "Initial" || userResult.waiting
	const isLoading = !clerkLoaded || (isSignedIn === true && userLoading)

	return {
		user: AsyncResult.getOrElse(userResult, () => null),
		error: AsyncResult.error(userResult),
		isLoading,
		login: (options?: LoginOptions) => restartWebLogin(options),
		logout: (options?: { redirectTo?: string }) =>
			clerk.signOut({ redirectUrl: options?.redirectTo ?? "/" }),
	}
}

import { useAtomSet } from "@effect/atom-react"
import { type User } from "@hazel/domain/models"
import type { UserId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { Exit } from "effect"
import { useCallback } from "react"
import { toast } from "sonner"
import { updateUserAction } from "~/db/actions"
import { userCollection } from "~/db/collections"
import { useAuth } from "~/lib/auth"

/**
 * Hook for managing notification settings.
 * Uses optimistic updates via userCollection for instant UI feedback.
 */
export function useNotificationSettings() {
	const { user } = useAuth()

	// Read from userCollection (TanStack DB) - auto-updates on collection change
	const { data: userData } = useLiveQuery({
		query: (q) =>
			user?.id
				? q
						.from({ u: userCollection })
						.where(({ u }) => eq(u.id, user.id))
						.findOne()
				: null,
		queryKey: [user?.id],
	})

	// Get optimistic action setter
	const updateUser = useAtomSet(updateUserAction, { mode: "promiseExit" })

	// Derive values from userData (which updates optimistically)
	const doNotDisturb = userData?.settings?.doNotDisturb ?? false
	const quietHoursStart = userData?.settings?.quietHoursStart ?? "22:00"
	const quietHoursEnd = userData?.settings?.quietHoursEnd ?? "08:00"
	const showQuietHoursInStatus = userData?.settings?.showQuietHoursInStatus ?? true

	const setDoNotDisturb = useCallback(
		async (value: boolean) => {
			if (!user?.id) return
			const result = await updateUser({
				userId: user.id as UserId,
				settings: { ...userData?.settings, doNotDisturb: value },
			})
			if (!Exit.isSuccess(result)) {
				toast.error("Failed to update setting")
			}
		},
		[user?.id, userData?.settings, updateUser],
	)

	const setQuietHoursStart = useCallback(
		async (value: string) => {
			if (!user?.id) return
			const result = await updateUser({
				userId: user.id as UserId,
				settings: { ...userData?.settings, quietHoursStart: value as User.TimeString },
			})
			if (!Exit.isSuccess(result)) {
				toast.error("Failed to update setting")
			}
		},
		[user?.id, userData?.settings, updateUser],
	)

	const setQuietHoursEnd = useCallback(
		async (value: string) => {
			if (!user?.id) return
			const result = await updateUser({
				userId: user.id as UserId,
				settings: { ...userData?.settings, quietHoursEnd: value as User.TimeString },
			})
			if (!Exit.isSuccess(result)) {
				toast.error("Failed to update setting")
			}
		},
		[user?.id, userData?.settings, updateUser],
	)

	const setShowQuietHoursInStatus = useCallback(
		async (value: boolean) => {
			if (!user?.id) return
			const result = await updateUser({
				userId: user.id as UserId,
				settings: { ...userData?.settings, showQuietHoursInStatus: value },
			})
			if (!Exit.isSuccess(result)) {
				toast.error("Failed to update setting")
			}
		},
		[user?.id, userData?.settings, updateUser],
	)

	return {
		doNotDisturb,
		quietHoursStart,
		quietHoursEnd,
		showQuietHoursInStatus,

		setDoNotDisturb,
		setQuietHoursStart,
		setQuietHoursEnd,
		setShowQuietHoursInStatus,
	}
}

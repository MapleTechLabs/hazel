import type { ChannelMember, User } from "@hazel/domain/models"
import type { ChannelId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { useEffect, useRef, useState } from "react"
import { channelMemberCollection, typingIndicatorCollection, userCollection } from "~/db/collections"
import { useMountEffect } from "~/hooks/use-mount-effect"
import { useAuth } from "~/lib/auth"
import { pushTypingDiagnostics } from "~/lib/typing-diagnostics"

type TypingUser = {
	user: User.Type
	member: ChannelMember.Type
}

export type TypingUsers = TypingUser[]

interface UseTypingIndicatorsOptions {
	channelId: ChannelId
	staleThreshold?: number // Milliseconds after which indicators are considered stale
}

export function useTypingIndicators({ channelId, staleThreshold = 6000 }: UseTypingIndicatorsOptions) {
	const { user: currentUser } = useAuth()
	const [now, setNow] = useState(() => Date.now())
	const lastCollectionSnapshotRef = useRef<string | null>(null)

	const { data: typingIndicatorsData } = useLiveQuery({
		query: (q) =>
			q
				.from({ typing: typingIndicatorCollection })
				.where(({ typing }) => eq(typing.channelId, channelId))
				.orderBy(({ typing }) => typing.lastTyped, "desc")
				.limit(10),
		queryKey: [channelId],
	})

	const { data: channelMembersData } = useLiveQuery({
		query: (q) =>
			q
				.from({ member: channelMemberCollection })
				.where(({ member }) => eq(member.channelId, channelId))
				.orderBy(({ member }) => member.createdAt, "desc"),
		queryKey: [channelId],
	})

	const { data: usersData } = useLiveQuery({
		query: (q) => q.from({ user: userCollection }).orderBy(({ user }) => user.createdAt, "desc"),
		queryKey: [],
	})

	useMountEffect(() => {
		const interval = setInterval(() => {
			setNow(Date.now())
		}, 1000)

		return () => {
			clearInterval(interval)
		}
	})

	useEffect(() => {
		const emitCollectionSnapshot = () => {
			const snapshot = {
				status: typingIndicatorCollection.utils.status,
				isError: typingIndicatorCollection.utils.isError,
				errorCount: typingIndicatorCollection.utils.errorCount,
				lastError:
					typingIndicatorCollection.utils.lastError instanceof Error
						? typingIndicatorCollection.utils.lastError.message
						: null,
			}
			const snapshotKey = `${snapshot.status}|${snapshot.isError ? 1 : 0}|${snapshot.errorCount}|${snapshot.lastError ?? "none"}`
			if (snapshotKey === lastCollectionSnapshotRef.current) return

			lastCollectionSnapshotRef.current = snapshotKey
			pushTypingDiagnostics({
				kind: "collection_state",
				channelId,
				details: snapshot,
			})
		}

		emitCollectionSnapshot()
		const interval = setInterval(emitCollectionSnapshot, 2000)

		return () => {
			clearInterval(interval)
		}
	}, [channelId])

	// Calculate during render - React Compiler handles memoization
	const currentChannelMember = (() => {
		if (!currentUser?.id || !channelMembersData) return null
		return channelMembersData.find((m) => m.userId === currentUser.id)
	})()

	// Calculate during render - data updates trigger re-renders via live queries
	const typingUsers: TypingUsers = (() => {
		if (!typingIndicatorsData || !channelMembersData || !usersData) return []

		const threshold = now - staleThreshold

		return typingIndicatorsData
			.filter((indicator) => {
				// Filter out stale indicators
				if (indicator.lastTyped < threshold) return false
				// Filter out current user
				if (currentChannelMember && indicator.memberId === currentChannelMember.id) return false
				return true
			})
			.map((indicator) => {
				const member = channelMembersData.find((m) => m.id === indicator.memberId)
				if (!member) return null
				const user = usersData.find((u) => u.id === member.userId)
				if (!user) return null
				return { member, user }
			})
			.filter((tu) => tu !== null) as unknown as TypingUsers
	})()

	return {
		typingUsers,
		isAnyoneTyping: typingUsers.length > 0,
	}
}

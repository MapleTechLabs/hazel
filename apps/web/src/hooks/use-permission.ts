import { eq, useLiveQuery } from "@tanstack/react-db"
import { useMemo } from "react"
import { canPerform, RPC_SCOPE_MAP } from "@hazel/domain/scopes"
import type { RpcActionName } from "@hazel/domain/scopes"
import type { OrganizationMember } from "@hazel/domain/models"
import { organizationMemberCollection } from "~/db/collections"
import { useAuth } from "~/lib/auth"
import { useOrganization } from "./use-organization"

/**
 * Hook that provides permission checking for the current user
 * in the current organization.
 *
 * Provides role-based helpers (isAdmin, isOwner) and
 * scope-based `can()` for RPC action checks.
 *
 * @example
 * ```tsx
 * function SettingsPage() {
 *   const { isAdmin, isOwner, isLoading } = usePermission()
 *   return (
 *     <>
 *       {isAdmin && <AdminSection />}
 *       {isOwner && <DangerZone />}
 *       <Button isDisabled={!isAdmin || isLoading}>Save</Button>
 *     </>
 *   )
 * }
 * ```
 */
export function usePermission() {
	const { user, isLoading: isAuthLoading } = useAuth()
	const { organizationId } = useOrganization()

	const { data: member, isLoading: isMemberLoading } = useLiveQuery({
		query: (q) =>
			organizationId && user?.id
				? q
						.from({ m: organizationMemberCollection })
						.where(({ m }) => eq(m.organizationId, organizationId))
						.where(({ m }) => eq(m.userId, user.id))
						.findOne()
				: null,
		queryKey: [organizationId, user?.id],
	})

	const role = member?.role as OrganizationMember.OrganizationRole | undefined

	const isOwner = role === "owner"
	const isAdmin = role === "owner" || role === "admin"
	const isMember = role !== undefined

	const can = useMemo(() => {
		if (!role) {
			return (_action: RpcActionName) => false
		}
		return (action: RpcActionName) => canPerform(RPC_SCOPE_MAP, role, action)
	}, [role])

	return {
		role,
		isOwner,
		isAdmin,
		isMember,
		can,
		isLoading: isAuthLoading || isMemberLoading,
	}
}

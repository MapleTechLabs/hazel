import type { OrganizationId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { useNavigate } from "@tanstack/react-router"
import IconPlus from "~/components/icons/icon-plus"
import { organizationCollection, organizationMemberCollection } from "~/db/collections"
import { useOrganization } from "~/hooks/use-organization"
import { useAuth } from "~/lib/auth"
import { getOrganizationRoute } from "~/utils/organization-navigation"
import { Avatar } from "../ui/avatar"
import { MenuItem, MenuSection, MenuSeparator } from "../ui/menu"
import { SidebarLabel } from "../ui/sidebar"

interface SwitchServerMenuProps {
	onCreateOrganization: () => void
}

export const SwitchServerMenu = ({ onCreateOrganization }: SwitchServerMenuProps) => {
	const { user } = useAuth()
	const navigate = useNavigate()

	const { organizationId: currentOrgId } = useOrganization()

	const { data: userOrganizations } = useLiveQuery({
		query: (q) =>
			q
				.from({ member: organizationMemberCollection })
				.innerJoin({ org: organizationCollection }, ({ member, org }) =>
					eq(member.organizationId, org.id),
				)
				.where(({ member }) => eq(member.userId, user?.id || ""))
				.orderBy(({ member }) => member.createdAt, "asc"),
		queryKey: [user?.id],
	})

	const handleSelectionChange = (keys: "all" | Set<React.Key>) => {
		if (keys === "all" || keys.size === 0) return

		const selectedOrgId = Array.from(keys)[0] as OrganizationId
		if (selectedOrgId === currentOrgId) return // Already on this org

		const selectedOrg = userOrganizations?.find((row) => row.org.id === selectedOrgId)
		if (!selectedOrg) return

		const route = getOrganizationRoute(selectedOrg.org)
		navigate({ to: route.to, search: route.search })
	}

	return (
		<>
			<MenuSection
				items={userOrganizations}
				disallowEmptySelection
				selectionMode="single"
				selectedKeys={currentOrgId ? new Set([currentOrgId]) : undefined}
				onSelectionChange={handleSelectionChange}
			>
				{({ org }) => (
					<MenuItem id={org.id} textValue={org.name}>
						<Avatar size="xs" src={org.logoUrl} seed={org.name} alt={org.name} />
						<SidebarLabel>{org.name}</SidebarLabel>
					</MenuItem>
				)}
			</MenuSection>

			<MenuSeparator />

			<MenuItem id="create-server" textValue="Create server" onAction={onCreateOrganization}>
				<IconPlus data-slot="icon" />
				<SidebarLabel>Create server</SidebarLabel>
			</MenuItem>
		</>
	)
}

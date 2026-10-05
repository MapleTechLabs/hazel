import { eq, useLiveQuery } from "@tanstack/react-db"
import { useParams } from "@tanstack/react-router"
import { organizationCollection } from "~/db/collections"

/**
 * Hook to get the current organization from the route slug
 * Returns the full organization object and its ID
 *
 * @returns Organization data, ID, loading state, and slug from params
 */
export function useOrganization() {
	const params = useParams({ strict: false })
	const orgSlug = params.orgSlug as string

	const { data, isLoading } = useLiveQuery({
		query: (q) =>
			orgSlug
				? q
						.from({ org: organizationCollection })
						.where(({ org }) => eq(org.slug, orgSlug))
						.orderBy(({ org }) => org.createdAt, "asc")
						.findOne()
				: null,
		queryKey: [orgSlug],
	})

	return {
		organization: data,
		organizationId: data?.id,
		isLoading,
		slug: orgSlug,
	}
}

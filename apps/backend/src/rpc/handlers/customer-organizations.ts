/**
 * `customers.organizations` on the directory path (`rpc/routing.ts`): the caller's live
 * memberships (`membership_index`) with each organization's name and slug (`org_index`).
 */
import { CurrentUser, InternalServerError } from "@hazel/domain"
import { CustomerDirectoryRpcs } from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { Directory } from "../../services/directory"

export const CustomerDirectoryRpcLive = CustomerDirectoryRpcs.toLayer(
	Effect.gen(function* () {
		const directory = yield* Directory
		return {
			"customers.organizations": Effect.fn("Customers.organizations")(
				function* () {
					const user = yield* CurrentUser.Context
					const ids = yield* directory.organizationsOf(user.id)
					const rows = yield* Effect.forEach(ids, directory.org, { concurrency: "unbounded" })
					const organizations = rows
						.flatMap(Option.toArray)
						.filter((row) => row.deletedAt === null)
						.map((row) => ({ id: row.id, name: row.name, slug: row.slug }))
						.sort((a, b) => a.name.localeCompare(b.name))
					return { organizations }
				},
				Effect.catchTag("DatabaseError", (cause) =>
					Effect.fail(
						InternalServerError.withCause({ message: "Error listing organizations", cause }),
					),
				),
			),
		}
	}),
)

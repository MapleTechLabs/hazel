/**
 * `customers.chatAuthor.setSide` in the org's `OrgObject` (`rpc/routing.ts`): a member marks
 * someone as our team or the customer in the org's linked channels (`docs/customers/author-side.md`).
 * People only: bots and chat-sync shadows (machine users, members since first sight) are refused.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, InternalServerError, UnauthorizedError } from "@hazel/domain"
import { CustomerChatRpcs, CustomersNotFoundError } from "@hazel/domain/rpc"
import { CurrentBotScopes } from "@hazel/domain/scopes"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { setChatAuthorOverride } from "../../worker/objects/org/customer-chat"

const refuse = (detail: string) =>
	new UnauthorizedError({ message: "You cannot change who is a customer in this organization", detail })

export const CustomerChatRpcLive = CustomerChatRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		return {
			"customers.chatAuthor.setSide": ({ organizationId, userId, side }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const actor = yield* CurrentUser.Context
							if (
								Option.isSome(Option.flatten(yield* Effect.serviceOption(CurrentBotScopes)))
							) {
								return yield* refuse("Bots cannot change who is a customer")
							}
							const member = yield* db.first(
								SQLite.from(schema.organizationMembersTable)
									.innerJoin(schema.usersTable, "user", (member, user) =>
										user.id.eq(member.userId),
									)
									.select(($) => ({ userType: $.user.userType }))
									.where(($) => [
										$.organizationId.eq(organizationId),
										$.userId.eq(actor.id),
										$.deletedAt.isNull(),
									])
									.limit(1),
							)
							if (Option.isNone(member) || member.value.userType !== "user") {
								return yield* refuse("Not a member of the organization")
							}
							const author = yield* db.first(
								SQLite.from(schema.usersTable)
									.select("id")
									.where(($) => [$.id.eq(userId)])
									.limit(1),
							)
							if (Option.isNone(author)) {
								return yield* new CustomersNotFoundError({ entity: "author", id: userId })
							}
							yield* setChatAuthorOverride({ organizationId, userId, side, by: actor.id })
							return { transactionId: yield* generateTransactionId() }
						}),
					)
					.pipe(
						Effect.catchTags({
							DatabaseError: (cause) =>
								Effect.fail(
									InternalServerError.withCause({
										message: "Error setting the side",
										cause,
									}),
								),
							SchemaError: (cause) =>
								Effect.fail(
									InternalServerError.withCause({
										message: "Error setting the side",
										cause,
									}),
								),
						}),
						Effect.withSpan("Customers.chatAuthor.setSide", {
							attributes: { "customer_chat.side": side ?? "cleared" },
						}),
					),
		}
	}),
)

import { Repository, schema } from "@hazel/db"
import { PinnedMessage } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class PinnedMessageRepo extends Context.Service<PinnedMessageRepo>()("PinnedMessageRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.pinnedMessagesTable,
			{ insert: PinnedMessage.Insert, update: PinnedMessage.Update },
			{
				idColumn: "id",
				name: "PinnedMessage",
			},
		)

		return baseRepo
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

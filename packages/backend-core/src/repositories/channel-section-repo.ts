import { Repository, schema } from "@hazel/db"
import { ChannelSection } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class ChannelSectionRepo extends Context.Service<ChannelSectionRepo>()("ChannelSectionRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.channelSectionsTable,
			{ insert: ChannelSection.Insert, update: ChannelSection.Update },
			{
				idColumn: "id",
				name: "ChannelSection",
			},
		)

		return baseRepo
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

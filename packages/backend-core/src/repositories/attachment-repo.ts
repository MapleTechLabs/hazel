import { Repository, schema } from "@hazel/db"
import { Attachment } from "@hazel/domain/models"
import { Context, Effect, Layer } from "effect"

export class AttachmentRepo extends Context.Service<AttachmentRepo>()("AttachmentRepo", {
	make: Effect.gen(function* () {
		const baseRepo = yield* Repository.makeRepository(
			schema.attachmentsTable,
			{ insert: Attachment.Insert, update: Attachment.Update },
			{
				idColumn: "id",
				name: "Attachment",
			},
		)

		return baseRepo
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

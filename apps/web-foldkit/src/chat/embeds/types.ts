import type { Message } from "@hazel/domain/models"

/** Element type of `Message.Type["embeds"]`, as in `message-embeds.tsx`. */
export type EmbedType = NonNullable<Message.Type["embeds"]>[number]
export type EmbedBadge = NonNullable<EmbedType["badge"]>
export type EmbedField = NonNullable<EmbedType["fields"]>[number]

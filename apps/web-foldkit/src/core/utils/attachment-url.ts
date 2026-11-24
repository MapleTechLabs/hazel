import type { Attachment } from "@hazel/domain/models"
import { currentServer } from "../config/server"

const publicUrl = () => currentServer().cdn ?? "https://cdn.hazel.sh"

export const getAttachmentUrl = (attachment: Pick<Attachment.Type, "id" | "externalUrl">): string =>
	attachment.externalUrl?.trim() || `${publicUrl()}/${attachment.id}`

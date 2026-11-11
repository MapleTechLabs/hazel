import type { Attachment } from "@hazel/domain/models"

const FALLBACK_PUBLIC_URL = import.meta.env.VITE_R2_PUBLIC_URL || "https://cdn.hazel.sh"

export const getAttachmentUrl = (attachment: Pick<Attachment.Type, "id" | "externalUrl">): string =>
	attachment.externalUrl?.trim() || `${FALLBACK_PUBLIC_URL}/${attachment.id}`

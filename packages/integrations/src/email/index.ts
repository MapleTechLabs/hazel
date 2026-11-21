export { bareAddress, domainOf, type EmailAddress } from "./address.ts"
export { type EmailHeaders, isAutomaticEmail } from "./automatic.ts"
export { htmlToText } from "./html-to-text.ts"
export { formatMessageId, normalizeMessageId, parseMessageIdList, referencesChain } from "./message-id.ts"
export {
	escapeHtml,
	type OutboundAttachment,
	type OutboundEmailBody,
	type OutboundEmailInput,
	renderOutboundEmail,
	replySubject,
} from "./outbound.ts"
export { type EmailAttachment, headersOf, parseEmail, type ParsedEmail } from "./parse.ts"
export { stripQuotedReply } from "./quoted-reply.ts"

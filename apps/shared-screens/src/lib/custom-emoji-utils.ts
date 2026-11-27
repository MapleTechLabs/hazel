const CUSTOM_EMOJI_PREFIX = "custom:"

/** Format a shortcode name as a custom emoji key (adds "custom:" prefix) */
export function formatCustomEmojiKey(name: string): string {
	return `${CUSTOM_EMOJI_PREFIX}${name}`
}

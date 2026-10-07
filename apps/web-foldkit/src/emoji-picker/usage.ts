import { type Atom, AtomRegistry } from "effect/reactivity"
import type { EmojiUsage } from "~/atoms/emoji-atoms"

/** `useEmojiStats`: the persisted usage counts behind `topEmojisAtom`, written outside React. */

const registry = AtomRegistry.make()

export const trackEmojiUsage = (atom: Atom.Writable<EmojiUsage>, emoji: string): void => {
	const release = registry.mount(atom)
	registry.update(atom, (previous) => ({ ...previous, [emoji]: (previous[emoji] ?? 0) + 1 }))
	release()
}

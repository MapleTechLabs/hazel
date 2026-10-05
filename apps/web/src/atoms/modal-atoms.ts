import { Atom } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useCallback } from "react"

/**
 * Supported modal types in the application
 * Single source of truth - add new modals here
 */
const MODAL_TYPES = [
	"create-dm",
	"new-channel",
	"join-channel",
	"rename-channel",
	"change-role",
	"email-invite",
	"create-organization",
	"create-section",
	"command-palette",
	"delete-channel",
] as const

export type ModalType = (typeof MODAL_TYPES)[number]

/**
 * Modal state interface
 */
interface ModalState {
	type: ModalType
	isOpen: boolean
	metadata?: Record<string, unknown>
}

/**
 * Atom family for managing individual modal states
 * Each modal type gets its own isolated state
 */
export const modalAtomFamily = Atom.family((type: ModalType) =>
	Atom.make<ModalState>({
		type,
		isOpen: false,
		metadata: undefined,
	}).pipe(Atom.keepAlive),
)

/**
 * Derived atom that tracks all open modals
 * Useful for modal stacking and z-index management
 */
export const openModalsAtom = Atom.make((get) => {
	return MODAL_TYPES.map((type) => get(modalAtomFamily(type)))
		.filter((modal) => modal.isOpen)
		.map((modal) => modal.type)
}).pipe(Atom.keepAlive)

/**
 * React hook for modal state and actions
 * Use this in React components to properly trigger re-renders
 *
 * @example
 * const { isOpen, open, close } = useModal("new-channel")
 * <Button onPress={open}>Create Channel</Button>
 * <Modal isOpen={isOpen} onOpenChange={(open) => !open && close()}>...</Modal>
 */
export const useModal = (type: ModalType) => {
	const state = useAtomValue(modalAtomFamily(type))
	const setState = useAtomSet(modalAtomFamily(type))

	const open = useCallback(
		(metadata?: Record<string, unknown>) => {
			setState((prev) => ({ ...prev, isOpen: true, metadata }))
		},
		[setState],
	)

	const close = useCallback(() => {
		setState((prev) => ({ ...prev, isOpen: false, metadata: undefined }))
	}, [setState])

	return {
		isOpen: state.isOpen,
		metadata: state.metadata,
		open,
		close,
	}
}

import { useAtomSet } from "@effect/atom-react"
import { type Theme } from "@hazel/domain/models"
import type { UserId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { Exit } from "effect"
import { useCallback, useMemo } from "react"
import { toast } from "sonner"
import { updateUserAction } from "~/db/actions"
import { userCollection } from "~/db/collections"
import { useAuth } from "~/lib/auth"
import {
	BUILT_IN_PRESETS,
	getBuiltInPreset,
	getDefaultThemeCustomization,
	getDefaultUserThemeSettings,
} from "~/lib/theme/presets"

/**
 * Hook for managing theme settings.
 * Uses optimistic updates via userCollection for instant UI feedback.
 * Syncs with database for cross-device persistence.
 */
export function useThemeSettings() {
	const { user } = useAuth()

	// Read from userCollection (TanStack DB) - auto-updates on collection change
	const { data: userData } = useLiveQuery({
		query: (q) =>
			user?.id
				? q
						.from({ u: userCollection })
						.where(({ u }) => eq(u.id, user.id))
						.findOne()
				: null,
		queryKey: [user?.id],
	})

	// Get optimistic action setter
	const updateUser = useAtomSet(updateUserAction, { mode: "promiseExit" })

	// Derive theme settings from user data with defaults
	const themeSettings = useMemo<Theme.UserThemeSettings>(() => {
		if (!userData?.settings?.theme) {
			return getDefaultUserThemeSettings()
		}
		return userData.settings.theme
	}, [userData?.settings?.theme])

	// Get the active theme customization (from preset or custom)
	const activeTheme = useMemo<Theme.ThemeCustomization>(() => {
		// If using a custom theme, return it
		if (themeSettings.customTheme && !themeSettings.activePresetId) {
			return themeSettings.customTheme
		}

		// Look for active preset
		if (themeSettings.activePresetId) {
			// Check built-in presets first
			const builtInPreset = getBuiltInPreset(themeSettings.activePresetId)
			if (builtInPreset) {
				return builtInPreset.customization
			}

			// Check saved user presets
			const savedPreset = themeSettings.savedPresets?.find((p) => p.id === themeSettings.activePresetId)
			if (savedPreset) {
				return savedPreset.customization
			}
		}

		// Default fallback
		return getDefaultThemeCustomization()
	}, [themeSettings])

	// Helper to update theme settings
	const updateThemeSettings = useCallback(
		async (updates: Partial<Theme.UserThemeSettings>) => {
			if (!user?.id) return

			const newTheme: Theme.UserThemeSettings = {
				...themeSettings,
				...updates,
			}

			const result = await updateUser({
				userId: user.id as UserId,
				settings: { ...userData?.settings, theme: newTheme },
			})

			if (!Exit.isSuccess(result)) {
				toast.error("Failed to update theme settings")
			}
		},
		[user?.id, themeSettings, userData?.settings, updateUser],
	)

	// Set active preset
	const setActivePreset = useCallback(
		async (presetId: string) => {
			await updateThemeSettings({
				activePresetId: presetId,
				customTheme: null, // Clear custom theme when selecting a preset
			})
		},
		[updateThemeSettings],
	)

	// Set display mode
	const setMode = useCallback(
		async (mode: Theme.DisplayMode) => {
			await updateThemeSettings({ mode })
		},
		[updateThemeSettings],
	)

	// Set custom theme (clears active preset)
	const setCustomTheme = useCallback(
		async (customization: Theme.ThemeCustomization) => {
			await updateThemeSettings({
				activePresetId: null,
				customTheme: customization,
			})
		},
		[updateThemeSettings],
	)

	// Update a single customization property
	const updateCustomization = useCallback(
		async <K extends keyof Theme.ThemeCustomization>(key: K, value: Theme.ThemeCustomization[K]) => {
			const newCustomization: Theme.ThemeCustomization = {
				...activeTheme,
				[key]: value,
			}
			await setCustomTheme(newCustomization)
		},
		[activeTheme, setCustomTheme],
	)

	// Save current custom theme as a preset
	const saveAsPreset = useCallback(
		async (name: string, description?: string) => {
			if (!user?.id) return

			const newPreset: Theme.ThemePreset = {
				id: `custom-${Date.now()}`,
				name,
				description,
				isBuiltIn: false,
				customization: activeTheme,
			}

			const currentPresets = themeSettings.savedPresets || []

			await updateThemeSettings({
				activePresetId: newPreset.id,
				customTheme: null,
				savedPresets: [...currentPresets, newPreset],
			})
		},
		[user?.id, activeTheme, themeSettings.savedPresets, updateThemeSettings],
	)

	// Delete a saved preset
	const deletePreset = useCallback(
		async (presetId: string) => {
			const currentPresets = themeSettings.savedPresets || []
			const newPresets = currentPresets.filter((p) => p.id !== presetId)

			// If deleting the active preset, switch to default
			if (themeSettings.activePresetId === presetId) {
				await updateThemeSettings({
					savedPresets: newPresets,
					activePresetId: "default",
					customTheme: null,
				})
			} else {
				await updateThemeSettings({
					savedPresets: newPresets,
				})
			}
		},
		[themeSettings.savedPresets, themeSettings.activePresetId, updateThemeSettings],
	)

	// Get all available presets (built-in + saved)
	const allPresets = useMemo(() => {
		return [...BUILT_IN_PRESETS, ...(themeSettings.savedPresets || [])]
	}, [themeSettings.savedPresets])

	return {
		// State
		themeSettings,
		activeTheme,
		activePresetId: themeSettings.activePresetId,
		mode: themeSettings.mode,
		savedPresets: themeSettings.savedPresets || [],
		allPresets,

		// Actions
		setActivePreset,
		setMode,
		setCustomTheme,
		updateCustomization,
		saveAsPreset,
		deletePreset,
	}
}

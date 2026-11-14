import * as Onboarding from "./index"
import * as OnboardingSetupOrganization from "./setup-organization"

/** The onboarding pages: their own chunk, loaded with the first onboarding route (`../registry.ts`). */
export const pages = [Onboarding.page, OnboardingSetupOrganization.page]

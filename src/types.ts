export interface SmartTypographySettings {
	emDash: boolean;
	skipEnDash: boolean;
	ellipsis: boolean;
	fractions: boolean;
	comparisons: boolean;
	guillemets: boolean;
	openGuillemet: string;
	closeGuillemet: string;
	arrows: boolean;
	leftArrow: string;
	rightArrow: string;
	curlyQuotes: boolean;
	openDouble: string;
	closeDouble: string;
	openSingle: string;
	closeSingle: string;
}

export const DEFAULT_SMART_TYPOGRAPHY: SmartTypographySettings = {
	emDash: true,
	skipEnDash: false,
	ellipsis: true,
	fractions: true,
	comparisons: true,
	guillemets: true,
	openGuillemet: "«",
	closeGuillemet: "»",
	arrows: true,
	leftArrow: "←",
	rightArrow: "→",
	curlyQuotes: false,
	openDouble: "\u201C",
	closeDouble: "\u201D",
	openSingle: "\u2018",
	closeSingle: "\u2019",
};

export const HEADER_BUTTON_KEY_VERSION = 2;

export interface ObsilitiesSettings {
	readableLineWidth: number;
	fileExplorerIcons: boolean;
	folderColors: boolean;
	hideScrollbars: boolean;
	hidePropertiesHeader: boolean;
	hideExternalLinks: boolean;
	hideNewTabButton: boolean;
	hideTabList: boolean;
	hideVaultProfile: boolean;
	headerButtonKeyVersion: number;
	headerButtonOrder: string[];
	hiddenHeaderButtons: Record<string, boolean>;
	smartTypography: SmartTypographySettings;
}

export const DEFAULT_READABLE_LINE_WIDTH = 900;
export const DEFAULT_SETTINGS: ObsilitiesSettings = {
	readableLineWidth: DEFAULT_READABLE_LINE_WIDTH,
	fileExplorerIcons: true,
	folderColors: true,
	hideScrollbars: true,
	hidePropertiesHeader: true,
	hideExternalLinks: true,
	hideNewTabButton: true,
	hideTabList: true,
	hideVaultProfile: true,
	headerButtonKeyVersion: HEADER_BUTTON_KEY_VERSION,
	headerButtonOrder: [],
	hiddenHeaderButtons: {},
	smartTypography: { ...DEFAULT_SMART_TYPOGRAPHY },
};

export function pickKnownSettings(
	saved: Partial<ObsilitiesSettings> | null,
): Partial<ObsilitiesSettings> {
	if (!saved) return {};
	const known: Record<string, unknown> = {};
	for (const key of Object.keys(DEFAULT_SETTINGS)) {
		if (key in saved) known[key] = (saved as Record<string, unknown>)[key];
	}
	return known as Partial<ObsilitiesSettings>;
}

export function pickHiddenButtons(
	saved: Record<string, boolean> | undefined,
): Record<string, boolean> {
	const hidden: Record<string, boolean> = {};
	for (const [key, isHidden] of Object.entries(saved ?? {})) {
		if (key && isHidden === true) hidden[key] = true;
	}
	return hidden;
}

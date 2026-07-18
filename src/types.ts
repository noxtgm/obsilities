export interface SmartTypographySettings {
	curlyQuotes: boolean;
	emDash: boolean;
	ellipsis: boolean;
	arrows: boolean;
	guillemets: boolean;
	comparisons: boolean;
	fractions: boolean;
	skipEnDash: boolean;
	openSingle: string;
	closeSingle: string;
	openDouble: string;
	closeDouble: string;
	openGuillemet: string;
	closeGuillemet: string;
	leftArrow: string;
	rightArrow: string;
}

export const DEFAULT_SMART_TYPOGRAPHY: SmartTypographySettings = {
	curlyQuotes: false,
	emDash: true,
	ellipsis: true,
	arrows: true,
	guillemets: true,
	comparisons: true,
	fractions: true,
	skipEnDash: false,
	openSingle: "\u2018",
	closeSingle: "\u2019",
	openDouble: "\u201C",
	closeDouble: "\u201D",
	openGuillemet: "«",
	closeGuillemet: "»",
	leftArrow: "←",
	rightArrow: "→",
};

export interface ObsilitiesSettings {
	defaultGraphView: boolean;
	readableLineWidth: number;
	hideScrollbars: boolean;
	hideNewTabButton: boolean;
	hideVaultProfile: boolean;
	hidePropertiesHeader: boolean;
	hideExternalLinks: boolean;
	fileExplorerIcons: boolean;
	folderColors: boolean;
	hiddenHeaderButtons: Record<string, boolean>;
	headerButtonOrder: string[];
	smartTypography: SmartTypographySettings;
}

export const DEFAULT_READABLE_LINE_WIDTH = 900;
export const DEFAULT_SETTINGS: ObsilitiesSettings = {
	defaultGraphView: true,
	readableLineWidth: DEFAULT_READABLE_LINE_WIDTH,
	hideScrollbars: true,
	hideNewTabButton: true,
	hideVaultProfile: true,
	hidePropertiesHeader: true,
	hideExternalLinks: true,
	fileExplorerIcons: true,
	folderColors: false,
	hiddenHeaderButtons: {},
	headerButtonOrder: [],
	smartTypography: { ...DEFAULT_SMART_TYPOGRAPHY },
};

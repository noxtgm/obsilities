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
	defaultGraphView: boolean;
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
	defaultGraphView: true,
	headerButtonOrder: [],
	hiddenHeaderButtons: {},
	smartTypography: { ...DEFAULT_SMART_TYPOGRAPHY },
};

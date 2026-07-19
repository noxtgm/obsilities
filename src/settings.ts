import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsilitiesPlugin from "./main";
import type { SmartTypographySettings } from "./types";
import { DEFAULT_READABLE_LINE_WIDTH } from "./types";

export class ObsilitiesSettingTab extends PluginSettingTab {
	plugin: ObsilitiesPlugin;

	constructor(app: App, plugin: ObsilitiesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Visibility").setHeading();

		const settingsList = containerEl.createDiv({
			cls: "obsilities-settings-list",
		});

		// General settings
		new Setting(settingsList)
			.setName("Readable line length")
			.setDesc(
				"Width of the text column, in pixels. Only applies when 'Readable line length' is enabled in Obsidian's Appearance settings.",
			)
			.addSlider((slider) =>
				slider
					.setLimits(400, 1400, 10)
					.setValue(this.plugin.settings.readableLineWidth)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.readableLineWidth = value;
						await this.plugin.saveSettings();
						this.plugin.applyBodyClasses();
					}),
			)
			.addExtraButton((button) =>
				button
					.setIcon("rotate-ccw")
					.setTooltip("Restore default")
					.onClick(async () => {
						this.plugin.settings.readableLineWidth =
							DEFAULT_READABLE_LINE_WIDTH;
						await this.plugin.saveSettings();
						this.plugin.applyBodyClasses();
						this.display();
					}),
			);

		new Setting(settingsList)
			.setName("File explorer icons")
			.setDesc(
				"Replace folder collapse arrows with open/closed folder icons and show type-specific icons next to files in the file explorer.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.fileExplorerIcons)
					.onChange(async (value) => {
						this.plugin.settings.fileExplorerIcons = value;
						await this.plugin.saveSettings();
						this.plugin.applyBodyClasses();
					}),
			);

		new Setting(settingsList)
			.setName("Rainbow folder colors")
			.setDesc(
				"Give each top-level folder a distinct color from a rainbow gradient and cascade it to every nested folder and file.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.folderColors)
					.onChange(async (value) => {
						this.plugin.settings.folderColors = value;
						await this.plugin.saveSettings();
						this.plugin.applyBodyClasses();
						this.plugin.updateFolderColors();
					}),
			);

		new Setting(settingsList)
			.setName("Hide scrollbars")
			.setDesc(
				"Hide scrollbars throughout the app. Scrolling still works via mouse wheel, trackpad, or keyboard.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideScrollbars)
					.onChange(async (value) => {
						this.plugin.settings.hideScrollbars = value;
						await this.plugin.saveSettings();
						this.plugin.applyBodyClasses();
					}),
			);

		new Setting(settingsList)
			.setName("Hide properties header")
			.setDesc(
				"Hide the properties heading shown above a note's frontmatter.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hidePropertiesHeader)
					.onChange(async (value) => {
						this.plugin.settings.hidePropertiesHeader = value;
						await this.plugin.saveSettings();
						this.plugin.applyBodyClasses();
					}),
			);

		new Setting(settingsList)
			.setName("Hide external link icons")
			.setDesc(
				"Hide the arrow icon shown next to external links in notes.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideExternalLinks)
					.onChange(async (value) => {
						this.plugin.settings.hideExternalLinks = value;
						await this.plugin.saveSettings();
						this.plugin.applyBodyClasses();
					}),
			);

		// Desktop-only settings
		new Setting(settingsList)
			.setName("Hide new tab button (Desktop)")
			.setDesc("Hide the '+' new tab button in the tab header bar.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideNewTabButton)
					.onChange(async (value) => {
						this.plugin.settings.hideNewTabButton = value;
						await this.plugin.saveSettings();
						this.plugin.applyBodyClasses();
					}),
			);

		new Setting(settingsList)
			.setName("Hide tab list button (Desktop)")
			.setDesc(
				"Hide the button that opens the dropdown list of all open tabs in the tab header bar.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideTabList)
					.onChange(async (value) => {
						this.plugin.settings.hideTabList = value;
						await this.plugin.saveSettings();
						this.plugin.applyBodyClasses();
					}),
			);

		new Setting(settingsList)
			.setName("Hide vault profile (Desktop)")
			.setDesc("Hide the vault profile at the bottom of the side dock.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideVaultProfile)
					.onChange(async (value) => {
						this.plugin.settings.hideVaultProfile = value;
						await this.plugin.saveSettings();
						this.plugin.applyBodyClasses();
					}),
			);

		new Setting(settingsList)
			.setName("Default graph view (Desktop)")
			.setDesc(
				"When all tabs are closed, automatically open the graph view instead of showing an empty pane.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultGraphView)
					.onChange(async (value) => {
						this.plugin.settings.defaultGraphView = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Typography").setHeading();

		const st = this.plugin.settings.smartTypography;
		const stList = containerEl.createDiv({
			cls: "obsilities-settings-list",
		});

		new Setting(stList)
			.setName("Dashes")
			.setDesc(
				"Two dash (--) will be converted to en-dash (–), en-dash + dash to em-dash (—), and em-dash + dash to three dash (---).",
			)
			.addToggle((toggle) =>
				toggle.setValue(st.emDash).onChange(async (value) => {
					st.emDash = value;
					await this.plugin.saveSettings();
					this.toggleVisibility(skipEnDashEl, value);
				}),
			);
		const skipEnDashEl = stList.createDiv({
			cls: "obsilities-st-char-fields",
		});
		new Setting(skipEnDashEl)
			.setName("Skip en-dash")
			.setDesc(
				"Two dashes will be converted to an em-dash instead of an en-dash.",
			)
			.addToggle((toggle) =>
				toggle.setValue(st.skipEnDash).onChange(async (value) => {
					st.skipEnDash = value;
					await this.plugin.saveSettings();
				}),
			);
		this.toggleVisibility(skipEnDashEl, st.emDash);

		new Setting(stList)
			.setName("Ellipsis")
			.setDesc(
				"Three periods (...) will be converted to an ellipsis (…).",
			)
			.addToggle((toggle) =>
				toggle.setValue(st.ellipsis).onChange(async (value) => {
					st.ellipsis = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(stList)
			.setName("Fractions")
			.setDesc(
				"1/2, 1/3, 1/4, etc will be converted to half (½), one-third (⅓), one-quarter (¼), and other fraction symbols.",
			)
			.addToggle((toggle) =>
				toggle.setValue(st.fractions).onChange(async (value) => {
					st.fractions = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(stList)
			.setName("Comparisons")
			.setDesc(
				"<= will be converted to less than or equal to (≤), >= to greater than or equal to (≥), and /= to not equal to (≠).",
			)
			.addToggle((toggle) =>
				toggle.setValue(st.comparisons).onChange(async (value) => {
					st.comparisons = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(stList)
			.setName("Guillemets")
			.setDesc(
				"<< and >> will be converted to guillemet marks (« and »).",
			)
			.addToggle((toggle) =>
				toggle.setValue(st.guillemets).onChange(async (value) => {
					st.guillemets = value;
					await this.plugin.saveSettings();
					this.toggleVisibility(guillemetCharsEl, value);
				}),
			);
		const guillemetCharsEl = stList.createDiv({
			cls: "obsilities-st-char-fields",
		});
		this.addSingleCharText(
			guillemetCharsEl,
			"Open guillemet",
			() => st.openGuillemet,
			(v) => {
				st.openGuillemet = v;
			},
		);
		this.addSingleCharText(
			guillemetCharsEl,
			"Close guillemet",
			() => st.closeGuillemet,
			(v) => {
				st.closeGuillemet = v;
			},
		);
		this.toggleVisibility(guillemetCharsEl, st.guillemets);

		new Setting(stList)
			.setName("Arrows")
			.setDesc(
				"<- and -> will be converted to left and right arrows (← and →).",
			)
			.addToggle((toggle) =>
				toggle.setValue(st.arrows).onChange(async (value) => {
					st.arrows = value;
					await this.plugin.saveSettings();
					this.toggleVisibility(arrowCharsEl, value);
				}),
			);
		const arrowCharsEl = stList.createDiv({
			cls: "obsilities-st-char-fields",
		});
		this.addSingleCharText(
			arrowCharsEl,
			"Left arrow",
			() => st.leftArrow,
			(v) => {
				st.leftArrow = v;
			},
		);
		this.addSingleCharText(
			arrowCharsEl,
			"Right arrow",
			() => st.rightArrow,
			(v) => {
				st.rightArrow = v;
			},
		);
		this.toggleVisibility(arrowCharsEl, st.arrows);

		new Setting(stList)
			.setName("Curly quotes")
			.setDesc(
				"Double and single quotes will be converted to curly quotes (\"\" and '').",
			)
			.addToggle((toggle) =>
				toggle.setValue(st.curlyQuotes).onChange(async (value) => {
					st.curlyQuotes = value;
					await this.plugin.saveSettings();
					this.toggleVisibility(curlyQuotesCharsEl, value);
				}),
			);
		const curlyQuotesCharsEl = stList.createDiv({
			cls: "obsilities-st-char-fields",
		});
		this.addQuoteCharSettings(curlyQuotesCharsEl, st);
		this.toggleVisibility(curlyQuotesCharsEl, st.curlyQuotes);
	}

	private toggleVisibility(el: HTMLElement, show: boolean): void {
		if (show) el.show();
		else el.hide();
	}

	private addQuoteCharSettings(
		container: HTMLElement,
		st: SmartTypographySettings,
	): void {
		this.addSingleCharText(
			container,
			"Open double quote",
			() => st.openDouble,
			(v) => {
				st.openDouble = v;
			},
		);
		this.addSingleCharText(
			container,
			"Close double quote",
			() => st.closeDouble,
			(v) => {
				st.closeDouble = v;
			},
		);
		this.addSingleCharText(
			container,
			"Open single quote",
			() => st.openSingle,
			(v) => {
				st.openSingle = v;
			},
		);
		this.addSingleCharText(
			container,
			"Close single quote",
			() => st.closeSingle,
			(v) => {
				st.closeSingle = v;
			},
		);
	}

	private addSingleCharText(
		container: HTMLElement,
		name: string,
		get: () => string,
		set: (value: string) => void,
	): void {
		new Setting(container).setName(name).addText((text) =>
			text.setValue(get()).onChange(async (value) => {
				if (!value) return;
				if (value.length > 1) {
					text.setValue(value[0] ?? "");
					return;
				}
				set(value);
				await this.plugin.saveSettings();
			}),
		);
	}
}

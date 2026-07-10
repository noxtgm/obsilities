import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsilitiesPlugin from "./main";

export class ObsilitiesSettingTab extends PluginSettingTab {
	plugin: ObsilitiesPlugin;

	constructor(app: App, plugin: ObsilitiesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Settings").setHeading();

		const settingsList = containerEl.createDiv({
			cls: "obsilities-settings-list",
		});

		new Setting(settingsList)
			.setName("Default graph view (Desktop)")
			.setDesc(
				"When all tabs are closed, automatically open the graph view instead of showing an empty pane."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.defaultGraphView)
					.onChange(async (value) => {
						this.plugin.settings.defaultGraphView = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Smart typography").setHeading();

		const st = this.plugin.settings.smartTypography;
		const stList = containerEl.createDiv({
			cls: "obsilities-settings-list",
		});

		new Setting(stList)
			.setName("Dashes")
			.setDesc(
				"Two dash (--) will be converted to en-dash (–), en-dash + dash to em-dash (—), and em-dash + dash to three dash (---)."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(st.emDash)
					.onChange(async (value) => {
						st.emDash = value;
						await this.plugin.saveSettings();
						this.toggleVisibility(skipEnDashEl, value);
					})
			);
		const skipEnDashEl = stList.createDiv({
			cls: "obsilities-st-char-fields",
		});
		new Setting(skipEnDashEl)
			.setName("Skip en-dash")
			.setDesc(
				"Two dashes will be converted to an em-dash instead of an en-dash."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(st.skipEnDash)
					.onChange(async (value) => {
						st.skipEnDash = value;
						await this.plugin.saveSettings();
					})
			);
		this.toggleVisibility(skipEnDashEl, st.emDash);

		new Setting(stList)
			.setName("Ellipsis")
			.setDesc("Three periods (...) will be converted to an ellipsis (…).")
			.addToggle((toggle) =>
				toggle
					.setValue(st.ellipsis)
					.onChange(async (value) => {
						st.ellipsis = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(stList)
			.setName("Fractions")
			.setDesc(
				"1/2, 1/3, 1/4, etc. will be converted to half (½), one-third (⅓), one-quarter (¼), and other fraction symbols."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(st.fractions)
					.onChange(async (value) => {
						st.fractions = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(stList)
			.setName("Comparisons")
			.setDesc("<= will be converted to less than or equal to (≤), >= to greater than or equal to (≥), and /= to not equal to (≠).")
			.addToggle((toggle) =>
				toggle
					.setValue(st.comparisons)
					.onChange(async (value) => {
						st.comparisons = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(stList)
			.setName("Guillemets")
			.setDesc("<< and >> will be converted to guillemet marks (« and »).")
			.addToggle((toggle) =>
				toggle
					.setValue(st.guillemets)
					.onChange(async (value) => {
						st.guillemets = value;
						await this.plugin.saveSettings();
						this.toggleVisibility(guillemetCharsEl, value);
					})
			);
		const guillemetCharsEl = stList.createDiv({
			cls: "obsilities-st-char-fields",
		});
		new Setting(guillemetCharsEl)
			.setName("Open guillemet")
			.addText((text) =>
				text
					.setValue(st.openGuillemet)
					.onChange(async (value) => {
						if (!value) return;
						st.openGuillemet = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(guillemetCharsEl)
			.setName("Close guillemet")
			.addText((text) =>
				text
					.setValue(st.closeGuillemet)
					.onChange(async (value) => {
						if (!value) return;
						st.closeGuillemet = value;
						await this.plugin.saveSettings();
					})
			);
		this.toggleVisibility(guillemetCharsEl, st.guillemets);

		new Setting(stList)
			.setName("Arrows")
			.setDesc("<- and -> will be converted to left and right arrows (← and →).")
			.addToggle((toggle) =>
				toggle
					.setValue(st.arrows)
					.onChange(async (value) => {
						st.arrows = value;
						await this.plugin.saveSettings();
						this.toggleVisibility(arrowCharsEl, value);
					})
			);
		const arrowCharsEl = stList.createDiv({
			cls: "obsilities-st-char-fields",
		});
		new Setting(arrowCharsEl)
			.setName("Left arrow")
			.addText((text) =>
				text
					.setValue(st.leftArrow)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.leftArrow = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(arrowCharsEl)
			.setName("Right arrow")
			.addText((text) =>
				text
					.setValue(st.rightArrow)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.rightArrow = value;
						await this.plugin.saveSettings();
					})
			);
		this.toggleVisibility(arrowCharsEl, st.arrows);

		new Setting(stList)
			.setName("Curly quotes")
			.setDesc(
				'Double and single quotes will be converted to curly quotes ("" and \'\').'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(st.curlyQuotes)
					.onChange(async (value) => {
						st.curlyQuotes = value;
						await this.plugin.saveSettings();
						this.toggleVisibility(curlyQuotesCharsEl, value);
					})
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
		st: import("./types").SmartTypographySettings
	): void {
		new Setting(container)
			.setName("Open double quote")
			.addText((text) =>
				text
					.setValue(st.openDouble)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.openDouble = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(container)
			.setName("Close double quote")
			.addText((text) =>
				text
					.setValue(st.closeDouble)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.closeDouble = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(container)
			.setName("Open single quote")
			.addText((text) =>
				text
					.setValue(st.openSingle)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.openSingle = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(container)
			.setName("Close single quote")
			.addText((text) =>
				text
					.setValue(st.closeSingle)
					.onChange(async (value) => {
						if (!value) return;
						if (value.length > 1) {
							text.setValue(value[0] ?? "");
							return;
						}
						st.closeSingle = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

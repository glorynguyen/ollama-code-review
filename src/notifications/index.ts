/**
 * F-018: Notification Integrations (Slack / Microsoft Teams / Discord)
 *
 * Posts review summaries to configured webhook URLs when reviews complete.
 * Uses existing Axios dependency — no new packages required.
 */

import axios from 'axios';
import * as vscode from 'vscode';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FindingCounts {
	critical: number;
	high: number;
	medium: number;
	low: number;
	info: number;
}

export interface NotificationPayload {
	reviewText: string;
	model: string;
	profile?: string;
	score?: number;
	findingCounts?: FindingCounts;
	repoName?: string;
	branch?: string;
	/** Display label (file path, folder, or branch name) */
	label?: string;
}

export interface NotificationConfig {
	slack: { webhookUrl: string };
	teams: { webhookUrl: string };
	discord: { webhookUrl: string };
	/** Severity levels that trigger a notification. Empty = always notify. */
	triggerOn: string[];
}

// ─── Config ──────────────────────────────────────────────────────────────────

export function getNotificationConfig(): NotificationConfig {
	const cfg = vscode.workspace.getConfiguration('ollama-code-review');
	return {
		slack:   { webhookUrl: cfg.get<string>('notifications.slack.webhookUrl', '') },
		teams:   { webhookUrl: cfg.get<string>('notifications.teams.webhookUrl', '') },
		discord: { webhookUrl: cfg.get<string>('notifications.discord.webhookUrl', '') },
		triggerOn: cfg.get<string[]>('notifications.triggerOn', ['critical', 'high']),
	};
}

function isConfigured(cfg: NotificationConfig): boolean {
	return !!(cfg.slack.webhookUrl || cfg.teams.webhookUrl || cfg.discord.webhookUrl);
}

// ─── Gate ────────────────────────────────────────────────────────────────────

function shouldNotify(payload: NotificationPayload, triggerOn: string[]): boolean {
	if (triggerOn.length === 0) { return true; }
	const c = payload.findingCounts;
	if (!c) { return true; } // No counts — always notify
	return (
		(triggerOn.includes('critical') && c.critical > 0) ||
		(triggerOn.includes('high')     && c.high     > 0) ||
		(triggerOn.includes('medium')   && c.medium   > 0) ||
		(triggerOn.includes('low')      && c.low      > 0)
	);
}

// ─── Payload builders ────────────────────────────────────────────────────────

function sourceLabel(payload: NotificationPayload): string {
	return payload.label || payload.branch || payload.repoName || 'unknown';
}

function findingsSummary(c: FindingCounts | undefined): string {
	if (!c) { return 'Review complete'; }
	const parts: string[] = [];
	if (c.critical > 0) { parts.push(`🔴 ${c.critical} Critical`); }
	if (c.high     > 0) { parts.push(`🟠 ${c.high} High`); }
	if (c.medium   > 0) { parts.push(`🟡 ${c.medium} Medium`); }
	if (c.low      > 0) { parts.push(`🟢 ${c.low} Low`); }
	return parts.length ? parts.join(', ') : 'No significant findings';
}

function scoreText(score: number | undefined): string {
	return score !== undefined ? ` — Score: ${score}/100` : '';
}

function themeColor(score: number | undefined): string {
	if (score === undefined) { return '0072C6'; }
	return score < 60 ? 'FF0000' : score < 80 ? 'FFA500' : '00AA00';
}

function discordColor(score: number | undefined): number {
	if (score === undefined) { return 0x0072C6; }
	return score < 60 ? 0xFF4444 : score < 80 ? 0xFFA500 : 0x00AA00;
}

/** Slack Block Kit payload */
function buildSlackPayload(payload: NotificationPayload): object {
	const src = sourceLabel(payload);
	const scoreStr = scoreText(payload.score);
	const fields: { type: string; text: string }[] = [
		{ type: 'mrkdwn', text: `*Source:*\n${src}` },
		{ type: 'mrkdwn', text: `*Model:*\n${payload.model}` },
	];
	if (payload.profile) {
		fields.push({ type: 'mrkdwn', text: `*Profile:*\n${payload.profile}` });
	}
	if (payload.score !== undefined) {
		fields.push({ type: 'mrkdwn', text: `*Score:*\n${payload.score}/100` });
	}
	return {
		text: `Ollama Code Review — \`${src}\`${scoreStr}`,
		blocks: [
			{
				type: 'header',
				text: { type: 'plain_text', text: `Ollama Code Review${scoreStr}`, emoji: true },
			},
			{ type: 'section', fields },
			{
				type: 'section',
				text: { type: 'mrkdwn', text: `*Findings:* ${findingsSummary(payload.findingCounts)}` },
			},
		],
	};
}

/** Microsoft Teams Adaptive Card (MessageCard v1) */
function buildTeamsPayload(payload: NotificationPayload): object {
	const src = sourceLabel(payload);
	const c = payload.findingCounts;
	const facts: { title: string; value: string }[] = [
		{ title: 'Source', value: src },
		{ title: 'Model',  value: payload.model },
	];
	if (payload.profile)           { facts.push({ title: 'Profile',  value: payload.profile }); }
	if (payload.score !== undefined){ facts.push({ title: 'Score',    value: `${payload.score}/100` }); }
	if (c) {
		if (c.critical > 0) { facts.push({ title: 'Critical', value: String(c.critical) }); }
		if (c.high     > 0) { facts.push({ title: 'High',     value: String(c.high) }); }
		if (c.medium   > 0) { facts.push({ title: 'Medium',   value: String(c.medium) }); }
		if (c.low      > 0) { facts.push({ title: 'Low',      value: String(c.low) }); }
	}
	return {
		'@type': 'MessageCard',
		'@context': 'https://schema.org/extensions',
		themeColor: themeColor(payload.score),
		summary: `Ollama Code Review — ${src}`,
		sections: [{ activityTitle: 'Ollama Code Review', activitySubtitle: src, facts }],
	};
}

/** Discord webhook payload */
function buildDiscordPayload(payload: NotificationPayload): object {
	const src = sourceLabel(payload);
	const c = payload.findingCounts;
	const fields: { name: string; value: string; inline: boolean }[] = [
		{ name: 'Source', value: src, inline: true },
		{ name: 'Model',  value: payload.model, inline: true },
	];
	if (payload.profile)           { fields.push({ name: 'Profile', value: payload.profile, inline: true }); }
	if (payload.score !== undefined){ fields.push({ name: 'Score',   value: `${payload.score}/100`, inline: true }); }
	if (c) {
		const parts: string[] = [];
		if (c.critical > 0) { parts.push(`🔴 ${c.critical} Critical`); }
		if (c.high     > 0) { parts.push(`🟠 ${c.high} High`); }
		if (c.medium   > 0) { parts.push(`🟡 ${c.medium} Medium`); }
		if (c.low      > 0) { parts.push(`🟢 ${c.low} Low`); }
		if (parts.length > 0) {
			fields.push({ name: 'Findings', value: parts.join('\n'), inline: false });
		}
	}
	return {
		embeds: [{
			title: 'Ollama Code Review',
			color: discordColor(payload.score),
			fields,
		}],
	};
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Send review notifications to all configured webhook destinations.
 * Failures are logged to the output channel but do not interrupt the review flow.
 */
export async function sendNotifications(
	payload: NotificationPayload,
	outputChannel?: vscode.OutputChannel,
): Promise<void> {
	const cfg = getNotificationConfig();

	// Skip entirely if nothing configured
	if (!isConfigured(cfg)) { return; }

	// Apply triggerOn filter
	if (!shouldNotify(payload, cfg.triggerOn)) {
		outputChannel?.appendLine('[Notifications] Skipped — no findings above trigger threshold.');
		return;
	}

	const tasks: Promise<void>[] = [];

	if (cfg.slack.webhookUrl) {
		tasks.push(
			axios.post(cfg.slack.webhookUrl, buildSlackPayload(payload), {
				headers: { 'Content-Type': 'application/json' },
				timeout: 10_000,
			})
				.then(() => { outputChannel?.appendLine('[Notifications] Slack message sent.'); })
				.catch(err => { outputChannel?.appendLine(`[Notifications] Slack error: ${err.message}`); }),
		);
	}

	if (cfg.teams.webhookUrl) {
		tasks.push(
			axios.post(cfg.teams.webhookUrl, buildTeamsPayload(payload), {
				headers: { 'Content-Type': 'application/json' },
				timeout: 10_000,
			})
				.then(() => { outputChannel?.appendLine('[Notifications] Teams message sent.'); })
				.catch(err => { outputChannel?.appendLine(`[Notifications] Teams error: ${err.message}`); }),
		);
	}

	if (cfg.discord.webhookUrl) {
		tasks.push(
			axios.post(cfg.discord.webhookUrl, buildDiscordPayload(payload), {
				headers: { 'Content-Type': 'application/json' },
				timeout: 10_000,
			})
				.then(() => { outputChannel?.appendLine('[Notifications] Discord message sent.'); })
				.catch(err => { outputChannel?.appendLine(`[Notifications] Discord error: ${err.message}`); }),
		);
	}

	await Promise.allSettled(tasks);
}

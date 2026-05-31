/**
 * Time formatting helpers.
 */

/**
 * Format a timestamp as a short, human-friendly relative-time label.
 *
 * Examples: "just now", "5m ago", "2h ago", "3d ago".
 *
 * @param timestampMs Epoch milliseconds of the past event.
 * @param nowMs       Current epoch milliseconds (defaults to `Date.now()`; injectable for tests).
 * @returns A relative-time string. Future timestamps are reported as "just now".
 */
export function formatRelativeTime(timestampMs: number, nowMs: number = Date.now()): string {
	if (!Number.isFinite(timestampMs)) {
		return 'unknown';
	}

	const diffMs = nowMs - timestampMs;

	// Clamp small negatives (clock skew / future timestamps) to "just now".
	if (diffMs < 45_000) {
		return 'just now';
	}

	const minutes = Math.round(diffMs / 60_000);
	if (minutes < 60) {
		return `${minutes}m ago`;
	}

	const hours = Math.round(diffMs / 3_600_000);
	if (hours < 24) {
		return `${hours}h ago`;
	}

	const days = Math.round(diffMs / 86_400_000);
	return `${days}d ago`;
}

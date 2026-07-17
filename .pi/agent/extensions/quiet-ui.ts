import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const MARK = "🕵️";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setHiddenThinkingLabel(".");
		ctx.ui.setWorkingIndicator({ frames: ["-", "\\", "|", "/"], intervalMs: 120 });

		ctx.ui.setHeader((_tui, _theme) => ({
			invalidate() {},
			render() {
				return [];
			},
		}));

		ctx.ui.setFooter((_tui, theme) => ({
			invalidate() {},
			render(width: number) {
				return [truncateToWidth(theme.fg("accent", MARK), width)];
			},
		}));
	});
}

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * Telegram channel bridge for OMP.
 *
 * The Telegram MCP server (claude-plugins-official/telegram) pushes inbound
 * messages as JSON-RPC notifications with method `notifications/claude/channel`.
 * OMP delivers every server notification to the `mcp_notification` extension
 * event, but it does NOT automatically inject those into the agent turn.
 *
 * This extension closes that gap: it forwards each inbound Telegram message
 * into the session as a user prompt, so a DM to the bot behaves exactly like a
 * message typed in the OMP terminal.
 *
 * NOTE: OMP sets `event.server` to the MCP `server:tool` form — observed as
 * `"telegram:telegram"` (the same value as the `path: "mcp:telegram:telegram"`
 * in OMP logs). So the server match must accept the bare name, the
 * `server:tool` form, or a `:telegram` suffix.
 */

type ChannelNotification = {
  content?: unknown;
  meta?: Record<string, unknown>;
};

const DEFAULT_SERVER = "telegram";
const CHANNEL_METHOD = "notifications/claude/channel";

/** Server names to listen on. Override with `TELEGRAM_BRIDGE_SERVER` (comma-separated). */
function resolveServerNames(): string[] {
  const fromEnv = process.env.TELEGRAM_BRIDGE_SERVER;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [DEFAULT_SERVER];
}

/**
 * OMP reports `event.server` in `server:tool` form (e.g. `telegram:telegram`),
 * so a name matches when it is exactly the server, equals `name:name`, or the
 * value ends with `:<name>`.
 */
function serverMatches(server: string, names: string[]): boolean {
  return names.some((n) => server === n || server === `${n}:${n}` || server.endsWith(`:${n}`));
}

function formatAttachment(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  const kind = meta.attachment_kind;
  const name = meta.attachment_name;
  const fileId = meta.attachment_file_id;
  if (kind) {
    const label = name ? `${kind}: ${name}` : kind;
    parts.push(`[첨부 ${label}${fileId ? ` (file_id=${fileId})` : ""}]`);
  }
  if (meta.image_path && typeof meta.image_path === "string") {
    parts.push(`[이미지: ${meta.image_path}]`);
  }
  return parts.join(" ");
}

export default function telegramChannelBridge(pi: ExtensionAPI): void {
  const servers = resolveServerNames();

  pi.logger.info(`[telegram-bridge] loaded; listening on servers: ${servers.join(", ")}`);

  pi.on("mcp_notification", (event) => {
    if (!serverMatches(event.server, servers)) {
      pi.logger.debug(
        `[telegram-bridge] ignore notification server=${JSON.stringify(event.server)} method=${JSON.stringify(event.method)}`,
      );
      return;
    }
    if (event.method !== CHANNEL_METHOD) return;

    const params = (event.params ?? {}) as ChannelNotification;
    const text = typeof params.content === "string" ? params.content : "";
    const meta = params.meta ?? {};

    const user =
      typeof meta.user === "string" && meta.user
        ? meta.user
        : typeof meta.user_id === "string"
          ? meta.user_id
          : "telegram";
    const chatId = typeof meta.chat_id === "string" ? meta.chat_id : "";
    const ts = typeof meta.ts === "string" ? meta.ts : "";

    // Skip empty payloads (e.g. reactions-only or malformed frames).
    const attachmentNote = formatAttachment(meta);
    const body = [text.trim(), attachmentNote].filter(Boolean).join(" ").trim();
    if (!body) return;

    // Compact provenance prefix. The agent already holds reply/react/edit
    // tools, so it only needs the sender and the text.
    const stamp = ts ? ` ${ts}` : "";
    const prompt = chatId
      ? `[Telegram @${user} (chat ${chatId})${stamp}] ${body}`
      : `[Telegram @${user}${stamp}] ${body}`;

    // Omit deliverAs so the documented semantics apply: "idle starts a turn;
    // streaming queues as steer unless deliverAs is set". Passing
    // deliverAs:"steer" would force steer even when idle, which can fail to
    // start a fresh turn after a session was aborted or left idle.
    pi.logger.info(`[telegram-bridge] forwarding message from @${user}: ${body.slice(0, 80)}`);
    pi.sendUserMessage(prompt);
  });
}
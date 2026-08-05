# OMP Telegram Bridge

Forwards inbound Telegram messages into your [OMP](https://github.com/can1357/oh-my-pi) session automatically.

A DM to your bot lands in the agent turn as if you had typed it in the terminal — no copy-pasting, no hooks.

*[한국어 README](README.ko.md)*

## Why this exists

OMP receives `notifications/claude/channel` notifications from the Telegram MCP server, but it does **not** inject them into the session. So messages sent to the bot never reach the agent, and you end up pasting them in by hand.

This extension closes that gap using OMP's `mcp_notification` extension event:

```
Telegram DM → Telegram MCP server → notifications/claude/channel
  → OMP mcp_notification event → pi.sendUserMessage() → agent turn starts
```

Two real-world gotchas are handled in the code (both hit us in practice):

- **`event.server` is reported in MCP `server:tool` form** — OMP sets it to `telegram:telegram`, not `telegram`. The bridge matches the bare name, the `name:name` form, or any `:<name>` suffix.
- **`deliverAs` is omitted** — `pi.sendUserMessage` starts a turn when idle and queues as a steer only while streaming *when `deliverAs` is unset*. Passing `deliverAs: "steer"` forces steer even when idle, which fails to start a fresh turn after a session was aborted or left idle. Omit it so an idle session reliably starts a turn.

## Install

### 1. Set up the Telegram MCP server (prerequisite)

Add the server to `~/.omp/agent/mcp.json`. Telegram allows exactly one `getUpdates` consumer per bot token, so if OMP and Claude Code share a token they will fight over the connection (409 Conflict) and repeatedly kill each other's poller. **Use a dedicated bot for OMP.**

```json
{
  "mcpServers": {
    "telegram": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "--silent", "start"],
      "cwd": "/Users/<you>/.claude/plugins/cache/claude-plugins-official/telegram/0.0.6",
      "env": {
        "TELEGRAM_BOT_TOKEN": "<bot token>",
        "TELEGRAM_STATE_DIR": "/Users/<you>/.omp-telegram"
      },
      "timeout": 60000
    }
  }
}
```

> **Windows paths**: escape the backslashes, since this is JSON — `"cwd": "C:\\Users\\<you>\\.claude\\plugins\\cache\\claude-plugins-official\\telegram\\0.0.6"`
>
> **Version folder**: the `0.0.6` above is the installed Telegram plugin version. Check the actual folder name — it changes when the plugin updates.

- **Bot token**: create one with [@BotFather](https://t.me/BotFather). Use a *different* bot than the one Claude Code uses.
- **`TELEGRAM_STATE_DIR`**: where this bot's state lives (`access.json`, inbox). Keep it separate from Claude Code's.

### 2. Install the plugin

```bash
# Add the repository as a marketplace
omp plugin marketplace add TomLeeLive/omp-telegram-plugin

# Install (user scope)
omp plugin install omp-telegram-bridge@omp-telegram-plugin
```

Or from the TUI:

```
/marketplace add TomLeeLive/omp-telegram-plugin
/marketplace install omp-telegram-bridge@omp-telegram-plugin
```

### 3. Restart the session

Extension modules load at session start, so restart `omp` for the bridge to take effect.

### 4. Pair your account

DM the bot anything and it replies with a six-character pairing code, recorded under `pending` in `<TELEGRAM_STATE_DIR>/access.json`.

> **OMP is not Claude Code.** The `/telegram:access pair <code>` command belongs to the Claude Code skill, which reads and writes `~/.claude/channels/telegram/access.json` — **not** your OMP bot's `<TELEGRAM_STATE_DIR>/access.json`. Running it does nothing for an OMP bot. Approve the pairing by editing the OMP bot's state file directly, as below.

#### Find your bot's state directory

The bot stores its state (access control, pending pairing codes, downloaded attachments) in a **state directory** — a folder on disk that the bot reads and writes to decide who may message it. That folder is referenced as `<STATE_DIR>` throughout this guide.

The state dir is whatever `TELEGRAM_STATE_DIR` is set to in `~/.omp/agent/mcp.json`. A typical value is `~/.omp-telegram` — expand `~` to your home directory (`C:\Users\<you>\.omp-telegram` on Windows, `/Users/<you>/.omp-telegram` on macOS). The file to edit is `<STATE_DIR>/access.json`.

#### Approve the pairing (edit the JSON by hand)

DM the bot a message. The bot replies with a 6-char code and writes a `pending` entry into `<STATE_DIR>/access.json`, e.g.:

```json
{
  "dmPolicy": "pairing",
  "allowFrom": [],
  "groups": {},
  "pending": {
    "c111f4": {
      "senderId": "123456789",
      "chatId": "123456789",
      "createdAt": 1785826860181,
      "expiresAt": 1785830460181,
      "replies": 2
    }
  }
}
```

To approve:

1. **Read** `<STATE_DIR>/access.json` first (the bot may have added entries — never clobber it).
2. Move `senderId` (the value inside the `pending.<code>` object) into `allowFrom` (dedupe).
3. Delete the `pending.<code>` entry.
4. Write the file back, pretty-printed:
   ```json
   {
     "dmPolicy": "pairing",
     "allowFrom": ["123456789"],
     "groups": {},
     "pending": {}
   }
   ```
5. Create the approval marker file `<STATE_DIR>/approved/<senderId>` containing the `chatId`:
   ```
   echo "123456789" > <STATE_DIR>/approved/123456789
   ```
   The bot polls `approved/` every 5s, sends `Paired! Say hi to Claude.`, then deletes the marker.

The code expires after a short window (`expiresAt`); if the `pending` entry is gone, DM the bot again to get a fresh code. If the bot is already in `allowFrom`, pairing is done — no code is issued because `dmPolicy: "allowlist"` delivers straight through.

From then on, every message you send the bot is injected into the OMP session.

## How it looks

An inbound message arrives in the agent turn like this:

```
[Telegram @username (chat 12345 2026-08-04T09:12:34.000Z)] hello
```

The agent already holds the Telegram `reply` / `react` / `edit_message` tools, so that prefix is all the context it needs to hold a conversation.

## Configuration

The bridge listens on a server named `telegram` by default. If yours is named differently:

```bash
export TELEGRAM_BRIDGE_SERVER="my-telegram"   # comma-separated for several
```

## Caveats

- **Access control is not touched.** This extension only injects messages. Pairing approvals and allowlist changes stay with the MCP server and with you.
- **Same process as OMP.** Extensions run in-process. Install code you trust.
- **The sender label is forgeable.** The injected `[Telegram @name (chat ...)]` prefix is part of the same string as the message body, so an allowlisted sender can type that format into their message and appear to be someone else. The MCP server's allowlist is the real boundary — **only allow people you trust**.
- **Messages interrupt work in progress.** Delivery omits `deliverAs`, so a message that arrives while the agent is mid-turn queues as a steer and cuts in. That is the intent, but sending several messages in a row will repeatedly interrupt whatever the agent is doing.

## License

MIT

---

Built by the team behind [ClawSouls](https://clawsouls.ai) — a sharing platform for portable agent personas.

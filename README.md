# OMP Telegram Bridge

Forwards inbound Telegram messages into your [OMP](https://github.com/can1357/oh-my-pi) session automatically.

A DM to your bot lands in the agent turn as if you had typed it in the terminal — no copy-pasting, no hooks.

*[한국어 README](README.ko.md)*

## Why this exists

OMP receives `notifications/claude/channel` notifications from the Telegram MCP server, but it does **not** inject them into the session. So messages sent to the bot never reach the agent, and you end up pasting them in by hand.

This extension closes that gap using OMP's `mcp_notification` extension event:

```
Telegram DM → Telegram MCP server → notifications/claude/channel
  → OMP mcp_notification event → pi.sendUserMessage("steer") → agent turn starts
```

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
omp plugin marketplace add <owner>/omp-telegram-plugin

# Install (user scope)
omp plugin install omp-telegram-bridge@omp-telegram-plugin
```

Or from the TUI:

```
/marketplace add <owner>/omp-telegram-plugin
/marketplace install omp-telegram-bridge@omp-telegram-plugin
```

### 3. Restart the session

Extension modules load at session start, so restart `omp` for the bridge to take effect.

### 4. Pair your account

DM the bot anything and it replies with a six-character pairing code, recorded under `pending` in `<TELEGRAM_STATE_DIR>/access.json`. Approve it:

```
/telegram:access pair <code>
```

Note that the skill writes to `~/.claude/channels/telegram/` by default. If your bot uses a different `TELEGRAM_STATE_DIR`, edit that directory's `access.json` instead — move the `senderId` into `allowFrom`, delete the `pending` entry, and write `approved/<senderId>` containing the `chatId`.

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
- **Messages interrupt work in progress.** Delivery uses `deliverAs: "steer"`, which cuts into a running turn. That is the intent, but sending several messages in a row will repeatedly interrupt whatever the agent is doing.

## License

MIT

---

Built by the team behind [ClawSouls](https://clawsouls.ai) — a sharing platform for portable agent personas.

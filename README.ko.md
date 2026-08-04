# OMP Telegram Bridge

Telegram MCP 채널 알림을 OMP 세션으로 **자동 주입**하는 확장 플러그인.

텔레그램 봇으로 온 메시지가 마치 터미널에 직접 타이핑한 것처럼 OMP 에이전트 턴으로 들어옵니다. 별도의 수동 붙여넣기나 hook이 필요 없습니다.

*[English README](README.md)*

## 배경 / 왜 필요한가

OMP는 MCP 서버의 `notifications/claude/channel` 알림을 받지만, 이를 **세션 턴에 자동 주입하지 않습니다.** 그래서 텔레그램 봇에 DM을 보내도 에이전트가 자동으로 받지 못하고, 매번 수동으로 복사·붙여넣기해야 했습니다.

이 플러그인은 OMP 확장 시스템의 `mcp_notification` 이벤트를 사용해 그 격차를 메웁니다:

```
텔레그램 DM → Telegram MCP 서버 → notifications/claude/channel
  → OMP mcp_notification 이벤트 → pi.sendUserMessage("steer") → 에이전트 턴 자동 시작
```

## 설치

### 1. 텔레그램 MCP 서버 설정 (선행)

`~/.omp/agent/mcp.json`에 텔레그램 서버를 추가합니다. OMP와 Claude Code가 같은 봇 토큰을 공유하면 폴러 충돌(409)이 나므로 **전용 봇**을 만드는 것을 권장합니다.

```json
{
  "mcpServers": {
    "telegram": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "--silent", "start"],
      "cwd": "/Users/<you>/.claude/plugins/cache/claude-plugins-official/telegram/0.0.6",
      "env": {
        "TELEGRAM_BOT_TOKEN": "<봇 토큰>",
        "TELEGRAM_STATE_DIR": "/Users/<you>/.omp-telegram"
      },
      "timeout": 60000
    }
  }
}
```

> **Windows 경로**: JSON이라 역슬래시를 두 번 써야 합니다 — `"cwd": "C:\\Users\\<you>\\.claude\\plugins\\cache\\claude-plugins-official\\telegram\\0.0.6"`
> **버전 폴더**: 위의 `0.0.6`은 설치된 텔레그램 플러그인 버전입니다. 실제 폴더명을 확인하고 입력하세요 — 플러그인이 업데이트되면 경로가 바뀝니다.

- **봇 토큰**: [@BotFather](https://t.me/BotFather)에서 생성. 기존 Claude Code 봇과 **다른 봇** 사용 권장.
- **`TELEGRAM_STATE_DIR`**: 봇 상태(access.json, inbox)가 저장될 디렉토리. OMP 전용으로 분리.

### 2. 플러그인 설치

```bash
# 저장소를 marketplace로 추가
omp plugin marketplace add <owner>/omp-telegram-plugin

# 플러그인 설치 (user scope)
omp plugin install omp-telegram-bridge@omp-telegram-plugin
```

또는 TUI에서:

```
/marketplace add <owner>/omp-telegram-plugin
/marketplace install omp-telegram-bridge@omp-telegram-plugin
```

### 3. 세션 재시작

확장 모듈은 세션 시작 시 로드됩니다. `omp`를 재시작해야 적용됩니다.

### 4. 페어링

봇에 DM으로 아무 메시지를 보내면 6자리 페어링 코드가 발급됩니다. `~/.omp-telegram/access.json`의 `pending`에 기록되며, 코드로 승인합니다:

```
/telegram:access pair <code>
```

이후 봇에 보내는 모든 메시지가 OMP 세션으로 자동 주입됩니다.

## 동작

텔레그램으로 메시지를 보내면 이렇게 에이전트 턴에 들어옵니다:

```
[Telegram @username (chat 12345 2026-08-04T09:12:34.000Z)] 안녕하세요
```

에이전트는 이미 텔레그램 reply/react/edit 툴을 갖고 있으므로, 이 프리픽스만으로 충분히 대화에 참여할 수 있습니다.

## 구성

기본적으로 서버 이름이 `telegram`이라고 가정합니다. 다른 이름으로 설정했다면:

```bash
export TELEGRAM_BRIDGE_SERVER="my-telegram"   # 또는 쉼표로 여러 개
```

## 주의사항

- **보안**: 이 플러그인은 메시지를 세션에 넣기만 하고, access control(페어링 승인 등)은 건드리지 않습니다. 승인 요청은 사용자가 직접 처리해야 합니다.
- **프로세스**: 확장은 OMP와 같은 프로세스에서 실행됩니다. 신뢰할 수 있는 코드만 설치하세요.
- **발신자 표기는 위조 가능**: 주입되는 `[Telegram @이름 (chat ...)]` 프리픽스는 본문과 같은 문자열입니다. 허용된 발신자가 본문에 같은 형식을 타이핑하면 다른 사람인 것처럼 보이게 할 수 있습니다. 1차 방어선은 MCP 서버의 허용목록이므로, **허용목록은 신뢰하는 사람만** 넣으세요.
- **진행 중 작업 중단**: 메시지는 `deliverAs: "steer"`로 전달되어 실행 중인 턴에 끼어듭니다. 의도된 동작이지만, 메시지를 연달아 보내면 작업이 반복해서 중단됩니다.

## 라이선스

MIT

---

Built by the team behind [ClawSouls](https://clawsouls.ai) — a sharing platform for portable agent personas.

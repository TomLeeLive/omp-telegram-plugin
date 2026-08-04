# OMP Telegram Bridge

Telegram MCP 채널 알림을 OMP 세션으로 **자동 주입**하는 확장 플러그인.

텔레그램 봇으로 온 메시지가 마치 터미널에 직접 타이핑한 것처럼 OMP 에이전트 턴으로 들어옵니다. 별도의 수동 붙여넣기나 hook이 필요 없습니다.

*[English README](README.md)*

## 배경 / 왜 필요한가

OMP는 MCP 서버의 `notifications/claude/channel` 알림을 받지만, 이를 **세션 턴에 자동 주입하지 않습니다.** 그래서 텔레그램 봇에 DM을 보내도 에이전트가 자동으로 받지 못하고, 매번 수동으로 복사·붙여넣기해야 했습니다.

이 플러그인은 OMP 확장 시스템의 `mcp_notification` 이벤트를 사용해 그 격차를 메웁니다:

```
텔레그램 DM → Telegram MCP 서버 → notifications/claude/channel
  → OMP mcp_notification 이벤트 → pi.sendUserMessage() → 에이전트 턴 자동 시작
```

코드에는 실제로 겪었던 두 가지 함정이 반영되어 있습니다:

- **`event.server`가 MCP `server:tool` 형태로 온다** — OMP는 이를 `telegram`이 아니라 `telegram:telegram`으로 넘깁니다. 브리지는 bare 이름, `name:name` 형태, 또는 `:<name>` 접미사를 모두 매칭합니다.
- **`deliverAs`를 생략한다** — `pi.sendUserMessage`는 `deliverAs`가 없으면 idle에서 턴을 시작하고, 스트리밍 중일 때만 steer로 큐잉합니다. `deliverAs: "steer"`를 명시하면 idle에서도 steer로 강제되어, 세션이 중단/휴면 상태였다면 새 턴을 시작하지 못합니다. 생략해야 idle 세션이 확실히 턴을 시작합니다.

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

봇에 DM으로 아무 메시지를 보내면 6자리 페어링 코드가 발급되고, `<TELEGRAM_STATE_DIR>/access.json`의 `pending`에 기록됩니다.

> **OMP는 Claude Code가 아닙니다.** `/telegram:access pair <code>` 명령은 Claude Code 스킬 전용으로, `~/.claude/channels/telegram/access.json`을 읽고 씁니다. **OMP 봇의 `<TELEGRAM_STATE_DIR>/access.json`에는 아무 효과가 없습니다.** 실행해도 OMP 봇은 승인되지 않습니다. 아래처럼 OMP 봇의 상태 파일을 직접 수정해서 승인해야 합니다.

#### 봇의 상태 디렉토리 찾기

봇은 자신의 상태(접근 제어, 대기 중인 페어링 코드, 다운로드한 첨부파일)를 **상태 디렉토리** — 누가 봇에게 메시지를 보낼 수 있는지를 결정하기 위해 봇이 읽고 쓰는 디스크상의 폴더 — 에 저장합니다. 이 가이드 전체에서 그 폴더를 `<STATE_DIR>`이라고 부릅니다.

상태 디렉토리는 `~/.omp/agent/mcp.json`에서 `TELEGRAM_STATE_DIR`로 지정한 값입니다. 보통 `~/.omp-telegram` — 여기서 `~`는 홈 디렉토리를 뜻합니다 (Windows: `C:\Users\<you>\.omp-telegram`, macOS: `/Users/<you>/.omp-telegram`). 수정할 파일은 `<STATE_DIR>/access.json`입니다.

#### 페어링 승인 (JSON 직접 수정)

봇에 메시지를 보내면 봇이 6자리 코드로 응답하고 `<STATE_DIR>/access.json`에 `pending` 항목을 기록합니다. 예:

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

승인 절차:

1. **먼저 `<STATE_DIR>/access.json`을 읽는다** (봇이 새 항목을 추가했을 수 있으니 덮어쓰지 마세요).
2. `pending.<code>` 객체 안의 `senderId` 값을 `allowFrom` 배열로 옮긴다 (중복 제거).
3. `pending.<code>` 항목을 삭제한다.
4. 파일을 보기 좋게(2-space indent) 저장한다:
   ```json
   {
     "dmPolicy": "pairing",
     "allowFrom": ["123456789"],
     "groups": {},
     "pending": {}
   }
   ```
5. 승인 마커 파일 `<STATE_DIR>/approved/<senderId>`를 만들고 내용으로 `chatId`를 넣는다:
   ```
   echo "123456789" > <STATE_DIR>/approved/123456789
   ```
   봇이 `approved/` 디렉토리를 5초마다 폴링해서 `Paired! Say hi to Claude.`를 보내고 마커 파일을 삭제합니다.

코드는 짧은 시간(`expiresAt`)이 지나면 만료됩니다. `pending` 항목이 사라졌다면 봇에 다시 메시지를 보내 새 코드를 받으세요. 이미 `allowFrom`에 있다면 페어링은 완료된 상태이며, `dmPolicy: "allowlist"`에서는 그대로 전달되므로 코드가 발급되지 않습니다.

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
- **진행 중 작업 중단**: 메시지는 `deliverAs`를 생략해 전달되므로, 에이전트가 턴을 진행 중일 때 도착한 메시지는 steer로 큐잉되어 끼어듭니다. 의도된 동작이지만, 메시지를 연달아 보내면 작업이 반복해서 중단됩니다.

## 라이선스

MIT

---

Built by the team behind [ClawSouls](https://clawsouls.ai) — a sharing platform for portable agent personas.

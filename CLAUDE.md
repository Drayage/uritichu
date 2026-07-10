# 우리티츄 (uritichu) — 티츄 카드게임

로컬 서버(express + socket.io) + Firebase 온라인 + 완전 로컬 솔로 모드(Firebase lazy-load).
PWA, GitHub Pages 배포(클라이언트는 `public/`).

## 파일 지도

- `src/engine/` — 규칙: combinations.js(~640줄), scoring.js, gameState.js, exchange.js, cards.js
- `src/ai/` — AI: aiLead / aiFollow / aiTichu / aiExchange
- `src/server/`, `server.js` — 로컬 서버 (`npm start`)
- `public/js/` — 클라이언트: game-client.js(~1,500줄), lobby.js, replay.js, host-runner.js
- **`public/js/engine/`은 `src/engine/`과 별도 사본** — 엔진 규칙 수정 시 양쪽 동기화
  필요 여부를 반드시 확인할 것.
- `public/sw.js` — PWA 캐시 (앱 코드 network-first + SW 교체 시 1회 자동 reload — 유지)
- `scripts/simulate.mjs` — 1000판 AI 시뮬레이터

## 규칙

- **AI/규칙 수정 후 `node scripts/simulate.mjs` 필수** — 시뮬 통과가 수정의 기준.
- 온라인 상태는 서버 확정 상태만 렌더 + seq 가드 낙관적 동시성 — 이 저장소가
  이 패턴의 원본 레퍼런스다. 깨지 말 것 (firebase-online 스킬 참조).
- 리플레이 기록에는 빌드 버전이 임베드된다 — 기록 포맷 변경 시 버전도 갱신.
- 모바일: 높이는 window.innerHeight 기반, 액션 버튼 고정 패턴 유지 —
  "버튼이 화면 밖" 버그를 5커밋에 걸쳐 잡은 전례가 있다 (webgame-ship 스킬 참조).
- 트릭 기록은 coalesced 업데이트 기준으로 누적 처리 (마지막 값 diff 금지).

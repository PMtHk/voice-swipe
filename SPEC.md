# Voice Swipe — 음성으로 인스타 릴스 컨트롤

## 프로젝트 개요

손 안 쓰고 음성 명령으로 인스타그램 릴스를 넘기고 볼륨을 조절하는 크롬 익스텐션.
요리 중이거나 누워있을 때 등 손이 자유롭지 않은 상황에서 사용.

- **목표**: 크롬 웹스토어 출시 (서비스)
- **초기 배포**: 무료 → 유저 반응 보고 프리미엄 기능 추가 검토
- **기술 스택**: Chrome Extension (Manifest V3) + Web Speech API

---

## v1 기능 명세

### 1. 음성 인식 엔진

- Web Speech API (`SpeechRecognition`) 기반 연속 인식
- 한국어/영어 명령어 지원
- Wake word 없이 항상 대기 모드 (토글로 on/off)

### 2. 지원 명령어

| 카테고리 | 명령어 | 동작 |
|----------|--------|------|
| 네비게이션 | "다음" / "next" | 다음 릴스 |
| 네비게이션 | "이전" / "back" / "뒤로" | 이전 릴스 |
| 볼륨 | "음소거" / "뮤트" / "mute" | 음소거 ON |
| 볼륨 | "소거해제" / "언뮤트" / "unmute" | 음소거 OFF |
| 볼륨 | "소리 키워" / "소리 크게" / "volume up" | 볼륨 +10% |
| 볼륨 | "소리 줄여" / "소리 작게" / "volume down" | 볼륨 -10% |
| 볼륨 | "소리 최대" / "max volume" | 볼륨 100% |
| 볼륨 | "소리 최소" / "min volume" | 볼륨 0% |

### 3. 배터리 & 성능 최적화

- 탭이 비활성(백그라운드)일 때 인식 자동 중지
- 릴스 페이지에서만 인식 활성화 (`instagram.com/reels/*`)
- 인식 세션 타임아웃 + 자동 재시작 관리
- 불필요한 연속 인식 방지 (디바운싱 600ms)

### 4. 노이즈 관리

- `confidence` score 기반 필터링 (사용자 설정 가능한 임계값, 기본 0.5)
- 영상 재생 중 오인식 방지를 위한 짧은 명령어 위주 매칭

### 5. 동작 방식

- **네비게이션**: `ArrowDown` / `ArrowUp` KeyboardEvent 디스패치
- **볼륨/음소거**: 현재 활성 `<video>` 엘리먼트의 `.volume` / `.muted` 속성 직접 조작
  - `video.volume = 0.0 ~ 1.0`
  - `video.muted = true / false`
  - **user activation 불필요** — 어느 컨텍스트에서도 동작

### 6. 팝업 UI

- 마이크 on/off 토글
- 현재 상태 표시
  - 🟢 듣는 중
  - 🟡 일시정지
  - ⚫ 비활성 (지원하지 않는 페이지)
- 인식된 명령어 실시간 피드백 표시
- confidence 임계값 슬라이더
- 언어 선택 (한국어 / English)

---

## 기술 아키텍처

```
┌─────────────────────────────────────────┐
│              Chrome Extension           │
│            (Manifest V3)                │
├─────────────┬───────────────────────────┤
│  Popup UI   │     Background Script     │
│  (설정/상태) │  (Service Worker)         │
│             │  - URL 패턴 감지           │
│             │  - 탭 활성 상태 관리        │
│             │  - 설정 저장 (Storage API)  │
├─────────────┴───────────────────────────┤
│           Content Script                │
│  - Web Speech API 인식 루프             │
│  - confidence 필터링                    │
│  - 명령어 매칭                           │
│  - ArrowDown/Up 디스패치 (네비게이션)    │
│  - video.volume/muted 조작 (볼륨)       │
└─────────────────────────────────────────┘
```

### 주요 기술 과제와 해결

| 과제 | 해결 |
|------|------|
| 배터리 최적화 | 탭 비활성 시 중지, URL 기반 선택적 활성화 |
| 노이즈 필터링 | confidence 임계값 + 짧은 키워드 매칭 |
| DOM 안정성 | 키보드 이벤트 우선 + 버튼 클릭 fallback |
| Speech API 연속 인식 | `onend` 이벤트에서 자동 재시작 |
| 볼륨 제어 user gesture 제약 | `<video>` 엘리먼트 속성 직접 조작 (gesture 불필요) |

---

## 지원 플랫폼

- `https://www.instagram.com/reels/*`

---

## 향후 확장 (v2+)

- 추가 명령어: "좋아요", "저장", "공유"
- 자연어 명령 (AI 연동): "이거 재밌다" → 좋아요, "비슷한 거" → 탐색
- 시청 패턴 리포트
- 틱톡 웹 버전 지원
- 커스텀 명령어 매핑 (사용자 정의)
- 오인식 로그 수집 (opt-in)

---

## v2 백엔드 아키텍처

**스택**: Fastify + Supabase

### DB 구조

```
Supabase DB
├── misrecognition_logs   # 오인식 로그 (opt-in 수집)
└── feature_flags         # 전역 설정값 (confidence 임계값 등)
```

> 유저별 설정 없음 — 전역 플래그만 관리

### 리모트 설정 fetch (v1 호환 설계)

v1 익스텐션에 아래 패턴을 심어두면 v2 연동 시 URL만 교체:

```js
const config = await fetchRemoteConfig().catch(() => DEFAULT_CONFIG);
```

### 활용 시나리오

- confidence 임계값을 앱 업데이트 없이 서버에서 조정
- A/B 테스트 (그룹별 임계값 비교 → 오인식률 측정)
- AI 분석 결과를 feature_flags에 write → 익스텐션이 startup 시 자동 반영

---

## 참고

- 이 프로젝트의 핵심 가치는 AI가 아니라 **Web Speech API의 성능 최적화와 브라우저 환경에서의 기술적 문제 해결**에 있음
- MVP 목표: 크롬 웹스토어 무료 출시 → 유저 반응 확인

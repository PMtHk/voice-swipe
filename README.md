# Voice Swipe

> 음성 명령으로 인스타그램 릴스를 넘기고 볼륨을 조절하는 크롬 익스텐션

요리 중이거나 손이 자유롭지 않을 때 "다음", "음소거", "소리 키워" 한 마디로 릴스를 컨트롤하세요.

[![Privacy Policy](https://img.shields.io/badge/privacy-policy-blue)](https://pmthk.github.io/voice-swipe/privacy-policy)
[![License](https://img.shields.io/badge/license-MIT-green)](#license)

---

## ✨ 기능

- 🎤 **음성 명령**: 네비게이션 + 볼륨/음소거 제어
- 🌏 **한국어 · English** 동시 지원
- 🔒 **개인정보 수집 제로** — 모든 인식은 브라우저 내 로컬 처리
- 🔋 **배터리 최적화** — 탭 비활성 시 자동 일시정지
- ⚙️ **민감도 조절** — 환경에 맞게 confidence 임계값 설정

## 🎬 지원 플랫폼

| 플랫폼 | URL 패턴 |
|--------|----------|
| Instagram Reels | `instagram.com/reels/*` |

## 🗣 지원 명령어

| 카테고리 | 한국어 | English | 동작 |
|----------|--------|---------|------|
| 네비게이션 | "다음" | "next" | 다음 릴스 |
| 네비게이션 | "이전" / "뒤로" | "back" / "previous" | 이전 릴스 |
| 볼륨 | "음소거" / "뮤트" | "mute" | 음소거 ON |
| 볼륨 | "소거해제" | "unmute" | 음소거 OFF |
| 볼륨 | "소리 키워" / "소리 크게" | "volume up" / "louder" | 볼륨 +10% |
| 볼륨 | "소리 줄여" / "소리 작게" | "volume down" / "softer" | 볼륨 -10% |
| 볼륨 | "소리 최대" | "max volume" | 볼륨 100% |
| 볼륨 | "소리 최소" | "min volume" | 볼륨 0% |

## 🚀 설치 (개발자 모드)

크롬 웹스토어 출시 전에는 개발자 모드로 설치할 수 있습니다.

```bash
git clone https://github.com/PMtHk/voice-swipe.git
```

1. `chrome://extensions/` 접속
2. 우상단 **개발자 모드** 토글 ON
3. **압축해제된 확장 프로그램 로드** 클릭
4. `voice-swipe/` 폴더 선택

## 📖 사용법

1. 익스텐션 설치 후 Instagram Reels 페이지 접속
2. 브라우저 툴바의 Voice Swipe 아이콘 클릭
3. **마이크 켜기** 버튼 클릭 → 마이크 권한 허용
4. 음성 명령 발화 (예: "다음", "음소거", "소리 키워")
5. 팝업에서 민감도(confidence) 슬라이더로 오인식률 조절

## 🏗 아키텍처

```
┌─────────────────────────────────────────┐
│              Chrome Extension           │
│            (Manifest V3)                │
├─────────────┬───────────────────────────┤
│  Popup UI   │     Service Worker        │
│  (설정/상태) │  - URL 패턴 감지           │
│             │  - 탭 상태 관리             │
│             │  - 설정 sync               │
├─────────────┴───────────────────────────┤
│           Content Script                │
│  - Web Speech API 인식 루프             │
│  - confidence 필터링                    │
│  - ArrowDown/Up 디스패치 (네비게이션)    │
│  - video.volume/muted 조작 (볼륨)       │
└─────────────────────────────────────────┘
```

### 주요 구현 포인트

- **연속 인식 + 자동 재시작**: `SpeechRecognition.onend`에서 안전하게 재시작
- **네비게이션**: `KeyboardEvent(ArrowDown/ArrowUp)`을 document/body/window에 디스패치
- **볼륨 제어**: 활성 `<video>` 엘리먼트의 `.volume`/`.muted` 속성 직접 조작 (user gesture 불필요)
- **SPA 네비게이션 대응**: `MutationObserver`로 URL 변경 감지
- **디바운싱**: 600ms 내 중복 명령 차단
- **원격 설정 훅**: `fetchRemoteConfig()` 스텁 — v2에서 Fastify/Supabase 연결

## 📂 프로젝트 구조

```
voice-swipe/
├── manifest.json         Chrome Extension Manifest V3
├── background.js         Service Worker
├── content.js            Web Speech API + 명령 실행
├── popup.html            팝업 UI 마크업
├── popup.css             다크 테마 스타일
├── popup.js              팝업 로직
├── icons/                확장 아이콘
├── docs/                 GitHub Pages (프라이버시 정책)
├── SPEC.md               프로젝트 스펙
└── SEED.md               Ouroboros Seed 명세
```

## 🔐 개인정보

Voice Swipe는 **어떠한 개인정보도 수집하거나 전송하지 않습니다.**

- 음성 데이터는 브라우저 Web Speech API에서 로컬 처리
- 설정은 Chrome 동기화 저장소에만 저장
- 외부 서버, 분석 도구, 쿠키 일체 사용 안 함

자세한 내용은 [개인정보 처리방침](https://pmthk.github.io/voice-swipe/privacy-policy)을 참고하세요.

## 🗺 로드맵

### v1 (현재)
- [x] 음성 명령 인식
- [x] Instagram Reels 네비게이션 (다음/이전)
- [x] 볼륨 제어 (음소거/업/다운/최대/최소)
- [x] 한국어 / 영어
- [x] 민감도 조절
- [ ] 크롬 웹스토어 출시

### v2 (예정)
- [ ] 오인식 로그 수집 (opt-in) — Supabase
- [ ] 피처 플래그 원격 관리 — Fastify
- [ ] AI 기반 confidence 자동 튜닝
- [ ] 추가 명령어: "좋아요", "저장", "공유"
- [ ] 자연어 명령 (AI)
- [ ] 틱톡 웹 지원

## 🛠 개발

### 요구 사항
- Chrome 또는 Chromium 기반 브라우저 (Edge, Brave 등)
- Node.js (개발 시 선택사항)

### 로컬 테스트
1. 저장소 클론
2. `chrome://extensions/` → 개발자 모드 → 압축해제된 확장 로드
3. 코드 수정 후 확장 페이지에서 새로고침 아이콘 클릭

## 🤝 기여

이슈와 PR 환영합니다. 버그 리포트나 기능 제안은 [Issues](https://github.com/PMtHk/voice-swipe/issues)에 남겨주세요.

## 📄 License

MIT

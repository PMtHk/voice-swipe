# Voice Swipe — Seed Specification
# Generated: 2026-04-10
# Updated: 2026-04-11

goal: >
  Chrome Extension (Manifest V3)을 개발하여 Web Speech API로
  인스타그램 릴스를 음성 명령(한국어/영어)으로 넘기고 볼륨/음소거를
  제어할 수 있게 한다. 서버 없이 익스텐션만으로 구성하며
  크롬 웹스토어에 무료 출시한다.

constraints:
  - Chrome Extension Manifest V3
  - Web Speech API (SpeechRecognition) — 외부 음성 인식 서비스 없음
  - 서버/백엔드 없음 (v1 범위)
  - 오인식 로그 수집 없음 (v1 범위)
  - 지원 URL: instagram.com/reels/* 만
  - confidence 기본 임계값 0.5 (슬라이더로 조정 가능)
  - GitHub Pages에 프라이버시 정책 필수 (마이크 권한 요청)
  - 특수 권한(debugger) 사용 금지 — 웹스토어 심사 리스크

acceptance_criteria:
  - "다음" / "next" 발화 시 다음 릴스로 전환
  - "이전" / "back" 발화 시 이전 릴스로 전환
  - "음소거" / "mute" 발화 시 비디오 음소거
  - "소리 키워" / "소리 크게" 발화 시 볼륨 +10%
  - "소리 줄여" / "소리 작게" 발화 시 볼륨 -10%
  - "소리 최대" 발화 시 볼륨 100%
  - "소리 최소" 발화 시 볼륨 0%
  - 릴스 페이지 진입 시 자동으로 마이크 권한 요청
  - 탭 비활성 시 음성 인식 자동 중지
  - 지원하지 않는 페이지에서 익스텐션 비활성 상태 표시
  - 팝업 UI에서 마이크 on/off 토글 가능
  - 직접 사용해서 느낌이 좋으면 출시 가능

ontology_schema:
  name: VoiceSwipe
  description: 음성 명령 기반 인스타 릴스 탐색 Chrome Extension 도메인 모델
  fields:
    - name: command
      type: string
      description: 인식된 음성 명령 (next | previous | mute | unmute | volumeUp | volumeDown | volumeMax | volumeMin)
    - name: confidence
      type: number
      description: 음성 인식 신뢰도 (0.0~1.0, 기본 0.5)
    - name: platform
      type: string
      description: 현재 플랫폼 ("instagram-reels" | "unsupported")
    - name: micState
      type: string
      description: 마이크 상태 ("listening" | "paused" | "inactive")
    - name: language
      type: string
      description: 인식 언어 ("ko-KR" | "en-US")
    - name: volumeStep
      type: number
      description: 볼륨 조정 단위 (기본 0.1)

evaluation_principles:
  - name: voice_accuracy
    description: 오인식 없이 정확한 명령을 인식하는가
    weight: 0.35
  - name: battery_efficiency
    description: 불필요한 마이크 사용 없이 배터리를 최적화하는가
    weight: 0.20
  - name: dom_stability
    description: 인스타 DOM 변경에도 안정적으로 동작하는가
    weight: 0.20
  - name: command_coverage
    description: 필요한 명령어(네비게이션+볼륨)를 모두 커버하는가
    weight: 0.15
  - name: ux_clarity
    description: 팝업 UI가 현재 상태를 명확히 전달하는가
    weight: 0.10

exit_conditions:
  - name: self_test_pass
    description: 개발자가 직접 사용해서 느낌이 좋을 때
    criteria: 릴스에서 음성으로 자연스럽게 넘어가고 볼륨 조절되고 오인식이 거슬리지 않는 수준
  - name: store_ready
    description: 크롬 웹스토어 제출 요건 충족
    criteria: 프라이버시 정책 페이지 존재, 마이크 권한 사유 명시, 스크린샷 준비

architecture:
  components:
    - name: content_script
      role: Web Speech API 루프, confidence 필터링, 키보드 디스패치, video 속성 조작
    - name: background_service_worker
      role: URL 패턴 감지, 탭 활성 상태 관리, chrome.storage 설정 저장
    - name: popup_ui
      role: 마이크 토글, 상태 표시, confidence 슬라이더, 언어 선택
  navigation_method: "KeyboardEvent(ArrowDown/ArrowUp) dispatch to document/body/window"
  volume_method: "findActiveVideo().volume / .muted 속성 직접 할당 (user gesture 불필요)"
  remote_config_hook: "fetchRemoteConfig().catch(() => DEFAULT_CONFIG) — v2 연동 준비"

non_goals:
  - 오인식 로그 수집 (v2)
  - 서버/백엔드 (v2 — Supabase + Fastify)
  - 피처 플래그 원격 관리 (v2)
  - AI 개선 루프 (v2)
  - "좋아요", "저장", "공유" 명령어 (v2)
  - 틱톡 지원 (v2)
  - 자연어 명령 (v2)
  - chrome.debugger 권한 사용 (웹스토어 심사 리스크)

metadata:
  version: "1.0.0"
  project_type: greenfield
  ambiguity_score: 0.10
  platforms:
    - instagram.com/reels/*
  privacy_policy_host: GitHub Pages

# Voice Swipe — Seed Specification
# Generated: 2026-04-10

goal: >
  Chrome Extension (Manifest V3)을 개발하여 Web Speech API로
  유튜브 쇼츠와 인스타그램 릴스를 음성 명령(한국어/영어)으로
  넘길 수 있게 한다. 서버 없이 익스텐션만으로 구성하며
  크롬 웹스토어에 무료 출시한다.

constraints:
  - Chrome Extension Manifest V3
  - Web Speech API (SpeechRecognition) — 외부 음성 인식 서비스 없음
  - 서버/백엔드 없음 (v1 범위)
  - 오인식 로그 수집 없음 (v1 범위)
  - 지원 URL: youtube.com/shorts/*, instagram.com/reels/* 만
  - confidence 기본 임계값 0.5 (슬라이더로 조정 가능)
  - GitHub Pages에 프라이버시 정책 필수 (마이크 권한 요청)

acceptance_criteria:
  - "다음" / "next" 발화 시 다음 영상으로 전환
  - "이전" / "back" 발화 시 이전 영상으로 전환
  - 쇼츠/릴스 페이지 진입 시 자동으로 마이크 권한 요청
  - 탭 비활성 시 음성 인식 자동 중지
  - 지원하지 않는 페이지에서 익스텐션 비활성 상태 표시
  - 팝업 UI에서 마이크 on/off 토글 가능
  - 직접 사용해서 느낌이 좋으면 출시 가능

ontology_schema:
  name: VoiceSwipe
  description: 음성 명령 기반 숏폼 탐색 Chrome Extension 도메인 모델
  fields:
    - name: command
      type: string
      description: 인식된 음성 명령 ("다음", "next", "이전", "back")
    - name: confidence
      type: number
      description: 음성 인식 신뢰도 (0.0~1.0, 기본 0.5)
    - name: platform
      type: string
      description: 현재 플랫폼 ("youtube-shorts" | "instagram-reels" | "unsupported")
    - name: micState
      type: string
      description: 마이크 상태 ("listening" | "paused" | "inactive")
    - name: language
      type: string
      description: 인식 언어 ("ko-KR" | "en-US")

evaluation_principles:
  - name: voice_accuracy
    description: 오인식 없이 정확한 명령을 인식하는가
    weight: 0.35
  - name: battery_efficiency
    description: 불필요한 마이크 사용 없이 배터리를 최적화하는가
    weight: 0.25
  - name: dom_stability
    description: 유튜브/인스타 DOM 변경에도 안정적으로 동작하는가
    weight: 0.25
  - name: ux_clarity
    description: 팝업 UI가 현재 상태를 명확히 전달하는가
    weight: 0.15

exit_conditions:
  - name: self_test_pass
    description: 개발자가 직접 사용해서 느낌이 좋을 때
    criteria: 쇼츠/릴스에서 음성으로 자연스럽게 넘어가고 오인식이 거슬리지 않는 수준
  - name: store_ready
    description: 크롬 웹스토어 제출 요건 충족
    criteria: 프라이버시 정책 페이지 존재, 마이크 권한 사유 명시, 스크린샷 준비

architecture:
  components:
    - name: content_script
      role: Web Speech API 루프, confidence 필터링, DOM 액션 실행
    - name: background_service_worker
      role: URL 패턴 감지, 탭 활성 상태 관리, chrome.storage 설정 저장
    - name: popup_ui
      role: 마이크 토글, 상태 표시, confidence 슬라이더, 언어 선택
  instagram_dom_strategy: 키보드 이벤트(ArrowDown/Up) + 버튼 클릭 둘 다 테스트 후 안정적인 것 채택
  remote_config_hook: "fetchRemoteConfig().catch(() => DEFAULT_CONFIG) — v2 연동 준비"

non_goals:
  - 오인식 로그 수집 (v2)
  - 서버/백엔드 (v2 — Supabase + Fastify)
  - 피처 플래그 원격 관리 (v2)
  - AI 개선 루프 (v2)
  - "좋아요", "저장", "공유" 명령어 (v2)
  - 틱톡 지원 (v2)
  - 자연어 명령 (v2)

metadata:
  version: "1.0.0"
  project_type: greenfield
  ambiguity_score: 0.12
  platforms:
    - youtube.com/shorts/*
    - instagram.com/reels/*
  privacy_policy_host: GitHub Pages

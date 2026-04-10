---
title: Privacy Policy
layout: default
---

# Voice Swipe — 개인정보 처리방침

**최종 업데이트**: 2026-04-10
**버전**: 1.0.0

Voice Swipe는 사용자의 개인정보를 소중히 여기며, 본 개인정보 처리방침을 통해 당사가 수집하는 정보, 이를 사용하는 방법, 그리고 사용자의 권리에 대해 투명하게 공개합니다.

---

## 1. 수집하는 정보

Voice Swipe는 **어떠한 개인정보도 수집하거나 외부 서버로 전송하지 않습니다.**

| 항목 | 수집 여부 | 설명 |
|------|-----------|------|
| 음성 데이터 | ❌ 미수집 | 음성은 브라우저의 Web Speech API에서 로컬로만 처리됩니다 |
| 개인 식별 정보 | ❌ 미수집 | 이름, 이메일, 계정 정보 등 일체 수집하지 않음 |
| 시청 기록 | ❌ 미수집 | 어떤 영상을 봤는지 기록하지 않음 |
| 명령어 로그 | ❌ 미수집 | v1에서는 음성 인식 로그를 저장하지 않음 |
| 사용 통계 | ❌ 미수집 | 익명 분석 도구도 사용하지 않음 |

---

## 2. 마이크 권한 사용 사유

Voice Swipe는 **음성 명령 인식** 목적으로만 마이크 권한을 사용합니다.

- 마이크 입력은 브라우저 내장 Web Speech API (`SpeechRecognition`)를 통해 처리됩니다
- **음성 데이터는 사용자의 브라우저를 떠나지 않습니다** (단, 브라우저 공급자의 Web Speech API 자체 처리 방식은 해당 브라우저의 정책을 따릅니다)
- 마이크는 지원 페이지(YouTube Shorts, Instagram Reels)에서 사용자가 명시적으로 켠 경우에만 작동합니다
- 탭이 비활성 상태가 되면 마이크는 자동으로 중지됩니다

---

## 3. 저장되는 정보

Voice Swipe는 다음 설정 정보를 **Chrome 동기화 저장소(chrome.storage.sync)** 에 저장합니다:

- 마이크 on/off 상태
- 인식 민감도 (confidence threshold)
- 선택한 언어 (한국어/영어)

이 정보는 **사용자의 Google 계정을 통해 본인의 Chrome 브라우저 간에만 동기화**되며, 개발자나 제3자는 이 정보에 접근할 수 없습니다.

---

## 4. 권한 요약

| 권한 | 사용 목적 |
|------|-----------|
| `storage` | 사용자 설정 저장 (마이크 상태, 민감도, 언어) |
| `tabs` | 현재 페이지가 지원 페이지인지 확인 |
| `activeTab` | 현재 활성 탭에서만 동작 |
| `host_permissions` (YouTube Shorts, Instagram Reels) | 해당 페이지의 DOM 조작 (영상 전환) |
| 마이크 (브라우저 권한) | 음성 명령 인식 |

---

## 5. 제3자 데이터 공유

**없습니다.** Voice Swipe는 어떠한 데이터도 외부 서버나 제3자 서비스에 전송하지 않습니다.

---

## 6. 쿠키 및 추적

Voice Swipe는 쿠키를 사용하지 않으며, 사용자를 추적하지 않습니다.

---

## 7. 어린이 보호

Voice Swipe는 13세 미만 아동으로부터 고의적으로 정보를 수집하지 않습니다.

---

## 8. 정책 변경

본 개인정보 처리방침이 변경될 경우, 크롬 웹스토어 설명과 본 페이지에서 공지합니다. 향후 버전(v2)에서 오인식 로그를 선택적(opt-in)으로 수집하게 될 경우, 사용자에게 명시적 동의를 받고 본 정책을 업데이트할 것입니다.

---

## 9. 연락처

본 개인정보 처리방침 또는 Voice Swipe에 관한 문의는 GitHub Issues를 통해 연락해 주세요.

- **GitHub**: https://github.com/PMtHk/voice-swipe/issues

---

## English Summary

Voice Swipe does **not collect, store, or transmit any personal data**. All voice recognition happens locally in your browser via the Web Speech API. User settings (mic state, confidence threshold, language) are stored only in Chrome's sync storage, accessible only to you.

- **No analytics**
- **No cookies**
- **No third-party data sharing**
- **No server-side data collection**

Microphone access is used solely for voice command recognition on supported pages (YouTube Shorts, Instagram Reels).

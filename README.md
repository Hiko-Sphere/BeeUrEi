<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="BeeUrEi-Brand-Assets/03-wordmark/beeurei-wordmark-horizontal-light-1720.png">
    <img alt="BeeUrEi" src="BeeUrEi-Brand-Assets/03-wordmark/beeurei-wordmark-horizontal-dark-1720.png" width="440">
  </picture>
</p>

<p align="center">
  <b>Be Your Eye — turn an iPhone's camera & LiDAR into a second pair of eyes for blind and low-vision people.</b><br/>
  <sub>On-device real-time obstacle avoidance · walking navigation · scene & object recognition · live human assistance. Free, private, self-hosted.</sub>
</p>

<p align="center">
  <a href="README.md"><b>English</b></a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="https://github.com/Hiko-Sphere/BeeUrEi/actions/workflows/ci.yml/badge.svg" alt="CI">
  <img src="https://img.shields.io/badge/iOS-17%2B-14161F?logo=apple&logoColor=white" alt="iOS 17+">
  <img src="https://img.shields.io/badge/Swift-5-FFC42E?logo=swift&logoColor=14161F" alt="Swift 5">
  <img src="https://img.shields.io/badge/on--device%20AI-Core%20ML%20%2B%20ARKit-14161F" alt="On-device AI">
  <img src="https://img.shields.io/badge/backend-Node%20%2B%20Fastify-339933?logo=nodedotjs&logoColor=white" alt="Backend">
  <img src="https://img.shields.io/badge/tests-590%20passing-2ea44f" alt="Tests">
  <img src="https://img.shields.io/badge/i18n-English%20%2B%20中文-FFC42E?logoColor=14161F" alt="Bilingual">
  <img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue" alt="PolyForm Noncommercial">
</p>

---

## What is BeeUrEi

**BeeUrEi** (Be Your Eye) is a native iOS app that uses the iPhone's main camera and LiDAR to give blind and low-vision people four core capabilities — **no extra hardware, no subscription, vision AI runs on device.**

- 🛡️ **Real-time obstacle avoidance** — on-device AI continuously reads what's ahead and tells you *what it is, the clock direction, and how far*, via speech + AirPods binaural spatial audio + haptics. Includes drop-off / step-edge detection, a three-channel crossing signal (rhythmic tone + rhythmic vibration + full-screen high-contrast color), and a proximity sonar.
- 🧭 **Walking navigation** — a spatial-audio *beacon* points the way, with turn-by-turn speech and street-name callouts; **breadcrumb backtrack** records where you walked and guides you back to the start; and three "sense the surroundings" actions — *Where am I / What's around / What's ahead* — with clock bearings and distances.
- 📷 **Scene & object recognition** — aim and it speaks: identify objects / read text / **read a full document (multi-page)** / **read banknotes** / **scan & remember products** / find your own things (teach it once) / find common items nearby / **people nearby** (count, direction, distance — never identity) / bus routes / light level / touch-to-explore a frozen photo / replay recognition history. All on device — frames never leave the phone.
- 🤝 **Live human assistance** — one-tap video call to family or volunteers. The blind user's camera is **off by default** and only shared on demand; calls ring with sound + vibration + a spoken caller name; during a call a sighted helper can remotely toggle the flashlight or zoom to see clearly.

> The name: a honeybee *is* the pupil of an eye, "seeing" the road for you; the surrounding glow evokes LiDAR scanning and the bee's hum of guidance.

### Safety line (please read)

> **BeeUrEi is a perception-enhancing *assistive tool*, not a *safety device*. It does not replace a white cane, a guide dog, or Orientation & Mobility (O&M) training, and it cannot detect every obstacle. Always keep and prioritize them; never rely on this app as your only means of getting around.**

---

## Why BeeUrEi

| | BeeUrEi | Seeing AI | Lookout | Be My Eyes | Soundscape-class |
|---|:---:|:---:|:---:|:---:|:---:|
| Obstacle avoidance (LiDAR ranging + drop-off detection) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Walking nav + spatial-audio beacon + backtrack | ✅ | ❌ | ❌ | ❌ | ✅ (beacon only) |
| Full recognition suite (text/banknote/product/find/people/bus/light) | ✅ | ✅ | ✅ | partial | ❌ |
| Live video assistance | ✅ family + volunteers | ❌ | ❌ | ✅ | ❌ |
| All three in one app | ✅ | ❌ | ❌ | ❌ | ❌ |
| Frames never leave the device (recognition fully on-device) | ✅ | ❌ partly cloud | ❌ partly cloud | ❌ cloud | — |
| Self-hosted backend (your data) | ✅ | ❌ | ❌ | ❌ | ❌ |
| English + 中文 | ✅ end-to-end | partial | partial | ✅ | ❌ |
| Source-available | ✅ Noncommercial | ❌ | ❌ | ❌ | partial |

---

## Design principles

| Principle | What it means |
|---|---|
| **On-device first** | All vision AI runs locally on the iPhone; frames don't go to the cloud by default — low latency, works offline, private. |
| **Safety-critical** | The physical & positioning limits of avoidance/navigation are first-class: graded degradation, conservative gating (never says "cross now" on poor GPS), confidence transparency (says "possibly X" when unsure). |
| **One voice at a time** | A global speech bus arbitrates every announcement: obstacle warning > incoming call > navigation > recognition/queries — **never overlapping**; an interrupted nav instruction is re-spoken after the warning finishes. |
| **Accessibility is the whole point** | 100% VoiceOver-usable (Magic Tap: recognition screen = describe ahead, incoming call = answer, in-call = hang up); multimodal speech / spatial audio / haptics; high-contrast large type. |
| **Ports & adapters** | Safety logic lives in a platform-independent, unit-tested Swift package; all I/O (camera/ARKit/speech/location/network) is protocol-driven and injectable. |
| **Self-hostable** | Backend + WebRTC signaling + TURN are fully self-hostable — zero per-use third-party fees, your data stays yours. |

---

## Architecture

```
┌──────────────────────── iPhone (native Swift / SwiftUI) ───────────────────────────┐
│                                                                                     │
│  Capture(ARKit+LiDAR) ─▶ FrameSource port ─▶ Perception (Core ML / Vision, on-dev)  │
│        │                                                  │                          │
│        ▼                                                  ▼                          │
│  ARSession depth/image                  obstacles {label · clock · meters} ─▶ stabilize │
│                                                          │                           │
│                       ┌─ avoidance channel (FeedbackArbiter priority) ─▶ speech/spatial/haptics │
│   unified speech bus ─┤                                                              │
│                       └─ SpeechHub (call > nav > recognition; all yield to avoidance) │
│                                                                                     │
│  ── core safety logic (platform-independent Swift Package, 319 unit tests) ───────  │
│  ClockDirection · DepthSampler · ObstacleRanker · FeedbackArbiter · SpeechGate       │
│  LocationAccuracyGate · WaypointAdvance · CurrencyClassifier · BusDisplayReader ...  │
└─────────────────────────────────────────────────────────────────────────────────────┘
            │ REST + WebSocket signaling (network only — no AI inference)   ▲
            ▼                                                               │ P2P media (WebRTC)
┌──────────────── self-hosted backend (Node + TypeScript + Fastify) ──────┐ │  on relay failure
│ accounts/roles (JWT/RBAC) · family links (mutual consent) · call routing │ │  ┌─────────────┐
│ public help queue · push (bilingual) · admin/reports · SQLite           │◀┘  │ coturn TURN │
└──────────────────────────────────────────────────────────────────────────┘    └─────────────┘
```

---

## Tech stack

| Layer | Choices |
|---|---|
| On-device perception | ARKit `sceneDepth` (LiDAR ranging) · Core ML / Vision (object detection · OCR · barcodes · face rects · FeaturePrint) |
| Feedback | AVSpeechSynthesizer (TTS, bus-arbitrated) · AVAudioEngine binaural HRTF spatial audio · Core Haptics · VoiceOver-aware |
| Navigation | MapKit walking routes (overseas) · licensed map SDK (mainland China, planned) · CoreLocation · CLGeocoder street names |
| Live assistance | WebRTC P2P · self-hosted WebSocket signaling · self-hosted coturn TURN · CallKit + PushKit (background calls) |
| UI | SwiftUI (iOS 17+, `@Observable` MVVM) · AppIntents (9 bilingual Siri shortcuts) |
| Backend | Node.js + TypeScript + Fastify + `node:sqlite` + JWT + WebSocket |
| Tooling | XcodeGen · Swift Package (core logic) · Vitest (backend) · GitHub Actions CI |

---

## Project layout

```
Project_BeeUrEi/
├─ BeeUrEi/                  iOS app (adapters + UI)
│  ├─ Sensors/ Capture/      FrameSource port, ARKit capture, depth sampling
│  ├─ Perception/            YOLO detector (Core ML / Vision, ROI-focused)
│  ├─ Feedback/              SpeechHub bus, avoidance speech / spatial audio / haptics, AirPods head tracking
│  ├─ Navigation/            MapKit walking nav, sense-the-surroundings, breadcrumb backtrack
│  ├─ RemoteAssist/          signaling client, media engine, CallKit/ringtone, family list
│  ├─ Account/               sign-in, Keychain, API client
│  └─ Features/              home, recognition suite, navigation, calls, settings, onboarding
├─ Packages/BeeUrEiCore/     platform-independent core safety logic (319 unit tests)
├─ Tests/BeeUrEiTests/       app-layer regression (call privacy gate / avoidance discipline / nav gating / incoming / recognition state machines, 72 tests)
├─ server/                   self-hosted backend (Node + TS, 199 tests)
└─ BeeUrEi-Brand-Assets/     brand assets (icon / wordmark / palette)
```

---

## Getting started

### App (needs a LiDAR iPhone: 12 Pro or newer Pro)

```sh
xcodegen generate            # regenerate BeeUrEi.xcodeproj after editing project.yml
open BeeUrEi.xcodeproj
```
In Xcode select the target → **Signing & Capabilities** → your Apple ID → connect a device → `⌘R`.
(Camera/LiDAR require a real device; the Simulator shows "device not supported".)

> Real WebRTC media uses a vendored `Frameworks/WebRTC.xcframework` (gitignored, ~91 MB). With it present the real engine is active; without it the app still builds and calls fail honestly (no fake connection).

### Backend (self-hosted, runs out of the box)

```sh
cd server
npm install
ADMIN_USERNAME=root ADMIN_PASSWORD=your-strong-password npm run dev   # http://localhost:8787
curl http://localhost:8787/health        # → {"status":"ok",...}
```

For Docker / TURN / APNs push, build `docker build -t beeurei-api server/` and run with `--env-file server/.env`, fronted by a tunnel of your choice.

---

## Testing & quality

```sh
swift test --package-path Packages/BeeUrEiCore   # core safety logic: 319 tests
xcodebuild test -scheme BeeUrEi ...              # app-layer regression: 72 tests (Simulator)
cd server && npm test                            # backend: 199 tests
```

- **590 tests, all passing**, re-verified by GitHub Actions on every push; backend `tsc` type-check is clean.
- Hardened by **multiple rounds of multi-agent adversarial code review** — 140+ real defects fixed (signaling eavesdrop, wrong obstacle distance/direction, dark-floor drop-off false positives, arrival bypassing the accuracy gate, magnetic-interference beacon misdirection, permanently-muted spatial audio after an interruption, speech channels drowning each other, silent errors for blind users, missing confirmations) — each with a regression test.
- **The three safety subsystems each have a dedicated regression net:** call privacy gating (new peer doesn't send video by default / remote control is least-privilege), avoidance discipline (silence on pause / degrade when depth is missing), navigation gating (poor accuracy never enters the route / no false arrival).
- Safety-critical math/gating lives in the core package and is unit-tested — verifiable on a Mac in seconds, no Simulator required.

---

## Accessibility & safety

- Fully **VoiceOver**-usable; when VoiceOver is on, speech routes through accessibility announcements so it never fights VoiceOver; **Magic Tap** jumps to the most important action on each screen.
- **One-voice rule:** the global speech bus arbitrates everything — obstacle warnings always win, calls/nav/recognition each take their place, **never overlapping**; framing hints must be stable before speaking and never cut off a recognition result.
- **Graded degradation:** unstable LiDAR tracking, overheating, low battery, or poor location accuracy trigger an announced degrade; thermal safety stop.
- **Confidence transparency:** when recognition is unsure it says "possibly X" rather than asserting.
- **Disclosure:** full informed consent on first launch (bilingual) + a short, switchable reminder each session.
- Before release this needs testing **with real blind users** and a safety policy co-designed with O&M professionals.

---

## Privacy

- Vision AI is **entirely on-device**: recognition, find-my-things, document reading, banknotes, people detection — frames never leave the phone.
- "People nearby" reports **count and direction only** — no identity, no stored faces.
- Live video is **P2P**; the blind user's camera is **off by default** and only shared on demand; a new peer joining resets sharing to off.
- Recognition history / product memory / taught items are stored **on device only** with file protection (`completeFileProtection`).
- Calls are **not recorded by default**; if enabled it requires both parties' informed consent.
- Self-hosted backend: account and call-routing data live on **your own server**.

---

## Status & roadmap

| Phase | Scope | Status |
|---|---|---|
| Core safety logic | 60+ modules / 319 tests / multi-round adversarial review | ✅ |
| Phase 1 — real-time avoidance | LiDAR depth + detection + drop-off/crossing + spatial audio | ✅ (on-device tuning pending) |
| Phase 2 — walking navigation | overseas MapKit + beacon + backtrack + sense-surroundings | ✅ (on-device positioning pending) · mainland map SDK needs a key ⏳ |
| Recognition suite | text / full-page / banknote / product / find / people / bus / light / history | ✅ (some device verification pending) |
| Bilingual | full end-to-end English + 中文 (~450 strings + push) | ✅ (English copy pending native review) |
| Self-hosted backend | accounts / family / calls / signaling / push / admin | ✅ deployed |
| Phase 3 — live video | signaling + privacy gating + ringtone/CallKit + WebRTC media | ✅ (two-device verification pending) |
| Phase 4 — polish & ship | device testing / blind-user testing / App Store | ⏳ external resources |

---

## Brand

Honey `#FFC42E` · Ink `#14161F`. Full icon / wordmark / palette in [`BeeUrEi-Brand-Assets/`](BeeUrEi-Brand-Assets/).

<p align="center">
  <img src="BeeUrEi-Brand-Assets/02-mark/beeurei-mark-color-512.png" width="96" alt="BeeUrEi mark">
</p>

---

## Author

- **Organization:** Hiko Sphere 彦穹科技
- **Producer:** Li Yanpei Hiko

## License

BeeUrEi is released under the **[PolyForm Noncommercial License 1.0.0](LICENSE)**. You may freely **use, study, modify, distribute, and collaborate on** it for any **noncommercial** purpose (personal, research, education, public-interest and accessibility work) — at no cost. **Commercial use is not permitted** (selling it, or charging the blind/low-vision users it exists to serve). This is a public-interest project; for commercial licensing, contact Hiko Sphere 彦穹科技.

> The software is provided "as is", without warranty of any kind. It is an assistive tool and **does not replace a white cane, a guide dog, or O&M training.**

<p align="center">
  <sub>BeeUrEi — Be Your Eye 🐝 ｜ © 2026 Hiko Sphere 彦穹科技 · Li Yanpei Hiko ｜ PolyForm Noncommercial 1.0.0</sub>
</p>

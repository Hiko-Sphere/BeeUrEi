<!-- Maintainer note: set the repo About to the tagline below, Website to https://beeurei.hikosphere.com, and topics: accessibility, ios, blind, low-vision, lidar, webrtc, on-device-ai, swift, voiceover. -->
<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="BeeUrEi-Brand-Assets/03-wordmark/beeurei-wordmark-horizontal-dark-1720.png">
  <source media="(prefers-color-scheme: light)" srcset="BeeUrEi-Brand-Assets/03-wordmark/beeurei-wordmark-horizontal-light-1720.png">
  <img src="BeeUrEi-Brand-Assets/03-wordmark/beeurei-wordmark-horizontal-light-1720.png" alt="BeeUrEi — Be Your Eye" width="420">
</picture>

### A second pair of eyes for blind and low-vision people — running on your iPhone.

**On-device real-time obstacle avoidance · walking navigation · scene & object recognition · live human assistance.**
The visual AI runs entirely on the device; the camera feed stays on your phone by default.

**English · [简体中文](README.zh-CN.md)**

[![CI](https://github.com/Hiko-Sphere/BeeUrEi/actions/workflows/ci.yml/badge.svg)](https://github.com/Hiko-Sphere/BeeUrEi/actions/workflows/ci.yml)
![iOS 17+](https://img.shields.io/badge/iOS-17%2B-000?logo=apple)
![Swift 5](https://img.shields.io/badge/Swift-5-F05138?logo=swift&logoColor=white)
![On-device AI](https://img.shields.io/badge/AI-on--device-FFC42E?labelColor=14161F)
![Backend: Node + Fastify](https://img.shields.io/badge/backend-Node%20%2B%20Fastify-3178C6)
![tests 682](https://img.shields.io/badge/tests-682-3FB950)
![Bilingual](https://img.shields.io/badge/i18n-EN%20%C2%B7%20%E4%B8%AD%E6%96%87-FFC42E?labelColor=14161F)
![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-14161F)

[Website](https://beeurei.hikosphere.com) · [Legal & Privacy](https://beeurei.hikosphere.com/legal/) · [Brand Assets](BeeUrEi-Brand-Assets/)

</div>

> **BeeUrEi** (Be Your Eye / 蜂之眼) turns an iPhone's main camera and LiDAR into a second pair of eyes. The bee is the pupil that "sees" the road for you; the faint glow around it is the hum of a LiDAR scan and the swarm guiding your way. Free, privacy-first, and self-hostable. Built by **Hiko Sphere 彦穹科技**; produced by **Li Yanpei Hiko**.

---

> [!IMPORTANT]
> **BeeUrEi is a perception-enhancing *assistive tool*, not a safety device.** It does **not** replace the white cane, a guide dog, or Orientation & Mobility (O&M) training, and it **cannot** detect every obstacle. Always keep using them, and never rely on this app as your only means of travelling safely.

---

## Table of Contents

- [What BeeUrEi does](#what-beeurei-does)
- [Why BeeUrEi (vs. similar apps)](#why-beeurei)
- [Design principles](#design-principles)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Screenshots](#screenshots)
- [Getting started](#getting-started)
- [Testing & quality](#testing--quality)
- [Accessibility & safety](#accessibility--safety)
- [Privacy](#privacy)
- [Docs & links](#docs--links)
- [Status & roadmap](#status--roadmap)
- [FAQ](#faq)
- [Security disclosure](#security-disclosure)
- [Contributing](#contributing)
- [Brand, author & license](#brand-author--license)

---

## What BeeUrEi Does

Four core capabilities, all designed around blind and low-vision use. The vision AI runs **on-device**; the camera feed stays on your phone by default.

#### 1. Real-time obstacle avoidance — *on-device*
Local AI continuously reads the path ahead and announces **what it is · clock-face direction · how far**, across three channels at once: **speech + AirPods binaural spatial audio + haptics**. Includes **drop-off / step-edge detection**, a **three-channel crossing signal** (rhythmic tone + rhythmic vibration + full-screen high-contrast color), and an **approach sonar**.

#### 2. Walking navigation
A spatial-audio **beacon** points the way, with turn-by-turn speech and **street-name** call-outs. **Retrace** records the path you walked and guides you back to where you started. Three **"sense around me"** actions — *Where am I / What's around me / What's ahead* — each with clock-face bearing and distance.

#### 3. Scene & object recognition ("Look") — *on-device*
Read text · read a full multi-page document · identify **banknotes** · scan a barcode and remember the product · teach it once, then **find your own things** · find common nearby objects · **people around you** (count · direction · distance — **never** identity) · bus lines · ambient light level · **touch-to-explore** a frozen photo · review recognition history. All on-device; the image never leaves the phone.

#### 4. Live human assistance
One tap to video-call **family/friends or volunteers**. On the blind user's side the **camera is off by default** and shared only on demand; incoming calls ring with **sound + vibration + spoken caller name**. During a call, the sighted helper can remotely toggle the **flashlight** and **zoom** to see clearly. A call can be **recorded only with both parties' consent** (server-verified), and you can **play back or delete** your own recordings — each tagged with time, participants, duration, and place.

#### Trust, safety & governance
For a vulnerable user base, safety is a feature. **Reporting** (optionally with a recording attached as evidence), **blocking**, and a moderation ladder are built in; report outcomes are **delivered to both parties** through a persistent in-app inbox. For abuse prevention, an administrator can **observe a live call** (and speak into it, or force-end it) — but **never covertly: both parties are notified in real time** with a non-dismissible banner and a spoken announcement, and old clients that can't show that notice are never observed. Every privileged action is **audited**.

---

## Why BeeUrEi

<a id="why-beeurei"></a>
Most accessibility apps do **one** of these well. BeeUrEi brings obstacle avoidance, navigation, recognition, and live help together — on-device by default, and self-hostable.

| Capability | **BeeUrEi** | Seeing AI | Lookout | Be My Eyes | Soundscape-class |
|---|:---:|:---:|:---:|:---:|:---:|
| Obstacle avoidance (LiDAR ranging + drop-off detection) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Walking nav + spatial-audio beacon + retrace | ✅ | ❌ | ❌ | ❌ | beacon only |
| Full recognition suite (text / banknote / product / find-my-thing / people / bus / light) | ✅ | ✅ | ✅ | partial | ❌ |
| Live video assistance | ✅ (family + volunteers) | ❌ | ❌ | ✅ | ❌ |
| All three (avoid + navigate + recognize) in one app | ✅ | ❌ | ❌ | ❌ | ❌ |
| Image stays on device (recognition fully on-device) | ✅ | partly cloud | partly cloud | partly cloud | ❌ |
| Self-hostable backend | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bilingual (EN · 中文) end to end | ✅ | — | — | — | — |
| Source available (noncommercial) | ✅ | ❌ | ❌ | ❌ | ❌ |

*Comparison reflects BeeUrEi's design goals and publicly understood positioning of the other apps; it is not a benchmark of accuracy.*

---

## Design Principles

- **On-device first** — vision AI runs locally; the camera feed stays on the phone by default.
- **Safety-critical** — graded degradation and conservative gating. When GPS is poor it will *never* say "cross now"; when unsure it says "possibly an X" instead of guessing.
- **One sound at a time** — a global speech bus arbitrates priority: **obstacle > incoming call > navigation > recognition**. Nothing overlaps, and a navigation instruction interrupted by a warning is **replayed** afterward.
- **Accessibility is everything** — 100% VoiceOver-usable, a **Magic Tap** to the most important action on each screen, multimodal speech / spatial audio / haptics, high-contrast large type.
- **Ports & adapters** — the safety logic lives in a platform-independent, unit-testable Swift Package; all I/O is protocol-driven and injectable.
- **Self-hostable** — backend + WebRTC signaling + TURN are all self-hostable, with **zero per-use third-party fees**.

---

## Architecture

The visual pipeline runs entirely on the iPhone. The backend handles **only networking** (accounts, call routing, signaling) — it does **no AI inference**.

```
┌──────────────────────────── iPhone (Swift / SwiftUI) ────────────────────────────┐
│                                                                                   │
│  ARKit + LiDAR ──▶ FrameSource port ──▶ on-device Core ML / Vision perception      │
│                                              │                                    │
│                                              ▼                                    │
│                          Obstacle { label · clock · meters }                      │
│                                              │                                    │
│                                       stabilization                               │
│                                              │                                    │
│                                              ▼                                    │
│                              FeedbackArbiter (priority)                            │
│                                              │                                    │
│                       ┌──────────────────────┼──────────────────────┐             │
│                       ▼                      ▼                      ▼             │
│                    Speech            Binaural spatial audio       Haptics          │
│                                                                                   │
│   SpeechHub (one voice bus):  call > navigation > recognition  ── all yield ──▶ obstacle
│                                                                                   │
└───────────────────────────────────────────┬───────────────────────────────────────┘
                                             │  REST + WebSocket signaling
                                             │  (network only — no AI inference)
                                             ▼
┌──────────────── Self-hosted backend (Node + TypeScript + Fastify) ───────────────┐
│  Accounts & roles (JWT / RBAC) · family binding (two-way consent) · call routing │
│  help queue · push + in-app inbox · recording (consent · legal-hold · playback)  │
│  admin observer mesh (notified) · reports + evidence · moderation · SQLite        │
└───────────────────────────────────────────┬───────────────────────────────────────┘
                                             │
                       WebRTC P2P media  ◀───┴───▶  on direct-connect failure,
                                                   relayed via self-hosted coturn (TURN)
```

**Platform-independent safety core** (Swift Package, **319** unit tests): `ClockDirection`, `DepthSampler`, `ObstacleRanker`, `FeedbackArbiter`, `SpeechGate`, `LocationAccuracyGate`, `WaypointAdvance`, `CurrencyClassifier`, `BusDisplayReader`, and more.

---

## Tech Stack

**On-device perception** — ARKit `sceneDepth` (LiDAR ranging), Core ML / Vision (object detection · OCR · barcode · face-box · FeaturePrint).
**Feedback** — `AVSpeechSynthesizer` (bus-arbitrated), `AVAudioEngine` binaural HRTF spatial audio, Core Haptics, VoiceOver-aware.
**Navigation** — MapKit walking routes (overseas), licensed map-provider SDK (Chinese mainland, *planned*), CoreLocation, CLGeocoder street names.
**Remote assistance** — WebRTC P2P, self-hosted WebSocket signaling, self-hosted coturn, CallKit + PushKit (background calls).
**UI** — SwiftUI (iOS 17+, `@Observable` MVVM), AppIntents (**9** bilingual Siri shortcuts).
**Backend** — Node.js + TypeScript + Fastify + `node:sqlite` + JWT + WebSocket.
**Tooling** — XcodeGen, Swift Package, Vitest, GitHub Actions CI.

---

## Repository Layout

```
BeeUrEi/
├── BeeUrEi/                  iOS adapter layer + UI
│   ├── Sensors/ · Capture/   ARKit + LiDAR frame capture
│   ├── Perception/           on-device Core ML / Vision
│   ├── Feedback/             speech · spatial audio · haptics
│   ├── Navigation/           routes · beacons · retrace
│   ├── RemoteAssist/         WebRTC calls + signaling
│   ├── Account/ · Consent/    auth, roles, consent flows
│   └── Features/             scene & object recognition
├── Packages/BeeUrEiCore/     platform-independent safety core — 319 unit tests
├── Tests/BeeUrEiTests/       app-layer regression — 72 tests
├── server/                   self-hosted backend (Node + TS) — 212 tests · 42 test files
├── site/                     marketing site + /legal/ pages
├── BeeUrEi-Brand-Assets/     icon · wordmark · palette
└── .github/workflows/ci.yml  continuous integration
```

---

## Screenshots

Real captures from device.

| | | |
|:---:|:---:|:---:|
| <img src="site/public/assets/shots/home.jpg" alt="Home screen: 'Path ahead is clear', call-for-help button, and the 3×3 action grid" width="230"> | <img src="site/public/assets/shots/look.jpg" alt="Look: the recognition action grid" width="230"> | <img src="site/public/assets/shots/navigation.jpg" alt="Walking navigation" width="230"> |
| **Home** — "Path ahead is clear" + help + grid | **Look** — recognition grid | **Navigation** — walking route |
| <img src="site/public/assets/shots/help.jpg" alt="Call for help screen" width="230"> | <img src="site/public/assets/shots/messages.jpg" alt="Messages" width="230"> | <img src="site/public/assets/shots/settings.jpg" alt="Settings" width="230"> |
| **Help** — call for assistance | **Messages** | **Settings** |
| <img src="site/public/assets/shots/signin.jpg" alt="Sign-in methods" width="230"> | <img src="site/public/assets/shots/legal.jpg" alt="In-app legal & privacy center" width="230"> | <img src="site/public/assets/shots/safety.jpg" alt="Safety notice" width="230"> |
| **Sign in** — login methods | **Legal** — in-app legal center | **Safety** — safety notice |

---

## Getting Started

### App

Requires a LiDAR-equipped iPhone (12 Pro or a newer Pro). The camera and LiDAR need a **real device** — the simulator reports *device not supported*.

```bash
xcodegen generate        # (re)generate the Xcode project
open BeeUrEi.xcodeproj
```

In Xcode: select the target → **Signing & Capabilities** → your Apple ID → connect a real device → **⌘R**.

Real WebRTC media uses a vendored `Frameworks/WebRTC.xcframework` (gitignored, ~91 MB). With it present, the real engine is enabled; **without it the app still builds, and calls fail honestly** — no faked connection.

### Backend (self-hosted, works out of the box)

```bash
cd server
npm install
ADMIN_USERNAME=root ADMIN_PASSWORD=your-strong-password npm run dev   # http://localhost:8787
curl http://localhost:8787/health    # → {"status":"ok",...}
```

**Docker** — first create `server/.env` from the template (`cp server/.env.example server/.env` and fill in your values), then:

```bash
docker build -t beeurei-api server/
docker run --env-file server/.env beeurei-api        # front it with any tunnel
```

Or pass the variables inline instead of an env file:

```bash
docker run -e ADMIN_USERNAME=root -e ADMIN_PASSWORD=your-strong-password beeurei-api
```

The production self-hosted backend runs on **AWS (Tokyo) + Cloudflare Tunnel**, with **coturn** for TURN.

---

## Testing & Quality

```bash
swift test --package-path Packages/BeeUrEiCore        # core safety logic — 319 tests
xcodebuild test -scheme BeeUrEi                        # app-layer regression (simulator) — 74 tests
cd server && npm test                                  # backend — 289 tests
```

**682 tests across the three suites** (319 core + 74 app-layer + 289 backend). GitHub Actions runs the full suite on every push, and the backend `tsc` type-check is clean. The live **CI badge** above is the authoritative pass/fail signal.

Through several rounds of adversarial, multi-agent code review, **160+ real defects** were fixed — signaling eavesdropping, recording media reachable through the wrong endpoint, a moderation notification leaking the counterparty's sanction, a play token surviving session revocation, wrong obstacle distance/direction, false drop-off alarms over dark ground, arrival bypassing the accuracy gate, a magnetically-misled beacon bearing, spatial audio permanently muted after an interruption, silent failures to the blind user — each with a regression test. The safety-critical subsystems each have a dedicated regression net: **call privacy gating, the admin-observer admission/relay, recording consent & playback authorization, obstacle-avoidance discipline, and navigation gating.**

---

## Accessibility & Safety

- **100% VoiceOver-usable.** When VoiceOver is on, speech routes through the accessibility-announcement channel so it never fights VoiceOver. A **Magic Tap** jumps to the most important action on every screen.
- **One sound at a time** — obstacle avoidance always wins.
- **Graded degradation** — if LiDAR is unstable, the device overheats, the battery is low, or location is poor, the app announces the degraded state; thermal protection stops it.
- **Confidence transparency** — when unsure, it says "possibly an X."
- **Full informed consent at first launch** (bilingual), plus a short, dismissible reminder each session.

> Before any public release, BeeUrEi must be tested with **real blind users** and have its safety policy co-defined with **O&M experts**.

---

## Privacy

- Vision AI is **fully on-device**; the camera feed stays on your phone by default.
- **"People around you"** reports only count and direction — **no identity, no face stored**.
- Live video is **P2P**; on the blind user's side the camera is **off by default** and shared only on demand, and it **resets to off** whenever a new member joins.
- Recognition history, the product library, and taught items are stored **only on the device** (`completeFileProtection`).
- Calls are **not recorded by default**; recording requires **server-verified informed consent from both parties**, auto-deletes after a short retention window (7 days by default), and stays accessible to you for playback or deletion.
- For abuse prevention, an administrator may **observe a live call — never covertly**: both parties are notified in real time (banner + spoken announcement), and the observation channel is isolated from the 1:1 media. Privileged access is **audited**.
- Self-hosted backend — account and call-routing data live **on your own server**.
- **Registration now requires reading and accepting the *Privacy Policy* and *Terms of Use* before it can be completed.**

Full legal text — Privacy / Terms / EULA, bilingual — is on the website at **<https://beeurei.hikosphere.com/legal/>** and in the in-app **Legal & Privacy** center.

---

## Docs & Links

- **Website** — <https://beeurei.hikosphere.com>
- **Legal documents** (Privacy · Terms · EULA, bilingual, v3.0) — <https://beeurei.hikosphere.com/legal/>
- **Technical disclosure** (技术交底, full architecture & security model) — [`docs/技术交底.md`](docs/技术交底.md)
- **Brand assets** (icon · wordmark · palette) — [`BeeUrEi-Brand-Assets/`](BeeUrEi-Brand-Assets/)
- **Security policy** — [`SECURITY.md`](SECURITY.md)
- **Contributing guide** — [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Code of conduct** — [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- **Admin panel** — self-hosted at `/admin`

---

## Status & Roadmap

| Area | Status |
|---|---|
| Core safety logic | ✅ Done |
| Phase 1 — real-time obstacle avoidance | ✅ Done (on-device tuning pending) |
| Phase 2 — walking navigation (overseas) | ✅ Done |
| Walking navigation — Chinese-mainland map provider | ⏳ Awaiting key |
| Recognition suite | ✅ Done (some on-device validation pending) |
| Bilingual (EN · 中文) | ✅ Done (English copy pending native review) |
| Self-hosted backend | ✅ Done — deployed |
| Phase 3 — live video | ✅ Done (two-sided validation pending) |
| Phase 4 — polish & App Store release | ⏳ Awaiting external resources |

---

## FAQ

**Which iPhone do I need?**
Real-time obstacle avoidance relies on LiDAR, so it needs a LiDAR-equipped iPhone (iPhone 12 Pro or a newer Pro model). The other features — recognition, navigation, messaging, and live assistance — work on more devices.

**Does it need an internet connection?**
Obstacle avoidance and all recognition run on-device and work offline. Walking navigation, live human assistance, messaging, and emergency notifications use the network.

**Are my camera frames uploaded?**
No, not by default. All vision AI runs on-device. Frames are sent only when you actively start a remote-assistance call with someone you chose and hold "Show video" — and even then, peer-to-peer.

**Can it replace a white cane or guide dog?**
No. BeeUrEi is a perception-enhancing assistive tool, not a safety device, and it cannot detect every obstacle. Always keep and prioritize your white cane, guide dog, and O&M training.

**Do I have to agree to anything to sign up?**
Yes — creating an account requires reading and agreeing to the Privacy Policy and Terms of Service; your consent (version + time) is recorded so it can be demonstrated.

**Can I run the backend myself?**
Yes — the backend, WebSocket signaling, and TURN relay are fully self-hostable, with no per-use third-party fees. See [Getting Started](#getting-started).

**Is it on the App Store yet?**
Not yet — it is in preparation. The core is built and tested; on-device tuning and blind-user testing come next.

**Why a noncommercial license?**
BeeUrEi is a public-interest project for the blind and low-vision people it serves. It is free to use, study, modify, and share for noncommercial purposes; selling it (or charging those users) is not permitted.

---

## Security Disclosure

Found a security issue? Please report it **privately** by email to **<beeurei@163.com>** — **do not open a public issue.** We will acknowledge your report and work with you on a fix before any disclosure. See [`SECURITY.md`](SECURITY.md) for full details.

---

## Contributing

Noncommercial contributions are welcome. Before opening a pull request:

1. **Run the tests** and make sure everything is green (`swift test --package-path Packages/BeeUrEiCore`, `xcodebuild test -scheme BeeUrEi`, and `cd server && npm test`).
2. **Follow the existing style and structure** — keep safety logic in `Packages/BeeUrEiCore` and cover it with tests.
3. **Submit under the project's license** — PolyForm Noncommercial 1.0.0.

For anything touching the safety-critical subsystems (obstacle avoidance, navigation gating, call privacy), please include a regression test. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full guide and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for community expectations.

---

## Brand, Author & License

**Palette** — Honey `#FFC42E` · Ink `#14161F`. Assets in [`BeeUrEi-Brand-Assets/`](BeeUrEi-Brand-Assets/) (wordmark `03-wordmark`, mark `02-mark`).

**Author** — Hiko Sphere 彦穹科技 / produced by Li Yanpei Hiko.

**License** — **PolyForm Noncommercial 1.0.0.** You may freely **use, study, modify, and distribute** BeeUrEi for any **noncommercial** purpose. **Commercial use is prohibited** — including selling it or charging the blind/low-vision users it is meant to serve. The software is provided **"as is", without any warranty**, and is an **assistive tool that does not replace** the white cane, a guide dog, or O&M training. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

© 2026 Hiko Sphere 彦穹科技 · Li Yanpei Hiko.

<div align="center">

*Be your eye. 蜂之眼，替你看路。*

</div>

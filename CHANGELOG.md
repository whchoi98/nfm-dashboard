# Changelog

All notable changes to the NFM Dashboard are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The version shown in the app UI reads `APP_VERSION` from `app/src/lib/version.ts` — keep it and `app/package.json` in sync with the top entry here.

## [1.0.0] - 2026-07-10

First full release: AWS Network Flow Monitor (NFM) Pod-to-Pod observability dashboard with an Amazon Bedrock AgentCore chatbot, plus the Phase 6 analytics enrichment.

### Added
- **Core dashboard (Phases 1–5)**
  - Overview page with NFM KPI tiles (data transferred, retransmissions, timeouts, RTT, Network Health Indicator), deltas, sparklines, top talkers, and CloudWatch deep links.
  - Flows, Paths, Monitors, Agents, and Diagnose pages backed by a DynamoDB collector pipeline (NFM top-contributor queries, agent/monitor status, hop-path data).
  - AgentCore-powered chatbot (floating chat + `/chat-popup` standalone window) with SSE streaming, MCP tooling, and AI diagnosis.
  - Cognito login, ko/en i18n with full key parity, SnowUI design tokens with light/dark themes, mobile layout (bottom tabs, safe-area handling).
- **Analytics enrichment (Phase 6)**
  - WhaTap-style force-directed topology graph (d3-force) with tier flow map, resource icons, tag filtering, and live legend.
  - 5-tab Insights hub (Latency, Reliability, Dependencies, DNS, Cost) over precomputed analytics aggregates, with lens filters and Sankey/Toplist/StatDelta widgets.
  - Per-monitor detail pages with metric explorer, NHI timeline, and hop-path stepper.
  - Chatbot rework: follow-up suggestions, markdown rendering, diagnosis context.
  - Page enrichment: overview stat deltas + sparklines, flows strip, paths default content, agents coverage gauges + collection-cycle sparkline.
  - Workload Insights groundwork (per-category top contributors).
  - App version label in the sidebar, synced to this changelog via `app/src/lib/version.ts`.
- DNS insights tab loading skeleton (no more "logging disabled" flash during first load).

### Changed
- `app/package.json` version bumped to 1.0.0.

### Removed
- SnowUI footer attribution link from the app shell (the CC BY 4.0 design attribution remains in README.md).

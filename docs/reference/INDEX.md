# Implementation Reference Index / 구현 레퍼런스 인덱스

Layer-by-layer implementation reference docs for NFM Dashboard.
NFM Dashboard의 계층별 구현 상세 문서 목록.

<!-- AUTO-MANAGED:reference-index -->
| Layer | Doc | Scope |
|---|---|---|
| Infrastructure | [infrastructure.md](infrastructure.md) | CloudFront + ALB + ECS Fargate runtime, image build/deploy, ops alarms |
| Data | [data.md](data.md) | DynamoDB tables (`nfm-dashboard-flows`/`-meta`), collector write / app read paths, CloudWatch metrics |
| API | [api.md](api.md) | Next.js route handlers under `app/src/app/api/` |
| IaC | [iac.md](iac.md) | CDK stacks NfmDash-Data / Onboarding / AgentCore / App / Ops / Dns |
| Frontend | [frontend.md](frontend.md) | Next.js 16 App Router pages, i18n ko/en, data hooks |
| UI | [ui.md](ui.md) | Components, chart primitives, SnowUI design tokens |
| Security | [security.md](security.md) | Cognito auth, origin-verify, SigV4, network perimeter |
| Agent · LLM | [agent-llm.md](agent-llm.md) | Bedrock Converse + AgentCore gateway (MCP) chatbot |
<!-- /AUTO-MANAGED:reference-index -->

Last updated: 2026-07-14

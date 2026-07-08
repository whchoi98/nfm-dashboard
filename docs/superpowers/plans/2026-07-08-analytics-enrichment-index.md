# Analytics & Visual Enrichment — Master Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute each phase plan task-by-task. This index sequences 6 phase plans; each phase is independently deployable/testable and gets its own full plan document (written just-in-time before that phase executes, at the same rigor as Phase 1).

**Spec:** `docs/superpowers/specs/2026-07-08-analytics-enrichment-design.md`
**Base state:** NFM Dashboard already built + deployed (main branch, AppUrl https://dv4r4bnlhlpcx.cloudfront.net). 5 stacks live (NfmDash-Data/Onboarding/AgentCore/App/Ops). Full suite 80+ tests green.

## Why decomposed

The spec covers 6 loosely-coupled subsystems. Per writing-plans Scope Check, each becomes its own plan producing working, testable software on its own. They run in order because later phases consume earlier outputs (charts need the aggregation lib; hub needs charts + APIs; pages need everything).

## Phase sequence

| # | Plan | Delivers (deployable/testable) | Depends on | Plan file |
|---|---|---|---|---|
| 1 | Log enablement infra | Category 7종 확대(collector) + DNS 로그 활성화(Resolver+CoreDNS) + DNS 수집→`DNS#latest` | — | `2026-07-08-phase1-log-enablement.md` (written) |
| 2 | Aggregation lib + chart library | `app/src/lib/analytics/*` 순수함수(5 렌즈) + `/api/analytics/*` routes + `charts/*` 컴포넌트(신규 차트 12종) | 1 (categories, DNS#latest) | written before Phase 2 |
| 3 | Topology & path redesign | TierFlowMap + ResourceIcon + AdjacencyMatrix + HopPath(NetworkPathStepper, EKS 노드) + TopEdgesPanel | 2 (charts) | written before Phase 3 |
| 4 | Insights hub (5 tabs) + Datadog composition | `/insights` 5탭 허브 + FilterBar/Widget/HoverSync/Toplist + per-monitor 페이지 | 2,3 | written before Phase 4 |
| 5 | Chatbot rework | 단일 Markdown+구문강조, streamSSE/chatStream, 추천/후속 칩, 정지 버튼, 팝업 단순화, SSE followups | 2 (Markdown shared) | written before Phase 5 |
| 6 | Page enrichment + footer + deploy | 개요/플로우/경로/에이전트 풍성화, footer 제거, 최종 재빌드·재배포 + E2E | 2,3,4,5 | written before Phase 6 |

## Execution protocol

- Each phase runs on a fresh dev branch off `main` (`dev/analytics-phaseN`), subagent-driven, per-task spec+quality review, then finishing-a-development-branch → merge to `main` → redeploy where the phase changes runtime.
- After a phase merges, write the next phase's plan (it can reference the concrete signatures the previous phase actually produced — avoids drift).
- Ledger: `.superpowers/sdd/progress.md` (git-ignored) tracks per-task state across phases.

## Global Constraints (apply to ALL phases — copied verbatim from spec)

- Account `<ACCOUNT_ID>` / region `ap-northeast-2`. Existing VPC `vpc-0dfa5610180dfa628`. No new NAT/VPC endpoints.
- 모든 컨테이너/Lambda arm64. Next.js 16 + Tailwind v4(`@config`). React 19.
- LLM 모델 `global.anthropic.claude-sonnet-5` (fallback `global.anthropic.claude-sonnet-4-5-20250929-v1:0`).
- 리소스 접두사 `nfm-dashboard-`. 커밋 conventional commits.
- 모든 UI 문자열 `t()` 경유(ko/en 양쪽). SnowUI 토큰 유지, 테마-어웨어(라이트+다크). footer SnowUI 문구 제거(표기 README 유지).
- 앱 배포는 불변 SHA 태그 + `-c imageTag=<sha>`. 비-App cdk 명령은 `-c imageTag=unused`.
- 시크릿 커밋 금지. Cognito admin 비밀번호는 Secrets Manager `nfm-dashboard/cognito-admin`.
- 집계는 읽기 시점(최근 N버킷). NFM 카테고리 7종: `INTRA_AZ, INTER_AZ, INTER_VPC, UNCLASSIFIED, AMAZON_S3, AMAZON_DYNAMODB, INTER_REGION`.
- 비용 요율 상수 `AZ_TRANSFER_USD_PER_GB=0.01`. 신뢰성 임계 `DEFAULT_RETRANS_RATE=10`, `DEFAULT_TIMEOUT_RATE=5`(GB당).
- DNS 로그 활성화는 라이브 클러스터 ConfigMap 변경 + 과금 수반 → 가역적, 15분 로테이션 수집.

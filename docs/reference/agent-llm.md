# Agent · LLM / Agent · LLM 구현 상세

[![English](https://img.shields.io/badge/Language-English-blue)](#english)
[![한국어](https://img.shields.io/badge/Language-한국어-red)](#korean)

<a id="english"></a>
## English

### 1. Overview
The AI chatbot streams Bedrock Converse responses over SSE and lets the model call MCP tools exposed by a Bedrock AgentCore gateway (Python Lambda targets). The app calls the gateway server-side with SigV4 — no local MCP server is involved.

### 2. Components
| Component | Path | Purpose |
|---|---|---|
| Chat endpoint | `app/src/app/api/ai/route.ts` | SSE streaming Converse loop with MCP tool calls + follow-up suggestions |
| Bedrock client | `app/src/lib/bedrock.ts` | `MODEL_ID = global.anthropic.claude-sonnet-5`, fallback `global.anthropic.claude-sonnet-4-5-20250929-v1:0`; Converse/ConverseStream helpers |
| MCP client | `app/src/lib/mcp-client.ts` | SigV4-signed JSON-RPC 2.0 (streamable HTTP) client for the AgentCore gateway; tool-list cache (5 min TTL) |
| Gateway infra | `infra/lib/agentcore-stack.ts` | `NfmDash-AgentCore`: tool Lambdas (Python 3.13, arm64) + `nfm-dashboard-gateway-role` |
| MCP tool Lambdas | `tools/nfm_mcp.py`, `tools/ddb_mcp.py`, `tools/network_mcp.py` | Gateway targets querying NFM, DynamoDB, and network resources |
| Gateway setup | `scripts/setup-gateway.sh`, `tools/create_gateway.py` | Creates the gateway + targets; URL stored in SSM `/nfm-dashboard/gateway-url` (read via `app/src/lib/ssm.ts`) |
| Follow-ups | `app/src/lib/followups.ts` | Suggested follow-up question generation after each answer |

### 3. Key Decisions
<!-- TODO: list 3-5 decisions or link to docs/decisions/ADR-*.md -->

### 4. Code Pointers
<!-- TODO: 3-7 entries; paths must be valid (checked by /sync-docs) -->
- `app/src/app/api/ai/route.ts` — the agent loop: `listTools` → `toBedrockTools` → ConverseStream → `callTool` on tool_use blocks; 15s SSE keepalive; ko/en answer language
- `app/src/lib/bedrock.ts` — `isModelUnavailable()` decides when to retry with `FALLBACK_MODEL_ID`
- `app/src/lib/mcp-client.ts` — service `bedrock-agentcore`, region `ap-northeast-2`; TS port of awsops `streamable_http_sigv4.py`
- `tools/prompts/` — prompt assets for the gateway tools

### 5. Cross-references
<!-- TODO -->
- Related modules: `app/src/lib/CLAUDE.md`, `app/src/app/api/CLAUDE.md`, `infra/CLAUDE.md`
- Related ADRs:
- Related runbooks:

<a id="korean"></a>
## 한국어

### 1. 개요
AI 챗봇은 Bedrock Converse 응답을 SSE로 스트리밍하며, 모델이 Bedrock AgentCore 게이트웨이(Python Lambda 타깃)가 노출하는 MCP 툴을 호출할 수 있다. 앱은 게이트웨이를 서버 사이드에서 SigV4로 호출한다 — 로컬 MCP 서버는 사용하지 않는다.

### 2. 구성요소
| 구성요소 | 경로 | 목적 |
|---|---|---|
| 채팅 엔드포인트 | `app/src/app/api/ai/route.ts` | MCP 툴 호출 + 후속 질문 제안을 포함한 SSE 스트리밍 Converse 루프 |
| Bedrock 클라이언트 | `app/src/lib/bedrock.ts` | `MODEL_ID = global.anthropic.claude-sonnet-5`, 폴백 `global.anthropic.claude-sonnet-4-5-20250929-v1:0`; Converse/ConverseStream 헬퍼 |
| MCP 클라이언트 | `app/src/lib/mcp-client.ts` | AgentCore 게이트웨이용 SigV4 서명 JSON-RPC 2.0(streamable HTTP) 클라이언트; 툴 목록 캐시(TTL 5분) |
| 게이트웨이 인프라 | `infra/lib/agentcore-stack.ts` | `NfmDash-AgentCore`: 툴 Lambda(Python 3.13, arm64) + `nfm-dashboard-gateway-role` |
| MCP 툴 Lambda | `tools/nfm_mcp.py`, `tools/ddb_mcp.py`, `tools/network_mcp.py` | NFM·DynamoDB·네트워크 리소스를 조회하는 게이트웨이 타깃 |
| 게이트웨이 셋업 | `scripts/setup-gateway.sh`, `tools/create_gateway.py` | 게이트웨이 + 타깃 생성; URL은 SSM `/nfm-dashboard/gateway-url`에 저장(`app/src/lib/ssm.ts`로 조회) |
| 후속 질문 | `app/src/lib/followups.ts` | 답변 후 후속 질문 제안 생성 |

### 3. 주요 결정
<!-- TODO: 3-5개 결정 나열 또는 docs/decisions/ADR-*.md 링크 -->

### 4. 코드 포인터
<!-- TODO: 3-7개 항목; 경로는 실재해야 함 (/sync-docs가 점검) -->
- `app/src/app/api/ai/route.ts` — 에이전트 루프: `listTools` → `toBedrockTools` → ConverseStream → tool_use 블록에 `callTool`; 15초 SSE keepalive; 한/영 응답 언어
- `app/src/lib/bedrock.ts` — `isModelUnavailable()`이 `FALLBACK_MODEL_ID` 재시도 여부 결정
- `app/src/lib/mcp-client.ts` — 서비스 `bedrock-agentcore`, 리전 `ap-northeast-2`; awsops `streamable_http_sigv4.py`의 TS 포팅
- `tools/prompts/` — 게이트웨이 툴용 프롬프트 자산

### 5. 상호 참조
<!-- TODO -->
- 관련 모듈: `app/src/lib/CLAUDE.md`, `app/src/app/api/CLAUDE.md`, `infra/CLAUDE.md`
- 관련 ADR:
- 관련 런북:

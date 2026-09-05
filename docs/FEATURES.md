# WeKnora Feature Catalog

WeKnora is an open-source knowledge framework (v0.7.2) for turning scattered documents into a queryable, reasoning-capable knowledge asset. This document explains every product capability: what it is for, how it works from a user's point of view, and where it lives in the product.

For API details, environment variables, and source-level design, use the official docs in [`website-docs/`](../website-docs/README.md). For a short product overview, see the [README](../README.md).

---

## 1. What WeKnora does

The product is built around three ways to use knowledge:

| Mode | What it does | When to use it |
| --- | --- | --- |
| **Quick Q&A (RAG)** | Retrieves relevant passages and answers in one pass, with citations | Everyday lookups whose answer is already in the documents |
| **ReAct Agent** | Plans multi-step work: retrieve, grep, search the web, call MCP tools, analyze tables, then answer | Comparisons, multi-document reasoning, live information, tool-backed tasks |
| **Wiki Mode** | Distills uploaded documents into an interlinked Markdown encyclopedia with a graph view, manual edit, and rollback | Large, messy corpora where people need a browsable knowledge site, not only chat |

Around those three modes sit ingestion, retrieval, multi-workspace RBAC, IM and website publishing, and a fully self-hostable stack.

---

## 2. Workspaces, people, and access

A person (user) can belong to several **workspaces** (tenants). Knowledge bases, models, agents, sessions, and storage quota all belong to one workspace. Workspaces do not see each other's data unless they share through an **organization**.

### Roles inside a workspace

| Role | What they can do |
| --- | --- |
| **Viewer** | Read and ask questions |
| **Contributor** | Create knowledge bases and upload documents |
| **Admin** | Manage members, models, integrations, and workspace settings |
| **Owner** | Everything Admin can do, plus delete the workspace and transfer ownership |

Resources such as knowledge bases also have **ownership**. Deleting a workspace removes its knowledge bases, agents, sessions, and memberships and cannot be undone.

### How people and programs sign in

- **Password login** for the Web UI
- **OIDC** single sign-on
- **Workspace API keys** (`X-API-Key`) for programs, with capability grants (`retrieve`, `chat`, `ingest`, `manage_kbs`, `manage_models`, …) and an optional knowledge-base allow-list
- **Platform API keys** for control-plane automation (tenants, system settings, queues, audit) — system-admin only

Registration can be open, invite-only, or disabled. Workspaces can be invite-only. Self-service workspace creation can be gated.

### Organizations (shared space)

An organization is a collaboration layer across workspaces. Add two workspaces to the same organization, then share a knowledge base or an agent into that organization. Organization roles are `admin` / `editor` / `viewer`.

### Platform administrators

Workspace Owner and **system admin** are different jobs:

| | Workspace Owner | System admin |
| --- | --- | --- |
| Scope | One workspace | The whole deployment |
| Typical work | Members, models, KBs, integrations, workspace audit | Global settings, task queues, platform API keys, cross-workspace audit, password reset |

The first system admin is bootstrapped with `WEKNORA_BOOTSTRAP_SYSTEM_ADMIN_EMAIL` after that account already exists. Later promote/revoke happens in the UI. You cannot revoke yourself or the last remaining admin.

A third flag, **cross-workspace superuser** (`CanAccessAllTenants`), controls whether someone can read other workspaces' data. System admin does not imply that.

---

## 3. Knowledge bases and documents

A knowledge base is the unit of organization. It holds related material and decides how that material is chunked, which embedding model indexes it, and whether Wiki / graph indexes are generated.

### Knowledge-base types

| Type | Purpose |
| --- | --- |
| **Document** | Default. Files, URLs, handwritten Markdown |
| **FAQ** | Standard question + similar questions + negative questions + answers. Retrieval matches questions, not document passages |
| **Wiki** | Same documents, plus an auto-generated encyclopedia (see [Wiki](#8-wiki-mode)) |

Different libraries can use different chunking, models, and retrieval settings. Questions can be scoped to one or more libraries. Sharing and permissions are also per library.

### Getting documents in

- Upload files (single or whole folders; folder layout is kept)
- Import a URL
- Write Markdown by hand
- Auto-sync from a [data source](#10-data-source-sync)
- Send a file to an IM bot that is bound to a knowledge base

Supported formats:

| Category | Formats |
| --- | --- |
| Documents | PDF, Word (doc/docx), PPT (ppt/pptx), Excel (xls/xlsx), EPUB |
| Text | txt, Markdown, CSV, JSON |
| Web | Live URL crawl, local HTML / MHTML |
| Images | jpg, png, gif, bmp, tiff, webp (needs a vision model) |
| Audio | mp3, wav, m4a, flac, ogg (needs an ASR model) |

### Folder tree

Folder uploads keep their original directory structure. The document list has a sidebar tree: browse, rename folders, and move documents into another folder. Upload paths are stored as first-class data, not just a display trick.

### Tags, metadata, and batch work

- Multiple tags per document; batch tagging with common tags pre-selected
- Custom document metadata (department, classification, …)
- Marquee / multi-select for batch reparse and batch tagging
- Duplicate a whole knowledge base, or move documents to another library
- Per-knowledge-base **activity trail** (who changed what)

### Chunk editing and revision history

Retrieval chunks can be edited in the UI like documents:

- Per-version snapshots
- Diff and one-click rollback
- Automatic reindexing after an edit
- Generated questions can be added, edited, deleted, or regenerated

If a paragraph was split wrongly, fix the chunk instead of re-uploading the file.

### Per-upload process configuration

Each upload batch can override parser, chunking, multimodal (VLM / ASR), graph extraction, and question generation — from the upload-confirm dialog or the `process_config` API. Existing documents can be reparsed with new settings, including in batch.

### Quotas and pinning

Each workspace has a storage quota (default 10 GB). Knowledge bases can be pinned in the UI. Vector-store binding is fixed at create time so indexes do not drift.

---

## 4. Document parsing

`docreader` is a separate Python gRPC service. It turns files and URLs into Markdown plus raw image references. The Go app then chunks, stores images, runs OCR / VLM captions, and builds indexes.

### Parser engines

Per file type you can pick an engine:

- Built-in
- MarkItDown
- OpenDataLoader / Docling hybrid
- MinerU (when configured)

Typical knobs:

- Poor PDF layout or broken tables → switch the PDF engine
- Scanned pages with no text → configure a vision model, or force scanned mode
- Excel first row is headers → turn on “first row as header”

Parsing is asynchronous. Status goes `pending → processing → finalizing → completed` (or `failed` / `cancelled`). A Langfuse-style **parse trace timeline** shows stage-by-stage progress and lets you stop a parse.

---

## 5. Chunking

Chunking decides how documents become retrieval units. Defaults (512 characters, 80 overlap, adaptive strategy) work for most libraries.

| Situation | What to change |
| --- | --- |
| Answers are incomplete / cut off | Increase `chunk_size`, or enable parent-child chunking (search children, answer from parent) |
| Hits are off-topic | Decrease `chunk_size` so each chunk is more focused |
| FAQ / dictionary / parameter tables | Set overlap to 0 |
| Long narrative (reports, papers) | Overlap 150–200 |
| Want to see the cut before committing | `POST /api/v1/chunker/preview` (does not persist) |

Strategies: `auto`, `heading`, `heuristic`, `recursive` / `legacy`. Changing chunk settings only applies after documents are reparsed.

Chunk types include text, parent text, image OCR, image caption, FAQ, graph entity / relationship, table summary / column, wiki page, and web-search snippets.

---

## 6. Retrieval and indexes

A knowledge base can turn on four index pipelines independently:

| Index | Default | Role |
| --- | --- | --- |
| Vector (dense) | On | Semantic similarity |
| Keyword / BM25 | On | Exact terms, IDs, names |
| Wiki | Off | Generated encyclopedia pages |
| Knowledge graph | Off | Entities and relations (needs Neo4j) |

Query-time retrieval is **hybrid**: vector + BM25, fused with RRF (default vector weight 0.7, keyword 0.3), then optional **rerank**. Query rewrite / expansion and intent classification (greeting, chitchat, web search, …) sit in front of retrieval.

Workspace-level knobs include embedding top-K, vector / keyword thresholds, rerank top-K and threshold.

### Vector stores

Most deployments keep the default: **PostgreSQL / ParadeDB** (pgvector + BM25 in the same database, including HNSW for 1024-dim embeddings). Other engines:

| Engine | Typical reason to pick it |
| --- | --- |
| PostgreSQL (ParadeDB) | Default; lowest ops cost |
| SQLite | Lite / desktop, no extra database |
| Elasticsearch / OpenSearch | Reuse an existing search cluster |
| Qdrant / Milvus / Weaviate | Large-scale vectors, independent scale-out |
| Apache Doris / Tencent VectorDB | Existing warehouse / Tencent stack |
| Neo4j | Graph storage only (not a general vector store) |

You can register **multiple vector-store instances** and bind them per knowledge base. Cross-KB search fans out across stores (up to 4 groups). Changing the bound store after create is not allowed.

FAQ libraries search FAQ vectors. Document libraries search default vectors plus keywords.

---

## 7. Chat and conversation experience

### Two conversation modes

Switch at the top of the chat:

| Mode | Fit | Cost |
| --- | --- | --- |
| **Quick answer** | Facts already in the documents | One retrieval pass; fast and cheap |
| **Smart reasoning (Agent)** | Multi-step, cross-document, web, or tools | Several model calls; slower and more expensive |

### What you see in a turn

- Pipeline progress (attachment parse, image understanding, retrieval, web, tools, thinking, generation)
- Foldable thinking / tool-call timeline in Agent mode
- Inline citation markers that jump to the original chunk
- References drawer (KB vs web vs Wiki tool results)
- Suggested opening questions and follow-ups after an answer
- One-click Markdown export of the session

Citation markers in the answer body can be turned off per agent. The references drawer still lists sources.

### Session-scoped temporary attachments

Drop an image or document into the chat without adding it to a knowledge base. Parsing is async. Attachments expire (default 24 hours) and never enter the library index. Combined image + attachment limits apply. For lasting retrieval, upload into a knowledge base.

### Session management

- Multi-turn context with sliding-window or LLM-summary compression
- Last-request state (agent, model, KB scope, web search, MCP) is restored when you reopen a session
- Sidebar filter by source: Web / IM / Embed / API
- Inline rename; search and pin sessions
- Cross-session message-history search (Admin setting + `message_history` API capability)
- IM / embed / API sessions are hidden from ordinary members; workspace Admin+ can inspect them read-only

`@` mentions can scope a turn to knowledge bases, documents, tags, MCP services, or skills.

---

## 8. Wiki Mode

Wiki turns a pile of documents into a browsable, interlinked Markdown site.

1. Edit the knowledge base → turn on **Wiki** in indexing strategy
2. Upload (or wait; existing documents are included)
3. Generation is async; density is `focused` / `standard` / `exhaustive`
4. Browse the **Wiki** tab; use the **Graph** tab for page links

### Page types

| Type | Meaning |
| --- | --- |
| `summary` | One page per source document |
| `entity` | Person, org, product, technology, … |
| `concept` | Theme / idea |
| `index` | Wiki-level index |
| `synthesis` / `comparison` | Created only by Agent write tools |

Folders are up to three levels deep. Pages have slugs, aliases, in/out wiki-links, source and chunk citations.

### Human editing

- Edit pages in the browser
- Revision snapshots, line-level diff, one-click rollback
- Flag issues (`mixed_entities`, `contradictory_facts`, `out_of_date`, …) for a maintenance loop
- Wiki ingest scales to large libraries via a dedicated task pool and dead-letter queue

Agents treat the wiki as long-term memory: search pages, read them, read the source document, write / replace / rename / delete pages, and manage issues.

---

## 9. Agents, tools, and skills

Besides the two chat modes, you can create **custom agents** (or use built-ins) and bind them to the Web UI, IM channels, or embed widgets.

### Built-in agents

| ID | Role |
| --- | --- |
| `builtin-quick-answer` | Classic RAG; FAQ-first; query rewrite; optional web search |
| `builtin-smart-reasoning` | ReAct over knowledge search, grep, graph, document info |
| `builtin-data-analyst` | SQL over CSV / Excel in DuckDB; no web search |
| `builtin-wiki-researcher` | Read-only wiki navigation + issue flagging |
| `builtin-wiki-fixer` | Internal wiki editor (write / rename / delete); not shown in the user agent list |

Custom agents pick mode, model, knowledge-base scope, web search, MCP tools, skills, prompts, timeout, citation toggle, and attachment rules. Agent types: `rag-qa`, `wiki-qa`, `hybrid-rag-wiki`, `data-analysis`, `custom`.

### Built-in tools (smart-reasoning)

**Thinking and planning:** `thinking` (sequential thinking with revision/branch), `todo_write` (retrieval plan).

**Knowledge:** `knowledge_search` (hybrid semantic search), `grep_chunks` (regex over chunks), `list_knowledge_chunks`, `query_knowledge_graph`, `get_document_info`, `database_query` (read-only SQL on whitelist tables, tenant-scoped).

**Tables:** `data_schema`, `data_analysis` (CSV / Excel → DuckDB SQL).

**Web:** `web_search` (KB-first), `web_fetch` (SSRF-safe fetch + LLM summary).

**Skills:** `read_skill`, `execute_skill_script` (sandboxed).

**Wiki:** `wiki_search`, `wiki_read_page`, `wiki_read_source_doc`, `wiki_write_page`, `wiki_replace_text`, `wiki_rename_page`, `wiki_delete_page`, `wiki_flag_issue`, `wiki_read_issue`, `wiki_update_issue`.

MCP tools register into the same toolbox. Dangerous tools can require **human-in-the-loop approval**. OAuth MCP services can complete login mid-conversation.

### Agent Skills

Skills are `SKILL.md` packages (progressive disclosure: name → full instructions → files/scripts). Scripts run in a **Docker or local sandbox**. Preloaded skills include document analysis, citation generation, data processing, and others under `skills/preloaded/`. The CLI also ships bundled skills.

---

## 10. MCP (both directions)

### WeKnora as MCP client

Settings → MCP services → add a remote server (SSE / Streamable HTTP / stdio). Auth: API key, Bearer, or OAuth 2.0 (dynamic client registration + PKCE). Tools appear in the agent toolbox. Per-tool approval and mid-conversation OAuth are supported. Credentials are encrypted at rest.

### WeKnora as MCP server

PyPI package `tencent-weknora-mcp` (`weknora-mcp-server`) exposes **29 tools** over stdio / SSE / HTTP: knowledge bases, ingest (including create-from-text), search, sessions, agent chat, wiki, and shared libraries. Use it from Claude Desktop, VS Code Copilot, or `weknora mcp serve`.

---

## 11. Knowledge graph (GraphRAG)

Vector search finds similar passages. A graph answers “how are A and B related?”

On ingest, an LLM extracts entities and relations (strength 1–10) into **Neo4j** (APOC required). At query time, graph neighbors expand the retrieved set.

Both switches must be on:

1. Deployment: `NEO4J_ENABLE=true` (compose profile `neo4j`)
2. Knowledge base: indexing strategy **Graph** + extract config

Cost is extra LLM calls on ingest. Skip it for ordinary FAQ-style Q&A.

---

## 12. FAQ libraries

For answers that should be stable (return policy, expense process, known errors), use an FAQ knowledge base instead of hoping document RAG hits the right paragraph.

Each entry is:

- Standard question
- Similar questions
- Negative questions (hits are filtered out)
- One or more answers (`all` or `random` strategy)
- Tag, enable/disable, recommended flag

Bulk import from Excel / CSV with dedup. Filter, tag, export, and track imports. An agent can search FAQ and document libraries together: standard answer first, documents if nothing matches.

---

## 13. Models

Five model kinds, mixed freely (for example local embeddings + remote chat):

| Type | Used for |
| --- | --- |
| **KnowledgeQA (chat)** | Q&A, agent reasoning, summarization, question generation, graph extract |
| **Embedding** | Index and query vectors — do not swap after indexing without rebuild |
| **Rerank** | Re-order retrieved passages |
| **VLM** | Image / scanned-page understanding |
| **ASR** | Audio transcription |

Per-model thinking mode, embedding dimension override, timeout, and concurrency governors. Built-in models can be declared in YAML and shared across workspaces. An interactive **model test debugger** checks connectivity before you save. WeKnora Cloud can host models and parsing.

### Providers

OpenAI, Azure OpenAI, Anthropic, DeepSeek, Qwen (Alibaba), Zhipu, Hunyuan, Doubao (Volcengine), Gemini, MiniMax, NVIDIA, Novita, SiliconFlow, OpenRouter, Requesty, Moonshot, ModelScope, Qianfan, Qiniu, Jina, MiMo, LongCat, Tencent LKEAP, GPUStack, WeKnora Cloud, generic OpenAI-compatible, and **Ollama** locally.

Embeddings include BGE / GTE-style local models via Ollama. Rerank has dedicated adapters for Aliyun, Zhipu, Jina, NVIDIA, LKEAP, Volcengine (batched), and WeKnora Cloud.

---

## 14. Data-source sync

Bind an external account to a knowledge base (library settings → Data sources). First sync is full; later syncs are incremental by modification time. Deletes on the source can take documents down in WeKnora.

| Connector | Notes |
| --- | --- |
| Feishu wiki | Large wikis stream with checkpointed cursors |
| Feishu Drive | Files and docx via the blocks API |
| Lark | Same adapter as Feishu, international domain |
| Notion | Pages and databases |
| Yuque | Knowledge bases / books |
| RSS | Feed ingest |

Credentials are AES-encrypted. Cron schedule and conflict policy are per connection. Types such as Confluence / GitHub / IMAP exist as constants but are not wired yet.

---

## 15. Web search

When the library is not enough, agents can `web_search` and `web_fetch`. Policy is KB-first: search documents before going to the open web.

Engines: DuckDuckGo (no key), Bing, Google, Tavily, Baidu, Ollama, SearXNG (self-host compose profile), Keenable, Zhipu AI.

`web_fetch` uses an SSRF-safe client (DNS pinning, redirect checks) and optional browser render. Results can be RAG-compressed into a session-level temporary knowledge base.

---

## 16. Instant-messaging channels

Publish an agent into the chat tool people already use. Settings → IM → create channel → credentials → bind an agent → enable.

| Platform | Typical connect mode | Streaming | File download |
| --- | --- | --- | --- |
| WeCom | WebSocket (long-lived) or webhook | WS only | Yes |
| Feishu / Lark | WebSocket or webhook | Yes | Yes |
| Slack | Socket Mode or Events API | Yes | Yes |
| Telegram | Long-poll or webhook | Yes | Yes |
| DingTalk | Stream or webhook | Yes (AI card) | Yes |
| Mattermost | Webhook | Yes | Yes |
| WeChat (iLink) | Long-poll | No | Yes |
| QQ Bot | WebSocket | No | No |
| Yunzhijia | Webhook / WebSocket | No | Yes |

Also: slash commands, quote-reply / thread sessions, file-to-KB ingest, markdown / image replies, a QA queue so bursts do not stampede the model, and workspace-wide channel overview.

Webhook mode needs a public callback URL. WebSocket / long-poll modes do not. Multi-instance deployments elect one leader per channel so only one process holds the long connection.

---

## 17. Website embed widget

Add a “ask the docs” widget to a help center or marketing site. Visitors do not need a WeKnora account.

Settings → Website embed → bind an agent → origin allow-list → copy the `<script>`.

Configurable: welcome message, theme color, widget position, suggested questions, web search, file upload, locale, per-IP and per-channel rate limits, and an optional signed webhook. **Secure mode** exchanges a short-lived token so the publish token is not used as a chat credential. Integrations Center groups these publish surfaces.

---

## 18. Object storage and file URLs

Original files, extracted images, and exports live on object storage. A workspace can register **several storage instances**, pick a default, and bind a knowledge base to a specific instance (compliance, billing, or migration).

Providers: local disk, MinIO, AWS S3 (including IAM Role / IRSA default chain), Tencent COS, Alibaba OSS, Volcengine TOS, Kingsoft KS3, Huawei OBS.

Connectivity test writes and reads before you save.

### How files are exposed

Documents do not embed raw storage paths. Outbound URLs come in four forms:

| Form | Who can load it |
| --- | --- |
| `resource://…` handle | Server-side only |
| Authenticated proxy (`/files`, KB or embed file routes) | Logged-in user / KB access / embed token |
| Capability short link `/r/<token>` | Anyone with the link (about 2 hours) |
| Storage presigned URL | Anyone with the link (storage TTL) |

Web UI rewrites handles to the auth proxy. IM bots need a publicly reachable storage or `APP_EXTERNAL_URL` + `/r/` proxy, or images break. REST clients can pass `resource_urls=public` (or `RESOURCE_URL_MODE`) to get loadable URLs without a second authenticated hop.

---

## 19. Evaluation

Change embedding, rerank, or chunk size and measure whether quality improved. Evaluation is **API-only** (`POST /api/v1/evaluation`, poll `GET`). Admin (or API key `RunEvaluations`).

It builds a temporary knowledge base from a Parquet QA dataset, runs retrieve + generate per question, and reports retrieval metrics (Precision, Recall, NDCG, MRR, MAP) and generation metrics (BLEU, ROUGE). Change one variable at a time on a fixed dataset.

---

## 20. Observability, audit, and tasks

| Question | Where to look |
| --- | --- |
| Why was this answer slow or wrong? | Langfuse trace (retrieve, rerank, generate, tools, tokens, prompt cache) |
| Who changed a KB, member, or setting? | KB activity + Settings → Audit log |
| Are parse / wiki / summary jobs stuck? | Settings → Runtime queues (system admin) |
| Is the process alive? | `GET /health` |
| How do I join logs across services? | `X-Request-ID` |

Langfuse is the tracing backend (OTLP / OTel, W3C `traceparent` on async jobs). Document parse has a built-in span tree even without opening Langfuse.

### Task queues

Ingest, post-process, enrichment, maintenance, and Wiki run on Asynq (Redis). Per-stage worker pools plus an elastic shared pool, per-model concurrency governors, dead-letter inspection, and manual retry. Lite mode has no async queue panel.

Database migrations run automatically on upgrade.

---

## 21. Security (product-facing)

- AES-256-GCM at rest for API keys and MCP / data-source credentials, with key rotation
- gRPC TLS + token between app and docreader
- Redis TLS
- SSRF-safe HTTP client on data sources, URL import, web fetch, and redirect chains
- Secret redaction in API responses and logs
- Sandbox isolation for skill scripts
- IDOR checks on vector stores and shared resources
- Scoped API keys isolated from JWT users; MCP OAuth and embed sessions isolated per principal
- Admin password reset revokes all of that user's sessions

Production advice from the project: run on a private network; do not expose the UI/API raw to the public internet.

---

## 22. Clients and ways to talk to WeKnora

| Client | What it is for |
| --- | --- |
| **Web UI** | Vue 3 console: libraries, chat, agents, settings, wiki, graph |
| **REST API** | ~360 endpoints under `/api/v1`; JWT, API key, or OIDC; SSE for streaming chat |
| **`weknora` CLI** | Agent-first CLI: JSON envelope by default, profiles, `kb` / `doc` / `chat` / `search`, `mcp serve`, bundled skills, `--dry-run`, typed exit codes. CI: `WEKNORA_API_KEY` + `WEKNORA_HOST` |
| **Go SDK** | ~170 methods, streaming chat |
| **Chrome extension** | Clip selected text, images, or pages into a knowledge base; sidebar Q&A |
| **WeChat Mini Program** | Configure API access, pick a KB, import URLs, chat from WeChat |
| **ClawHub Skill** | Import (file / URL / Markdown), hybrid search, manage entries via the REST API |
| **Website embed** | Anonymous visitor widget ([§17](#17-website-embed-widget)) |
| **IM bots** | Ten platforms ([§16](#16-instant-messaging-channels)) |
| **MCP server** | 29 tools for external agents ([§10](#10-mcp-both-directions)) |
| **WeChat Dialog Open Platform** | Zero-code Q&A inside Official Accounts and Mini Programs |
| **Desktop / Lite** | Single binary, no extra services; localhost by default; not a full multi-workspace product |

Helm chart and Docker Compose (profiles: `full`, `neo4j`, `minio`, `langfuse`, `searxng`, …) cover standard self-host. Fast dev mode: `make dev-start` / `dev-app` / `dev-frontend`.

---

## 23. Lite vs standard

| | Lite | Standard |
| --- | --- | --- |
| Collaboration | No shared space, no invites | Multi-workspace, orgs, RBAC |
| Accounts | Single workspace, no registration | Register / login / orgs |
| Parsing | Built-in Simple engine; Cloud parsers optional | Full engine matrix |
| Deploy | One process, no Postgres/Redis stack | Compose / Helm, more services |
| Network | Localhost by default | Whatever you bind |

Use Lite to try the product on a laptop. Use standard when you need teams, full parsers, IM, queues, and graph.

---

## 24. Feature map (quick lookup)

| Area | Capabilities |
| --- | --- |
| Conversation | Quick RAG Q&A, ReAct agent, wiki chat, citations, RAG progress, suggested questions, temp attachments, Markdown export, session search/pin/rename, source filters, `@` scope |
| Knowledge | Document / FAQ / Wiki libraries, folder tree, tags, custom metadata, chunk edit + history, per-upload process config, batch reparse/tag, duplicate/move, activity, quotas |
| Understanding | Multi-engine parse, OCR, VLM captions, ASR, Excel header mode, HTML/MHTML/EPUB, parse timeline + cancel |
| Index / retrieve | Adaptive + parent-child chunking, vector + BM25 + RRF + rerank, GraphRAG, Wiki index, question generation, multi-store fan-out, 10 vector backends |
| Agents | Custom + 5 built-ins, 24 built-in tools, MCP tools, skills + sandbox, HITL approval, mid-chat OAuth, data analyst, wiki researcher/fixer |
| Wiki | Auto pages, folders, graph, edit, revision/rollback, issues, agent read/write |
| FAQ | Standard/similar/negative questions, import/export, tags, clone sync |
| Ingest sync | Feishu wiki & Drive, Lark, Notion, Yuque, RSS |
| Publish | 10 IM platforms, embed widget, Chrome clipper, Mini Program, CLI, MCP, ClawHub, WeChat Dialog |
| Models | 5 types, 20+ providers, Ollama, YAML built-ins, test debugger, thinking mode, Cloud hosted |
| Search the web | 9 engines + SSRF-safe fetch + SearXNG |
| Storage | Multi-instance backends, per-KB bind, public or proxied file URLs |
| Access | 4-tier RBAC, ownership, orgs, OIDC, scoped + platform API keys, audit |
| Ops | Langfuse, queue dashboard, worker pools, evaluation API, health, Helm/Compose/Lite |

---

## Related documents

| Topic | Location |
| --- | --- |
| Official docs site (all of the above in depth) | [`website-docs/`](../website-docs/README.md) |
| Installation and profiles | [`website-docs/01-getting-started/02-installation.md`](../website-docs/01-getting-started/02-installation.md) |
| Per-feature design + source index | [`website-docs/03-features/`](../website-docs/03-features/) |
| API (~360 endpoints) | [`website-docs/04-api/`](../website-docs/04-api/01-api-overview.md) and [`docs/api/`](./api/README.md) |
| CLI | [`cli/README.md`](../cli/README.md) |
| Lite | [`docs/LITE.md`](./LITE.md) |
| RBAC | [`docs/RBAC说明.md`](./RBAC说明.md) |
| Roadmap | [`docs/ROADMAP.md`](./ROADMAP.md) |
| FAQ / troubleshooting | [`docs/QA.md`](./QA.md) |

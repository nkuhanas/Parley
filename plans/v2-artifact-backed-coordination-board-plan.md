# Parley v2 Artifact-Backed Coordination Board Plan

Status: draft
Authority: migration-plan
Owner: Kairos operator
Scope: Parley v2 object/effect/obligation layer and artifact storage strategy
Date: 2026-04-30
Depends on:
- `docs/mvp-thread-protocol-spec.md`
- `plans/mvp-implementation-plan.md`
- `docs/operator-orchestrator-integration-contract.md`

## 1. Purpose

Define the migration path from Parley's MVP thread-first runtime to a durable artifact-backed coordination board.

The current MVP correctly established Parley as the canonical owner of protocol-managed threads, messages, turn control, transport correlation, and settlement semantics. Live Kairos usage has now shown the next missing layer: durable coordination objects that survive compaction and make agent obligations recoverable without rereading entire threads.

Parley v2 should preserve the working thread runtime and add a higher-level coordination model above it:

```txt
coordination object -> effect -> obligation -> projection
                         ^
                         |
                    source thread/message
```

Threads remain the provenance and delivery substrate. They should stop being the only operational source of truth.

## 2. Non-Goals

Parley v2 must not become:

- the Kairos content pipeline
- a replacement for Kairos task queues
- a publishing, analytics, generation, or cron executor
- a broad project-management application
- a general memory layer for all agent context
- an autonomous architecture-change executor
- a new plugin that duplicates the existing Parley implementation

Rule:

> Parley owns work only when that work exists because of multi-agent coordination, review, ratification, deferral, approval, objection, or handoff.

## 3. Current State

### 3.1 Runtime implementation

The current Parley implementation lives under:

- `src/`

Current runtime state defaults to:

- `.kairos-runtime/parley/threads/<thread_id>.json`
- `.kairos-runtime/parley/messages/<thread_id>/<message_id>.json`
- `.kairos-runtime/parley/index/*.json`

The current runtime root is configurable through `parleyRuntimeRoot`; otherwise it resolves to the Kairos repo-local `.kairos-runtime/parley/` path. `.kairos-runtime/` is gitignored.

This is appropriate for protocol state. It is not appropriate as the default home for authored plan/spec bodies that should be reviewed, versioned, linked from canon, or committed.

### 3.2 Canonical docs

Current Parley design docs are stored in the Kairos repo under:

- `docs/`

That is correct for Kairos-specific canonical plans, specs, and contracts. It should not become the only possible artifact landing location for a general Parley runtime.

## 4. Design Decision

Parley v2 should separate three storage concerns:

1. **Runtime state**: protocol and board records owned by Parley.
2. **Artifact bodies**: plan/spec/decision documents authored or managed by a project, repo, or external system.
3. **Artifact references**: Parley-owned records that bind coordination objects to artifact bodies, versions, hashes, status, and provenance.

Parley should own artifact references, not necessarily artifact bodies.

### 4.1 Board model and Kairos as one board

Parley v2 should be board-oriented, not Kairos-oriented.
A board is the namespace that binds agents, plans, threads, artifacts, defaults, and projections together.
A board id should be a stable lowercase slug; display casing belongs in `display_name` or explicit path config.
Kairos is one board; Parley should be able to manage other boards with different agents and storage rules.

Minimal board record:

```yaml
board:
  board_id: kairos
  display_name: Kairos
  status: active
  board_root: ~/.local/share/parley/boards/kairos
  state_root: ~/.local/share/parley/boards/kairos/state
  managed_artifact_root: ~/.local/share/parley/boards/kairos/artifacts
  plan_extension: .md
  artifact_namespaces:
    - id: project_plans
      roles:
        - plan_landing
        - explicit_landing
        - reference
      default_for:
        - plan_landing
      uri_prefix: repo://plans/
      resolved_root: ~/workspace/Kairos/plans
      allowed_subpaths:
        - agent-comms/parley
        - architecture/generation
        - architecture/system
        - architecture/tools
        - architecture/ui
        - architecture/workspaces
    - id: project_docs
      roles:
        - explicit_landing
        - reference
      uri_prefix: repo://docs/
      resolved_root: ~/workspace/Kairos/docs
    - id: project_vault
      roles:
        - reference
      uri_prefix: vault://
      resolved_root: ~/workspace/Kairos/vault
  allowed_reference_namespaces:
    - project_plans
    - project_docs
    - project_vault
  permission_model:
    mode: board_wide_all_tools
    future_agent_scoping: true
  agent_registry:
    - board_agent_id: kairos-operator
      display_name: Kairos Operator
      kind: agent
      runtime_refs:
        - scheme: openclaw
          type: agent
          id: kairos-operator
        - scheme: openclaw
          type: session
          id: kairos-operator:discord
        - scheme: openclaw
          type: session
          id: kairos-operator:webchat
      roles:
        - implementation
        - runtime
      permissions:
        preset: board_admin
    - board_agent_id: kairos-orchestrator
      display_name: Kairos Orchestrator
      kind: agent
      runtime_refs:
        - scheme: openclaw
          type: agent
          id: kairos-orchestrator
      roles:
        - orchestration
        - planning
      permissions:
        preset: board_admin
```

Board responsibilities:

- define the namespace for object, artifact, thread, obligation, and checkpoint ids
- map runtime identities to board-local agent identities
- declare one board root that owns Parley-managed state and managed artifacts for that board
- declare board-level artifact namespaces, landing defaults, and link policy
- declare allowed artifact reference namespaces for the board
- own board-level projections such as `where_am_i` and board views
- keep board-specific policy outside Parley core logic

Parley core should provide the board machinery. The Kairos board config should provide Kairos-specific roots, agents, and defaults.

For the MVP, a runtime identity should map to exactly one default board. After that mapping succeeds, normal Parley commands should infer the board from the caller instead of requiring `board_id` on every call. `where_am_i` should therefore derive the board and board-local agent from the caller identity, then return board-specific values. Explicit `board_id` can remain an advanced/debug override, not the normal path.

Board root rule:

> Parley-managed state and Parley-managed artifact bodies for a board should live under the same board root.

This avoids splitting board records under one tree and managed artifacts under another. Repo or vault paths may still be used as explicit landing/reference roots, but those are project-owned artifact locations, not Parley-managed board storage.

Namespace and root meanings:

- `board_root`: the parent root for one board's Parley-owned state and managed artifacts. Parley reads and writes here.
- `state_root`: Parley-owned protocol/object/effect/obligation/index records for the board. Agents should normally access it through Parley tools, not edit it directly.
- `managed_artifact_root`: Parley-owned artifact bodies created when no explicit landing namespace is supplied. Parley reads and writes here as the tool invoked by the caller.
- `artifact_namespaces`: board-declared project or Parley artifact locations. A namespace may resolve to a filesystem root, repo URI prefix, vault ref prefix, hosted document space, or another project-defined resolver. Roles describe how Parley may use the namespace, such as `reference`, `plan_landing`, or `explicit_landing`.
- `allowed_reference_namespaces`: the board's link policy for Parley artifacts. It defines which namespaces plan bodies and artifact references may link to, so Parley can validate links without assuming Kairos-specific filesystem structure. This replaces the narrower `allowed_reference_roots` name.
- `roles: [reference]`: Parley may register, validate, hash, or inspect refs in that namespace when the board policy and caller permissions allow it. This is not a general agent permission model and does not replace first-class project tooling.
- `roles: [explicit_landing]`: Parley may write artifact bodies into that namespace when the caller requests explicit landing and the destination validates against the namespace policy.
- `default_for: [plan_landing]`: this namespace is the default landing target for new plan bodies when the caller does not provide a narrower namespace or subpath.
- `allowed_subpaths`: optional board-approved relative subpaths within a namespace. Parley should normalize and validate subpaths to prevent writes outside the resolved namespace.
- `plan_extension`: required extension for Parley-created plan bodies. For Kairos this should be `.md` so plans are directly reviewable in Obsidian.
- `permission_model`: the board's Parley-tool permission mode. MVP uses board-wide permissions for every registered Kairos board agent, while preserving schema room for future per-agent action/path scoping.

### 4.2 Resolved identity and checkpoint decisions

Parley board state should use board-local agent ids as canonical durable participant identities.
Runtime identities are aliases and provenance metadata.

Identity resolution flow:

```txt
runtime_ref -> global_agent_id -> board membership -> board_agent_id + permissions
```

Rules:

- Normal state, obligations, approvals, ownership, and checkpoints use `board_agent_id`.
- Effects and audit records should also store the concrete `runtime_ref` that performed the action.
- Runtime refs should be structured objects, not opaque strings, so Parley can distinguish OpenClaw agents, sessions, subagents, channel-bound sessions, webchat sessions, and future runtime types.
- Runtime refs are registered or adapter-discovered at the global agent level.
- Each global agent has zero or one default board.
- `where_am_i` without `boardId` uses the global agent's default board.
- Non-default board operations must pass explicit `boardId`.
- `where_am_i` with `boardId` checks the global agent's membership and resolves the board-local identity for that board.
- If runtime identity matches multiple global agents, has no default board when no `boardId` is supplied, or lacks membership in the requested board, Parley must fail closed and return a diagnostic. It must not guess a board or agent.

Identity source-of-truth tradeoff:

- OpenClaw config remains the source of truth for runtime agents, sessions, channels, and tool availability.
- The global Parley registry is the source of truth for durable Parley-wide agent identity, runtime bindings, default board selection, and per-board memberships.
- Board config is the source of truth for board roots, artifact namespaces, board policy, and board-local member references.
- This creates some duplication, but it is intentional: Parley needs stable participant ids that survive runtime/session/channel changes, while OpenClaw owns execution configuration.
- To control drift, Parley should treat runtime refs as resolvable aliases and provide a validation/check command that reports board refs pointing to missing OpenClaw agents/sessions.
- Do not copy OpenClaw tool policy wholesale into Parley. Store only the minimum runtime refs needed for identity resolution and provenance.

Runtime-ref authoring UX rule:

> Board authors should not have to model every active session, channel, heartbeat, or UI surface by hand.

The preferred standalone Parley shape is that the global registry declares durable global agents and one or more high-level runtime bindings, such as an OpenClaw agent id. Boards declare board-local members and may reference global agents by `agent_id`; a membership maps that global agent to the board-local `board_agent_id` and permissions. Runtime adapters may discover or attach current session/channel/heartbeat aliases for identity resolution and provenance. Explicit low-level `runtime_refs` remain available for fail-closed routing and auditability, but they should be treated as adapter-maintained aliases where possible rather than normal human-authored board configuration.

Example effect actor:

```yaml
actor:
  board_agent_id: kairos-operator
  runtime_ref:
    scheme: openclaw
    type: session
    id: kairos-operator:discord
```

Checkpoint ownership:

- Canonical checkpoint key: `board_id + board_agent_id + projection_type`.
- Runtime identity is stored as last-seen provenance, not primary checkpoint owner.
- Human-triggered work through a channel-bound agent session still checkpoints against the board agent; record human/channel/runtime metadata as provenance.
- The expected OpenClaw operating model is one primary session plus one heartbeat session per board agent. Both should resolve to the same board agent so heartbeat can pick up board obligations if the primary session fails or goes idle.
- Do not create separate human checkpoints unless Parley later adds first-class human users as board participants.

Example checkpoint:

```yaml
checkpoint:
  board_id: kairos
  board_agent_id: kairos-operator
  projection: where_am_i
  last_seen_effect_id: eff_120
  last_seen_at: 2026-05-01T00:00:00Z
  last_seen_by_runtime_ref:
    scheme: openclaw
    type: session
    id: kairos-operator:discord
```

### 4.3 Single-agent plans with human checkpoints

Parley must support coordination plans where only one agent actively plans, constrains, reviews preparation, and executes, while a human supplies required checkpoints between phases.

This mode should be explicit rather than pretending there was independent multi-agent review.
Suggested coordination mode:

```yaml
coordination_mode: single_agent_with_human_checkpoints
owner: kairos-operator
participants:
  - kairos-operator
  - human:sensei
human_checkpoints:
  - phase_gate
  - approval_required
```

Rules:

- The agent may own planning, constraints, review prep, execution, and status reporting for the object.
- Human checkpoint obligations or review gates are still first-class Parley state.
- Approval language should distinguish self-review/preflight from independent approval.
- This mode is valid for bounded implementation plans that repeatedly circle back to the human before proceeding.

### 4.4 Repo docs versus plans

The repo should not treat every durable Markdown artifact as a generic doc.
A large share of current `docs/` content is effectively plan/spec/decision material that landed there before Kairos had a clearer ontology for plans, invariants, coordination objects, and execution phases.

For Parley v2, the distinction should be semantic rather than purely path-based:

- **Documentation** explains current or durable system behavior. It should describe what is true now, how to operate it, or what contract currently governs behavior.
- **Plans** describe intended change. They may include phases, open questions, deferred work, entry/exit criteria, reviewers, approvals, objections, activation conditions, and supersession/carry-forward behavior.
- **Specs/invariants** constrain future plans and implementations. They may originate from a plan, but once ratified they should be treated as governing constraints rather than pending work.
- **Decision records** explain why a choice was made and what alternatives or constraints matter later.

This means Parley artifact type should not be inferred only from a `docs/` path. A repo-local file can be a `plan`, `invariant_spec`, `decision_record`, or normal `documentation` artifact depending on its declared metadata and Parley artifact reference.

Recommended long-term Kairos repo ontology:

```txt
docs/   current durable truth, operating contracts, references, and how-to material
plans/  intended changes, migrations, deferred phases, review plans, and implementation plans
```

A top-level `plans/` directory is the cleanest eventual shape if Kairos wants path structure to reflect the ontology instead of relying only on frontmatter or Parley metadata.
Under that model, examples would look like:

```txt
plans/v2-artifact-backed-coordination-board-plan.md
plans/architecture/ui/persona-manager-console-implementation-plan.md
docs/mvp-thread-protocol-spec.md
docs/architecture/ui/kairos-console-architecture.md
```

Migration guardrails:

- inventory current `docs/` files and classify each as `documentation`, `plan`, `invariant_spec`, or `decision_record`
- create `plans/README.md` defining the directory contract before moving files
- move only files that are still plans, migration plans, implementation plans, review notes, or deferred work records
- when a moved plan contains current operational truth, split or promote that truth into a doc/spec before moving the remaining plan body
- update `canon://` resolver roots, repo search scopes, tests, cross-links, and any hardcoded path references before relying on the new location
- consider temporary forwarding stubs or explicit alias records for high-value moved docs
- do the migration in small commits by domain rather than one broad mechanical move

Near-term Kairos recommendation:

- keep current Parley/Kairos canonical material in `docs/` until the top-level `plans/` migration is explicitly approved and the canon/ref tooling is updated
- classify artifacts explicitly in Parley records with `kind`, `status`, `version`, and `relationships`
- allow Parley to reference both `docs/` and `plans/` repo paths once `plans/` exists
- treat this v2 plan itself as a candidate to move from `docs/` to `plans/` during the repo ontology migration

This lets Parley model the truth now without forcing a repo-wide documentation migration as part of the v2 MVP, while preserving a clear path to a cleaner repo ontology.

## 5. Artifact Storage Strategy

### 5.1 Required storage modes

Parley v2 should support three artifact body storage modes.
All three modes should be resolved through board configuration so Parley core is not intertwined with Kairos paths.

#### Mode A: reference-only artifacts

Use this when the artifact already lives in an authoritative place and Parley should not manage the body.

Examples:

- a Kairos repo doc under `docs/`
- a Kairos repo plan under `plans/`
- a vault/canon ref
- a GitHub issue or PR
- an external design document

Required behavior:

- Parley stores the URI/ref, declared artifact kind, board id, version metadata, optional content hash, status, and relationships.
- Parley does not copy or edit the artifact body by default.
- The board config declares which reference schemes and roots are allowed.
- Reference-only artifacts may still participate fully in effects, obligations, approvals, relationships, stale-review checks, and board projections.

Reasoning:

- Parley should stay general across boards; not every board will want Parley to own or rewrite project documents.
- Project repositories and vaults may already have their own review, version control, editor, and search workflows.
- Keeping bodies external when appropriate prevents Parley from becoming a second filesystem, a shadow docs system, or a Kairos-specific content store.
- Parley-owned refs still make the artifact operationally durable without forcing Parley to own the artifact body.

Minimal reference-only example:

```yaml
artifact_ref:
  board_id: kairos
  artifact_id: artifact_parley_v2_plan
  kind: plan
  storage_mode: reference_only
  uri: repo://plans/v2-artifact-backed-coordination-board-plan.md
  version: 1
  content_hash: null
  status: draft
```

#### Mode B: board managed artifact root

Use this when Parley needs to create durable local artifact bodies and no explicit project/repo landing directory was supplied.

Recommended general default:

```txt
${XDG_DATA_HOME:-~/.local/share}/parley/boards/<board_id>/artifacts/
```

For the Kairos board:

```txt
/home/agent/.local/share/parley/boards/kairos/artifacts/
```

Required behavior:

- The managed root is inside the board root, not a separate global artifact tree.
- Parley may create files under this root when the caller requests a new artifact without supplying an explicit landing root.
- Managed artifacts should be considered Parley-owned local artifacts, not automatically repo-canonical docs.
- If a managed artifact later becomes canonical for a project, Parley should record a migration/linking effect rather than silently treating the old local path as canonical.
- Board config should allow subdirectories such as `drafts/`, `plans/`, `decisions/`, or `handoffs/`, but Parley core should not require the Kairos taxonomy.

Minimal managed-local example:

```yaml
artifact_ref:
  board_id: kairos
  artifact_id: artifact_asset_synthesis_future_plan
  kind: plan
  storage_mode: managed_local
  uri: parley-artifact://kairos/plans/asset-synthesis-future-plan.md
  resolved_path: ~/.local/share/parley/boards/kairos/artifacts/plans/asset-synthesis-future-plan.md
  version: 1
  status: draft
```

#### Mode C: explicit per-object or per-thread landing directory

Use this when the human or initiating agent knows the artifact should land in a board-owned project directory, usually a repo.

Example before the Kairos repo ontology migration:

```txt
docs/
```

Example after a top-level `plans/` migration:

```txt
plans/
```

Required behavior:

- Landing roots may be supplied at thread open, object creation, or artifact creation time.
- A caller may supply a relative landing subpath under the board default, for example `architecture/generation` under `~/workspace/Kairos/plans`.
- Precedence should be object/artifact landing override, then thread landing override, then board default landing root plus optional subpath, then board managed artifact root.
- Parley should validate explicit landing roots and subpaths against board-allowed roots before writing.
- Parley-created plan documents must use the board `plan_extension`; for Kairos, all plan documents must be Markdown `.md` files.
- Parley should record the selected landing root, subpath, and resolved path in the artifact reference so future effects and revisions do not infer them from chat context.
- Explicit landing does not imply Kairos-specific behavior; it is a board-level capability.

Minimal explicit-landing example:

```yaml
artifact_ref:
  board_id: kairos
  artifact_id: artifact_parley_v2_plan
  kind: plan
  storage_mode: explicit_landing
  landing_root: ~/workspace/Kairos/plans
  uri: repo://plans/v2-artifact-backed-coordination-board-plan.md
  version: 1
  status: draft
```

### 5.2 Kairos default recommendation

For Kairos foundation/spec/architecture plans, prefer a repo plan body home once the repo ontology migration exists:

```txt
/home/agent/workspace/Kairos/plans/
```

Until then, keep using the current repo doc location for Parley design artifacts:

```txt
/home/agent/workspace/Kairos/docs/
```

For temporary Parley-generated drafts that are not yet canonical, use managed board artifacts under the board root:

```txt
/home/agent/.local/share/parley/boards/kairos/artifacts/drafts/
```

For Parley-owned board state, use the same board root rather than a separate `.kairos-runtime` tree:

```txt
/home/agent/.local/share/parley/boards/kairos/state/
```

The current `.kairos-runtime/parley/` location is the MVP-era Kairos-local runtime root. Parley v2 should either migrate it into the board root above or allow a board to explicitly choose a repo-local board root. It should not split state and managed artifacts across unrelated roots by default.

### 5.3 Artifact reference shape

A minimal artifact reference should include:

```yaml
artifact_ref:
  artifact_id: artifact_parley_v2_plan
  kind: plan
  board_id: kairos
  storage_mode: explicit_landing
  uri: repo://plans/v2-artifact-backed-coordination-board-plan.md
  landing_root: ~/workspace/Kairos/plans
  version: 1
  content_hash: null
  status: draft
  created_at: 2026-04-30T00:00:00Z
  updated_at: 2026-04-30T00:00:00Z
```

Recommended `storage_mode` values:

- `reference_only`
- `managed_local`
- `explicit_landing`

The URI scheme or ref type should carry the external shape (`repo://`, `vault://`, `canon://`, `https://`, or opaque board-defined refs) instead of creating a separate storage mode for every reference family.

## 6. Core Data Model

### 6.1 ID conventions

Use stable board-scoped ids from the first implementation pass.
Do not let each store or tool invent its own id style.

Recommended id patterns:

```txt
board_id: kairos
artifact_id: artifact_<slug>
object_id: object_<slug>
effect_id: effect_<timestamp_or_ulid>
obligation_id: obligation_<timestamp_or_ulid>
checkpoint_id: checkpoint_<board_id>_<agent_id>_<projection>
plan_id: plan_<slug>
```

Rules:

- Human-authored or semantic artifacts should use stable slug ids, for example `artifact_parley_v2_plan`.
- Append-only operational records should use chronologically sortable ids when possible, preferably ULID-like ids.
- If ULID support is not available in the first implementation pass, use timestamp plus random suffix rather than a plain counter.
- Ids are board-scoped unless explicitly marked global.

### 6.2 Coordination object

A coordination object represents the thing Parley is coordinating.

Suggested object kinds:

- `plan`
- `invariant_spec`
- `decision_record`
- `review_request`
- `handoff_packet`
- `execution_report`
- `phase`
- `activation_candidate`

Do not make `obligation` a coordination object kind in the first pass. Obligations should be their own records so `where_am_i` has a single source of truth.

Minimal shape:

```yaml
coordination_object:
  object_id:
  kind:
  title:
  status:
  artifact_ref:
  participants:
  created_at:
  updated_at:
```

Suggested statuses:

- `draft`
- `review`
- `ratified`
- `active`
- `deferred`
- `blocked`
- `complete`
- `superseded`
- `archived`

### 6.3 Effect

Effects are append-only semantic records sourced from thread messages, tool calls, or controlled migrations.
Effects are immutable after creation. Corrections must be represented by new effects, such as `effect_corrected`, `obligation_resolved`, `approval_withdrawn`, `relationship_removed`, or `artifact_unlinked`.

Minimal shape:

```yaml
effect:
  effect_id:
  type:
  actor:
  target:
  payload:
  source_thread_id:
  source_message_id:
  created_at:
```

Initial effect types:

- `artifact_linked`
- `review_requested`
- `approval_recorded`
- `objection_raised`
- `objection_resolved`
- `constraint_added`
- `non_goal_added`
- `decision_recorded`
- `obligation_created`
- `obligation_resolved`
- `artifact_superseded`
- `relationship_added`
- `relationship_removed`
- `artifact_unlinked`
- `phase_deferred`
- `activation_proposed`
- `handoff_created`
- `effect_corrected`

`relationship_removed` and `artifact_unlinked` are not required in the first implementation slice, but the type names should be reserved now so bad links can later be undone without editing historical effects.

### 6.4 Obligation

Obligations are the durable answer to “who owes what?”

Minimal shape:

```yaml
obligation:
  obligation_id:
  agent:
  type:
  status:
  target:
  scope:
  reason:
  source_effect_id:
  created_at:
  updated_at:
```

Initial types:

- `review`
- `approve_or_object`
- `resolve_objection`
- `implement_phase`
- `report_status`
- `validate_activation`
- `notify_human`
- `preserve_awareness`

Initial statuses:

- `active`
- `blocking`
- `waiting`
- `deferred`
- `resolved`
- `stale`
- `cancelled`
- `superseded`

### 6.5 Relationship

Relationships model artifact/object graphs without assuming newer always supersedes older.

Initial relationship types:

- `supersedes`
- `superseded_by`
- `constrains`
- `constrained_by`
- `depends_on`
- `blocks`
- `blocked_by`
- `implements`
- `implemented_by`
- `refines`
- `refined_by`
- `absorbed_by`
- `extracts_from`
- `related_to`

Relationships can be added after the first object/effect/obligation loop is working.

## 7. Plan Document v1 Schema

All Parley-created plan bodies should be Markdown files with YAML frontmatter.
For Kairos, the required extension is `.md` so every plan can be opened and reviewed in Obsidian.

Schema id:

```txt
parley.plan.v1
```

Canonical schema ownership:

- The canonical `parley.plan.v1` schema belongs to standalone Parley, not Kairos.
- While Parley is still implemented inside the Kairos OpenClaw tooling repo, this document may carry the draft schema text as planning material.
- Before standalone release, Parley should move the schema into its own schema registry/package docs and treat Kairos docs as project-specific usage notes or mirrors.
- Kairos may reference/import the Parley schema, but Kairos should not be the long-term authority for Parley-native schemas.

### 7.1 Required frontmatter

Every v1 plan document must start with YAML frontmatter containing these fields:

```yaml
---
schema: parley.plan.v1
artifact_kind: plan
authority: migration-plan
plan_id: plan_<stable_slug>
board_id: kairos
title: Human-readable plan title
status: draft
version: 1
created_at: 2026-05-01T00:00:00Z
updated_at: 2026-05-01T00:00:00Z
owner: kairos-operator
participants:
  - kairos-operator
  - kairos-orchestrator
scope:
  summary: One-sentence scope boundary
  in:
    - bounded in-scope item
  out:
    - explicit non-goal
landing:
  namespace: project_plans
  subpath: architecture/generation
  filename: example-plan.md
review:
  required_reviewers: []
  approvals: []
  objections: []
relationships:
  supersedes: []
  superseded_by: []
  constrains: []
  constrained_by: []
  depends_on: []
  blocks: []
  blocked_by: []
  related_to: []
parley:
  object_id: null
  artifact_id: null
  source_thread_id: null
  source_message_id: null
---
```

Required field semantics:

- `schema`: must be `parley.plan.v1`.
- `artifact_kind`: must be `plan`; do not add a separate `kind` field unless the runtime later requires distinct semantics.
- `authority`: orientation metadata for how the plan should be treated, for example `proposal`, `migration-plan`, `implementation-plan`, `invariant-spec`, `coordination-plan`, or `reference`.
- `priority`: optional, not required in v1; if present, use `low`, `normal`, `high`, or `urgent`.
- `plan_id`: stable board-local plan id; do not derive solely from title if the title may change.
- `board_id`: board that owns the plan; for Kairos plans this is `kairos`.
- `status`: one of `draft`, `review`, `ratified`, `active`, `deferred`, `blocked`, `complete`, `superseded`, `archived`, or `cancelled`.
- `version`: explicit semantic integer version for the plan artifact.
- `owner`: board-local agent or human owner responsible for the plan's current state.
- `participants`: board-local agents or humans expected to know about or act on the plan.
- `scope.in` and `scope.out`: required to prevent plan drift.
- `landing`: records the chosen board landing namespace, subpath, and filename.
- `review`: stores lightweight current review state; authoritative review events still live as Parley effects.
- `relationships`: stores human-readable relationship pointers; authoritative relationship records still live in Parley state.
- `parley`: optional binding to board runtime records once registered.

### 7.2 Required body headings

Every v1 plan body should use these headings in this order:

```md
# <Title>

## Purpose
## Background
## Scope
### In Scope
### Out of Scope
## Current State
## Target State
## Plan
## Phases
## Acceptance Criteria
## Risks and Constraints
## Open Questions
## Review and Approval
## Change Log
```

Heading semantics:

- `Purpose`: why the plan exists.
- `Background`: context needed to understand the plan without rereading a thread.
- `Scope`: human-readable expansion of frontmatter scope.
- `Current State`: what is true now.
- `Target State`: what should be true after completion.
- `Plan`: implementation or migration approach.
- `Phases`: ordered work phases; deferred phases must include activation conditions.
- `Acceptance Criteria`: concrete completion checks.
- `Risks and Constraints`: safety, authority, compatibility, and operational limits.
- `Open Questions`: unresolved decisions.
- `Review and Approval`: current review state and links to Parley effects or threads.
- `Change Log`: versioned summary of meaningful edits.

### 7.3 Phase block shape

Plan phases should use this repeatable shape:

```md
### Phase N — Title

Status: proposed | ready | active | blocked | deferred | complete | superseded | cancelled
Owner: board-agent-id-or-human
Supporting agents:
- board-agent-id

Entry criteria:
- ...

Work:
- ...

Exit criteria:
- ...

Activation conditions: <!-- required when status = deferred unless Review trigger is present -->
- ...

Review trigger: <!-- required when status = deferred and activation conditions are not concrete -->
- ...

Deferral reason: <!-- required when status = deferred -->
- ...

Non-goals before activation: <!-- required when status = deferred -->
- ...
```

Deferred phase rule:

> A deferred phase is invalid unless it names a deferral reason, activation conditions or review trigger, owner or future owner, and non-goals before activation.

Deferred activation metadata belongs in phase blocks and Parley effects/obligations. Do not add a top-level `deferred_review` field in `parley.plan.v1`.

### 7.4 Retrofitting existing docs into plans

When moving existing `docs/` material into `plans/`, retrofit it into `parley.plan.v1` rather than preserving ad hoc structure.
If an existing doc mixes current durable truth with future work, split it first:

- current truth remains or becomes documentation/spec material under `docs/`
- intended change becomes a `parley.plan.v1` Markdown file under `plans/`

## 8. Projections

### 8.1 `where_am_i(caller)`

This is the priority projection. In normal use Parley derives the board and board-local agent from the caller runtime identity before evaluating this projection.
If caller identity cannot resolve to exactly one board-local agent, `where_am_i` must fail closed and return a diagnostic instead of guessing.

It should return:

- blocking obligations assigned to the agent
- active obligations assigned to the agent
- waiting states where the agent is not the next actor
- deferred obligations involving the agent
- stale approvals by the agent
- activation candidates that need agent review
- awareness constraints the agent should preserve
- relevant artifacts and source threads
- changes since the agent's last checkpoint, when checkpoints exist

Acceptance rule:

> An agent should not need to read an entire Parley thread to know what it currently owes.

### 8.2 Board projection

Initial board categories:

- needs human decision
- needs agent review
- blocking on agent
- waiting on others
- ready for handoff
- deferred
- activation candidates
- stale approvals
- superseded/dropped
- recently changed

`board_checkpoints` should be projection/cursor state, not primary truth. Effects and object records remain authoritative.
Checkpoint rows are canonically owned by `board_id + board_agent_id + projection_type`, with `runtime_ref` stored only as last-seen provenance.

## 9. Tool Surface

### 9.1 Near-term approach

Keep existing first-class thread tools working:

- `parley_open_thread`
- `parley_claim_turn`
- `parley_reply_thread`
- `parley_probe_thread`
- `parley_settle_turn`
- `parley_conclude_thread`
- transport/debug helpers

Add a small explicit v2/dev surface before collapsing into generic query/mutate tools. Initial dev tools should be intentionally typed and narrow:

- `parley_register_artifact`
- `parley_create_object`
- `parley_record_effect`
- `parley_create_obligation`
- `parley_where_am_i`
- `parley_board_projection`
- `parley_record_relationship`

These tools validate the object/effect/obligation/projection/relationship model without turning `parley_query` or `parley_mutate` into a premature catch-all surface.

### 9.2 Target compact surface

After the model stabilizes, prefer a compact read/write split:

- `parley_query`
- `parley_mutate`

Initial `parley_query` actions:

- `where_am_i`
- `board`
- `inspect_object`
- `inspect_artifact`
- `list_relationships`
- `list_activation_candidates`
- `list_decisions`
- `list_obligations`

Initial `parley_mutate` actions:

- `create_object`
- `link_artifact`
- `record_effect`
- `request_review`
- `submit_review`
- `approve`
- `object`
- `resolve_objection`
- `add_constraint`
- `record_decision`
- `link_objects`
- `supersede_artifact`
- `defer_phase`
- `propose_activation`
- `handoff_phase`
- `create_obligation`
- `resolve_obligation`

Existing thread tools and explicit v2/dev tools can later become compatibility wrappers over `parley_query` and `parley_mutate` actions.

Target mapping:

```txt
parley_where_am_i -> parley_query(action="where_am_i")
parley_register_artifact -> parley_mutate(action="register_artifact")
parley_create_object -> parley_mutate(action="create_object")
parley_record_effect -> parley_mutate(action="record_effect")
parley_create_obligation -> parley_mutate(action="create_obligation")
```

## 10. Versioned Review and Approval Rules

Approvals, objections, constraints, and review outcomes must bind to:

- `artifact_id`
- `artifact_version`
- optional section/path
- authority scope

Suggested scopes:

- `schema`
- `runtime`
- `orchestration`
- `implementation`
- `content_pipeline`
- `analytics`
- `persona_strategy`

Rule:

> If an artifact materially changes after approval, previous approvals become stale unless explicitly carried forward.

Versioning recommendation for the MVP: versions should be explicit/manual semantic artifact versions with an optional content hash for verification. Do not infer semantic artifact version bumps solely from file hash changes.

Carry-forward defaults:

- constraints carry forward unless resolved or explicitly removed
- decisions carry forward unless superseded
- open items carry forward unless resolved or dropped
- deferred phases carry forward unless activated, dropped, or superseded
- approvals become stale unless explicitly carried forward
- comments do not carry forward as active state

## 11. Deferred Phase and Activation Semantics

Deferred phases are allowed only when they include:

- reason for deferral
- activation conditions or review trigger
- owner or future owner
- non-goals before activation

Activation modes:

- `notify_only`
- `propose_activation`
- `auto_activate`
- `auto_execute`

Default for architecture, schema, migration, and pipeline-foundation work:

```txt
detect -> notify/propose -> wait
```

Do not default foundation work to `auto_execute`.

Future autonomy note:

- Keep `auto_activate` and `auto_execute` in the model as future-supported autonomy modes.
- Treat them as unavailable or policy-gated for the MVP, especially for architecture/foundation work.
- This preserves room for Parley to become an autonomous project runner later without making early coordination-board behavior unsafe.
- Any future `auto_execute` use should require explicit board policy, scoped permissions, risk classification, and clear human/orchestrator opt-in.

Non-executing deferred-work track:

The deferred-work track should be a coordination and visibility layer only until a separate execution-policy assignment authorizes more.
It may schedule, preserve, surface, and route future work, but it must not activate phases or execute implementation by itself.

Deferred/non-executing items to preserve in the plan:

- `allowed_reference_namespaces` / artifact namespace cleanup: replace root-fragmented board config with concise project-agnostic namespace policy.
- plan creation and validation UX, including standalone `parley.plan.v1` schema ownership.
- activation-candidate visibility that notifies or proposes, then waits.
- relationship correction/removal records.
- runtime-ref authoring UX: reduce the need for humans to hand-author every session/channel/heartbeat alias.
- `single_agent_with_human_checkpoints` coordination mode.
- future Parley Console: a human entry point for managing boards, plans, threads, obligations, scheduling, approvals, and coordination state beyond prompting or Discord channels.
- eventual standalone Parley docs and schema registry separate from Kairos project plans/specs.
- archival/removal of explicit v2/dev tool names after `parley_query` / `parley_mutate` are the preferred validated surface and allowlists/docs/tests no longer rely on the explicit wrappers.

Non-executing implementation checkpoint, 2026-05-01:

- `parley.plan.v1` now has a Parley-owned schema module under `src/schemas/`.
- `parley_mutate(action="create_plan")` creates a Markdown plan body, validates it against `parley.plan.v1`, writes it through a board artifact namespace, and registers the resulting explicit-landing plan artifact.
- `parley_query(action="validate_plan")` validates supplied plan Markdown or a plan file under an allowed reference namespace without executing any work.
- Kairos board config now exposes `artifact_namespaces` and `allowed_reference_namespaces`, while retaining legacy root fields as compatibility aliases for existing call paths.
- Namespace landing fails closed when a caller requests a subpath outside the namespace's allowed subpaths.
- Board projection now derives non-executing deferred-phase visibility from `parley.plan.v1` plan artifacts and surfaces explicit `activation_proposed` / `activation_candidate_dismissed` effects as advisory activation candidates.
- `where_am_i` shows only active candidate/proposal records relevant to the caller and keeps dismissed candidates quiet for the same artifact-version projection.
- Relationship correction/removal now uses append-only `relationship_removed` effects plus relationship record status updates; normal graph edges include only active relationships, while inactive edges remain available for history/debug projection.
- Relationship corrections are modeled as remove old + add corrected relationship with `correction_of` / `replaces_relationship_id` pointers rather than a separate correction effect type.
- `single_agent_with_human_checkpoints` MVP now accepts structured `human_checkpoints` frontmatter; `parley_create_plan` / `parley_mutate(action="create_plan")` create shepherd-agent `notify_human` obligations for pending `plan_created` checkpoints.
- Board and `where_am_i` projections expose human checkpoint state without assigning obligations directly to humans or creating passive side effects from projection scans.
- Runtime identity resolution now keeps `board_agent_id` as the durable identity while allowing OpenClaw adapter-discovered runtime aliases, such as `agent:<agent_id>:...` session keys, to resolve through persisted agent bindings without auto-persisting discovered session refs.
- Identity diagnostics now report considered runtime aliases, whether the caller ref itself was persisted, the persisted ref that resolved the caller, and fail closed on ambiguous matches rather than choosing the latest/active session.
- Board-state record constructors now validate known effect/obligation target and payload shapes instead of accepting arbitrary raw objects for every semantic field. Compatibility for already-written sparse review smoke records is retained, but unknown keys in structured targets fail closed.
- State-validation UX should prefer a CLI/subcommand or flag flow over a permanent first-class `parley_validate_state` tool. A temporary first-class wrapper is acceptable only as an interim audit aid while Parley remains inside OpenClaw tooling.

## 12. First Implementation Slice

The first implementation pass should stop after proving this loop:

```txt
board registry -> runtime identity resolution -> artifact ref -> coordination object -> effect -> obligation -> where_am_i
```

Required deliverables:

- board config loader
- Kairos board config fixture/default
- runtime identity resolver with fail-closed diagnostics
- artifact ref store
- coordination object store
- effect store with immutable append-only writes
- obligation store
- `parley_where_am_i`
- tests for identity resolution and obligation projection

Explicitly defer from the first implementation pass:

- relationship graph
- activation candidates
- stale approval detection
- query/mutate consolidation
- repo `plans/` migration
- autonomous activation/execution behavior

Implementation checkpoint, 2026-05-01:

- The first implementation slice exists in the Kairos OpenClaw tools plugin.
- Targeted tests cover identity resolution, caller-derived runtime context, artifact/object/effect/obligation writes, terminal-obligation filtering, and structured first-class tool schemas.
- Live smoke verified this loop after gateway reload:

```txt
managed artifact -> coordination object -> structured effect -> structured obligation -> where_am_i projection -> obligation resolution
```

Smoke records:

- artifact: `artifact_smoke_20260501_board_state`
- object: `object_smoke_20260501_board_state`
- effect: `effect_smoke_20260501_structured_review_requested_after_restart`
- obligation: `obligation_smoke_20260501_structured_review_after_restart`

Observed projection behavior:

- `where_am_i` resolved the caller as board agent `kairos-operator` on board `kairos`.
- While the smoke obligation was blocking, the projection enriched it with linked object, artifact, source effect, source thread, and source message refs.
- After the obligation was overwritten to `resolved`, a non-terminal `where_am_i` returned zero visible/blocking obligations.

This is a proven first slice, not a full v2 implementation boundary. Remaining work still includes standalone packaging extraction, activation candidates, query/mutate consolidation, repo `plans/` migration, and autonomous activation/execution policy.

Extraction-seam checkpoint, 2026-05-01:

- Current OpenClaw runtime refs are intentionally frozen for now:
  - `openclaw` agent `kairos-operator`
  - `openclaw` session `kairos-operator:discord`
  - `openclaw` session `kairos-operator:webchat`
  - `openclaw` session `agent:kairos-operator:discord:channel:1494492383726010418`
  - `openclaw` agent `kairos-orchestrator`
  - `openclaw` session `agent:kairos-orchestrator:discord:channel:1492408840862433480`
- Parley core board-registry resolution should not embed Kairos as the only default board.
- The Kairos board should enter the OpenClaw plugin as an adapter/fixture with explicit board defaults, so standalone extraction can preserve Parley core while moving Kairos-specific roots and participants into board configuration.

## 13. Migration Order

### Phase 0: preserve current behavior

- Leave current thread tools operational.
- Keep current `.kairos-runtime/parley/threads`, `messages`, and `index` layout until board-root migration is implemented.
- Do not change transport semantics as part of the object-model migration unless required.

### Phase 1: add board registry and board-scoped storage config

Add a board registry before adding artifact/object stores.
The board registry should be generic Parley config, with Kairos as one configured board.

Config fields should be equivalent to:

```yaml
parleyRoot: ~/.local/share/parley
boards:
  kairos:
    displayName: Kairos
    boardRoot: ~/.local/share/parley/boards/kairos
    stateRoot: ~/.local/share/parley/boards/kairos/state
    managedArtifactRoot: ~/.local/share/parley/boards/kairos/artifacts
    planExtension: .md
    artifactNamespaces:
      - id: project_plans
        roles: [plan_landing, explicit_landing, reference]
        defaultFor: [plan_landing]
        uriPrefix: repo://plans/
        resolvedRoot: ~/workspace/Kairos/plans
        allowedSubpaths:
          - agent-comms/parley
          - architecture/generation
          - architecture/system
          - architecture/tools
          - architecture/ui
          - architecture/workspaces
      - id: project_docs
        roles: [explicit_landing, reference]
        uriPrefix: repo://docs/
        resolvedRoot: ~/workspace/Kairos/docs
      - id: project_vault
        roles: [reference]
        uriPrefix: vault://
        resolvedRoot: ~/workspace/Kairos/vault
    allowedReferenceNamespaces:
      - project_plans
      - project_docs
      - project_vault
    permissionModel:
      mode: board_wide_all_tools
      futureAgentScoping: true
    agents:
      kairos-operator:
        displayName: Kairos Operator
        kind: agent
        runtimeRefs:
          - scheme: openclaw
            type: agent
            id: kairos-operator
          - scheme: openclaw
            type: session
            id: kairos-operator:discord
          - scheme: openclaw
            type: session
            id: kairos-operator:webchat
        permissions:
          preset: board_admin
      kairos-orchestrator:
        displayName: Kairos Orchestrator
        kind: agent
        runtimeRefs:
          - scheme: openclaw
            type: agent
            id: kairos-orchestrator
        permissions:
          preset: board_admin
```

Allow per-object/per-thread/per-artifact `artifact_namespace` and `landing_subpath` overrides only after resolving the caller into a board and validating the destination against that board's artifact namespace policy.
Subpaths under the default `plan_landing` namespace are allowed, for example `architecture/generation`, so plan files do not all land in one directory.
Parley may create files through these roots because the calling agent remains the originator of the tool action; Parley records provenance for the write instead of pretending the artifact appeared independently.

### Phase 2: add artifacts and coordination objects

- Add JSON stores under the board state root:
  - `boards/<board_id>/state/artifacts/<artifact_id>.json`
  - `boards/<board_id>/state/objects/<object_id>.json`
- Store artifact refs, not large artifact bodies, in runtime records.
- Support all three artifact body modes: `reference_only`, `managed_local`, and `explicit_landing`.
- Support existing repo docs and future repo plans as board reference or explicit-landing artifacts.

### Phase 3: add effects

- Add append-only board-scoped effect records:
  - `boards/<board_id>/state/effects/<effect_id>.json`
  - optional indexes by object, artifact, thread, and actor.
- Require source thread/message when an effect comes from a Parley message.
- Allow system migration effects with explicit source metadata.

### Phase 4: add obligations

- Add board-scoped obligation records:
  - `boards/<board_id>/state/obligations/<obligation_id>.json`
- Generate obligations from typed effects where appropriate.
- Resolve obligations through typed effects, not ad hoc mutation.

### Phase 5: add `where_am_i`

- Build the first personalized projection from board-scoped obligations, effects, objects, and artifacts.
- Resolve runtime identity to board-local agent id before querying obligations.
- Include source refs to objects/artifacts/threads for auditability.

### Phase 6: add minimal board

- Add read-only board projection.
- Keep board state derived.
- Add checkpoints/cursors only after the projection is useful.

Implementation checkpoint, 2026-05-01:

- `parley_board_projection` returns a read-only `minimal_board` projection derived from current board-scoped artifacts, coordination objects, effects, obligations, and configured board agents.
- The projection includes counts by kind/status/type/agent by default; bounded record excerpts are opt-in for situational awareness when specifically needed.
- No checkpoints, cursors, relationship records, or mutation façade were added in this phase.

### Phase 7: add scoped approvals and stale approval detection

- Bind approvals to artifact version and scope.
- Mark approvals stale on material artifact version changes unless carried forward.

Implementation checkpoint, 2026-05-01:

- `approval_recorded`, `approval_withdrawn`, and `objection_raised` effects now require `target.artifact_id`, `target.artifact_version`, and `target.scope`.
- Approval state is derived from append-only effects and current artifact versions; no mutable approval records were introduced.
- `parley_board_projection` includes approval counts by status/scope/approver and derived stale/carry-forward state.
- `parley_where_am_i` now surfaces stale approvals by the calling board agent.
- Carry-forward uses a new scoped `approval_recorded` effect on the newer artifact version with `payload.carry_forward_from_version`.

### Phase 8: add relationships and deferred phases

- Add relationship records.
- Add deferred phase fields and activation candidate projection.
- Keep activation non-executing by default.

Relationship implementation checkpoint, 2026-05-01:

- `parley_record_relationship` creates board-scoped relationship records and matching append-only `relationship_added` effects.
- Relationship endpoints are currently bounded to existing board artifacts or coordination objects.
- `parley_board_projection` now includes a derived relationship graph with nodes, edges, active edges, and counts by relationship type/status.
- Deferred phase fields and activation-candidate projection remain future work under this phase.
- Live smoke after gateway reload verified scoped approval stale detection and relationship graph projection together.

### Phase 9: add explicit v2/dev tools

- Add narrow typed tools for artifact registration, object creation, effect recording, obligation creation, and `where_am_i`.
- Keep the dev surface small enough to validate schema behavior without creating a permanent broad tool explosion.
- Treat these explicit v2/dev tools as transitional wrappers once the compact façade is proven; do not remove them until docs, tests, and tool allowlists have migrated cleanly.

### Phase 10: consolidate tool surface

- Add `parley_query` and `parley_mutate` only after the core deliverables have proven stable:
  - minimal board projection
  - relationships
  - at least one approval/review path
- Treat query/mutate as a stable façade over proven verbs, not a container for verbs still being discovered.
- Keep high-volume projection fields opt-in by default so normal tool calls preserve context-window budget.
- Prefer `parley_query` / `parley_mutate` for new agent guidance once their action schemas are clear and validated.
- Keep the explicit v2/dev tools as transitional wrappers until the façade has clear migration value and no current docs/tests/allowlists depend on direct names.
- Archive or remove the explicit v2/dev names only after a clean validation pass confirms the façade covers the supported actions and standalone Parley packaging no longer needs the direct tools.
- Wrap legacy thread tools and explicit v2/dev tools through query/mutate actions once schemas are stable.

Implementation checkpoint, 2026-05-01:

- `parley_query` now provides a narrow stable façade for `where_am_i` and `board`.
- `parley_mutate` now provides a narrow stable façade for `register_artifact`, `create_object`, `record_effect`, `create_obligation`, and `record_relationship`.
- Unsupported query/mutate actions fail closed rather than becoming an unbounded generic Parley surface.
- Gateway-reloaded live smoke verified both supported façade actions and unsupported-action rejection.
- A follow-up gateway reload verified `parley_query(action="board")` returns `records: null` by default and only returns bounded record excerpts when `includeRecords: true` is explicitly supplied.

### Phase 11: add board-agent projection checkpoints

- Add checkpoint records keyed by `board_id + board_agent_id + projection_type`.
- Store runtime identity as last-seen provenance, not as the checkpoint owner.
- Compare current projection cursors against the previous checkpoint before optionally advancing them.
- Keep checkpoints non-executing: they preserve awareness and context discipline, but do not activate phases or run work.

Implementation checkpoint, 2026-05-01:

- `parley_checkpoint_projection` compares and optionally advances checkpoints for `minimal_board` and `where_am_i` projections.
- Checkpoint records are stored under the board state root and keyed by board-local agent plus projection type.
- Projection cursors store a stable projection digest and counts; tool output reports whether the projection changed and returns numeric count deltas.
- `advance` defaults to `false`, so callers can inspect changes without mutating last-seen state.

## 14. MVP Acceptance Criteria

The v2 MVP is acceptable when:

- Parley has a board registry and Kairos is configured as one board rather than hardcoded into Parley core
- runtime identities can resolve to board-local agent ids, such as OpenClaw `kairos-operator` resolving to board agent `kairos-operator` on board `kairos`
- every registered Kairos board agent receives board-wide Parley tooling permissions in MVP, while record shapes preserve room for future per-agent permission scoping
- a repo doc or repo plan can be registered as a reference-only or explicit-landing Parley artifact without moving the body
- a managed-local artifact can be created under a board configured root such as `~/.local/share/parley/boards/kairos/artifacts/`
- explicit plan landing supports subdirectories under the default `plan_landing` artifact namespace, such as `architecture/generation`
- board artifact/reference policy uses project-agnostic namespaces rather than Kairos-only root fields
- Parley-created plan documents are Markdown `.md` files and conform to `parley.plan.v1`
- a coordination object can point to an artifact and track status/version
- a thread/message can produce a durable board-scoped effect
- a review request can create an obligation for a board agent
- an agent can run `where_am_i` and have Parley derive the relevant board from caller identity before returning current obligations
- an approval or objection is scoped to board, artifact version, and authority scope
- board checkpoints are keyed by board-local agent and projection, with runtime identity as provenance
- explicit v2/dev tools existed before the final `parley_query` / `parley_mutate` consolidation and have a documented archive/removal path
- existing thread tools still work
- Parley-managed board state stays out of versioned repo content unless a board explicitly chooses a gitignored repo-local board root
- Kairos plan/spec bodies can continue living in repo docs or future repo plans when explicitly configured or referenced

## 15. Resolved Near-Term Decisions

1. Runtime refs are frozen for the next practical phase. The current OpenClaw `agent` and `session` refs are enough for Kairos operator/orchestrator coordination. Do not expand runtime ref types until a concrete integration requires it.
2. `parley_query` / `parley_mutate` were added only after minimal board projection, relationships, and at least one approval/review path were proven. Keep the façade narrow and fail-closed; add actions only after their underlying explicit verbs and schemas are stable.
3. Rename the board link policy from root-oriented language toward `allowed_reference_namespaces`, with namespace records carrying URI prefixes, optional resolved roots, roles, and allowed subpaths.
4. Treat `parley.plan.v1` as a Parley-owned standalone schema. Kairos may host current planning material temporarily, but standalone Parley must own its canonical schema registry and docs.
5. Preserve one-agent, human-checkpointed coordination as an explicit supported mode rather than forcing every plan through multi-agent review semantics.

## 16. Immediate Recommendation

The smallest board-scoped end-to-end loop has now been implemented and smoke-tested:

```txt
board registry -> caller-derived board/agent mapping -> artifact ref -> coordination object -> effect -> obligation -> where_am_i(caller)
```

Next recommended steps:

1. Keep the current Parley v2 plan as the coordination artifact for the implemented first slice and remaining migration work.
2. Use the accepted first-slice baseline for extraction planning.
3. Preserve the current runtime refs until a concrete integration requires expansion.
4. Continue larger deferred-work movement through non-executing coordination features: plan creation/validation, namespace-based explicit plan landing, relationship correction/removal records, runtime-ref UX cleanup, single-agent human-checkpoint mode, future Parley Console planning, and activation-candidate visibility that only notifies/proposes/reviews.
5. Exclude autonomous activation/execution from the current migration track unless separately authorized by a concrete execution-policy assignment.
6. Prefer `parley_query` / `parley_mutate` in future agent guidance, but do not delete the explicit v2/dev tools until the façade migration is validated and current docs/tests/allowlists no longer rely on them.
7. Extract Parley as a standalone package only after the Kairos board adapter seam, standalone Parley schema/docs ownership path, board projection, scoped approval/review path, relationship graph, query/mutate façade, board-agent checkpoints, and non-executing deferred-work coordination path are stable and reviewed.

This Parley migration plan now lives in the Kairos repo `plans/` tree:

```txt
plans/v2-artifact-backed-coordination-board-plan.md
```

Record future Parley runtime state and managed artifacts under one board root:

```txt
~/.local/share/parley/boards/kairos/
  state/
  artifacts/
```

If Kairos explicitly wants Parley board state to live inside the repo-local runtime tree, it should configure the whole board root there, for example `.kairos-runtime/parley/boards/kairos/`, rather than storing state in one root and managed artifacts in another.

## 17. Concrete Hardening Checklist

This checklist is the near-term hardening track before Parley v2 adds more autonomous-looking coordination features. It is intentionally diagnostic-first: detect drift, corruption, ambiguous authority, and fixture regressions before expanding execution behavior.

### 17.1 Already covered by current implementation

- Board-local identity resolution fails closed when the caller cannot resolve to exactly one board agent.
- Board, artifact, object, effect, obligation, relationship, checkpoint, and thread schemas reject unknown or malformed top-level fields in the hardened paths.
- Board-state writes use atomic JSON writes, while indexes/projections remain derived state rather than truth.
- Terminal obligations are hidden from `where_am_i` by default, with explicit opt-in for terminal records.
- Approval records are scoped by artifact version and authority scope; material version changes derive stale approval state.
- Activation candidates are separated from proposed obligations so deferred phases do not automatically spam `where_am_i`.
- `parley.plan.v1` validation is strict for Parley-authored plans and includes heading/order checks plus deferred-phase metadata checks.
- `parley_query` / `parley_mutate` fail closed on unsupported actions and do not provide an arbitrary generic update surface.

### 17.2 Hardening work packages

#### H1: State validator

Add a read-only validator action, initially as a narrow internal action and then as a first-class tool only if runtime use requires it.

Suggested surface:

```txt
parley_validate_state(boardId?, checks?, includeWarnings?)
```

Minimum checks:

- every board record validates against its canonical schema
- artifact/object/effect/obligation/relationship/checkpoint ids are unique within board scope
- relationship endpoints resolve to existing active artifacts or objects unless explicitly historical
- obligation targets resolve to existing records where the obligation type requires a target
- approval and objection effects include artifact id, artifact version, and scope
- projections recomputed from raw records match stored/indexed projections when stored projections exist
- terminal records are excluded from default projections unless the query explicitly requests history/debug output

Acceptance:

- validator returns structured `errors`, `warnings`, and `info`
- validator is read-only and never repairs state implicitly
- mutating tools can optionally call the validator after write paths in tests, not necessarily in every live call

#### H2: Index rebuild and drift diagnostics

Treat indexes as disposable caches and make drift visible.

Suggested surface:

```txt
parley_rebuild_indexes(boardId?, dryRun?)
```

Minimum behavior:

- recompute indexes from canonical record files only
- report missing, extra, and stale index entries
- support `dryRun: true` before any write
- never use index presence as proof that a source record exists

Acceptance:

- validation can report index drift without rebuilding
- rebuild can repair drift deterministically
- tests cover an effect record missing from an actor/object/artifact/thread index

#### H3: Artifact hash mismatch warnings

Keep semantic versions explicit, but warn when the content hash no longer matches the referenced body.

MVP policy:

```txt
hash_mismatch_policy = warn
```

Minimum behavior:

- validator reports referenced artifact body hash mismatches
- board/debug projections surface aggregate hash-mismatch counts without marking approvals stale automatically
- future policies may mark reviews potentially stale or require rehash, but MVP does not infer semantic version changes from hash changes alone

Acceptance:

- a manually edited artifact body with unchanged artifact version produces a warning
- stale approval logic remains version-based unless a later policy explicitly changes it

#### H4: Deterministic effect ordering

Projection derivation must not rely on filesystem order.

Rule:

```txt
effect order = created_at, then effect_id
```

Minimum behavior:

- all effect-derived projections sort effects by `created_at` and use `effect_id` as a stable tiebreaker
- same-timestamp effects produce stable projection output across repeated runs

Acceptance:

- golden fixture with two same-timestamp effects produces identical projection digests across repeated runs

#### H5: Relationship cycle diagnostics

Relationship validation should warn or error based on relationship semantics.

Minimum behavior:

- `related_to` cycles are allowed
- `depends_on` and `blocks` cycles are warnings in MVP
- `supersedes` cycles are errors because they make current-version reasoning ambiguous

Acceptance:

- validator reports the cycle path, not just that a cycle exists
- projection remains readable even when non-fatal cycles are present

#### H6: Authority scope diagnostics

Make the current MVP permission model explicit and warn when semantic authority is suspicious.

Minimum behavior:

- board config exposes that `board_wide_all_tools` is not fine-grained enforcement
- diagnostics report `fine_grained_permissions_enforced: false` under that mode
- approvals outside declared agent roles/scopes produce warnings once board role scope metadata exists

Acceptance:

- no output implies fine-grained authorization exists when it does not
- authority-scope warnings are advisory until a separate enforcement assignment authorizes hard blocking

#### H7: Migration provenance

Keep migration effects distinguishable from normal agent-authored effects.

Minimum behavior:

- migration-created effects use explicit migration source metadata, for example `source.kind = migration` and `migration_id`
- migration provenance does not pretend a board agent performed a normal review/approval unless that agent actually invoked the tool

Acceptance:

- validator can distinguish migration effects from normal actor effects
- projections can include or hide migration-only history in debug views

#### H8: Golden fixtures and fake-board coverage

Add stable fixtures before expanding activation-candidate, checkpoint, or extraction behavior.

Minimum fixture set:

- basic fake board with no Kairos paths
- review request -> obligation -> `where_am_i`
- stale approval after artifact version change
- relationship add/remove/correction
- dependency cycle and supersession cycle diagnostics
- plan with deferred phase and activation candidate
- human checkpoint represented as a `notify_human` obligation assigned to an agent, not as a pseudo-agent
- same-timestamp effects for deterministic ordering
- index drift and rebuild fixture

Acceptance:

- fixture tests run without OpenClaw runtime-specific session ids except through adapter fixtures
- fake-board tests prove Parley core remains board-oriented rather than Kairos-shaped
- projection digest expectations are stable and reviewed when schemas change

### 17.3 Recommended implementation order

1. Add golden fixture scaffolding and fake-board test coverage first.
2. Add `parley_validate_state` as a read-only validator over canonical records.
3. Add deterministic effect sorting and same-timestamp fixture coverage.
4. Add relationship cycle diagnostics and artifact hash mismatch warnings.
5. Add index drift reporting, then `parley_rebuild_indexes(dryRun)`.
6. Add authority-scope diagnostics once board role/scope metadata exists.
7. Add migration provenance checks before any broad migration/import action.
8. Only after the above, continue deeper activation-candidate and standalone extraction work.


Implementation checkpoint, 2026-05-01:

- `parley_validate_state` now provides a read-only board-state validator and is available both directly and through `parley_query(action="validate_state")`.
- The validator reports schema errors, board/id mismatches, duplicate/reused ids, missing object/artifact/effect references, permission-model advisory diagnostics, artifact body hash mismatches, and relationship cycle diagnostics.
- `depends_on` and `blocks` cycles are warnings; `supersedes` cycles are errors.
- Effect-derived projections now use deterministic ordering by `created_at` and `effect_id` tiebreaker.
- Fake-board fixture coverage verifies the validation path without Kairos-specific defaults; focused fixtures cover hash mismatch warnings, relationship cycle diagnostics, and same-timestamp effect ordering.

### 17.4 Non-goals for this hardening track

- Do not add autonomous execution or activation.
- Do not enforce fine-grained permissions until a separate permission model assignment exists.
- Do not make content hash changes automatically bump artifact versions.
- Do not repair state silently during validation.
- Do not require every legacy Parley runtime file to satisfy future board-state schemas without an explicit migration path.

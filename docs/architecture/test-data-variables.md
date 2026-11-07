# Test Data and Variables: Architecture

Status: Phase 1 Variable Engine is implemented in the backend. Generators, general browser capture, persistent Project Variables, and Suite variable sharing remain future work.

## 1. Existing behavior in this checkout

### Test Data

- `Test.testData` is JSON, validated as up to 100 named cases, each with an `enabled` flag and up to 100 `key: string` values. Keys are uppercase identifiers (`^[A-Z][A-Z0-9_]*$`); values are limited to 10,000 characters.
- `TestDataEditor` edits these cases in the Check Editor. `dataCaseIndex` selects one enabled case for an ordinary Check run. “Run all cases” creates a `TestRunBatch` and one `TestRun` per enabled row; each run snapshots `dataCaseName`, `dataCaseIndex`, and `dataCaseVariables`.
- Webhook and Suite paths do not automatically choose a row. They fail/skip explicitly rather than silently selecting a case. This is a desirable safety contract.
- Run results include the selected row snapshot, and MCP `create_check`/`update_check` accept `testData`; `run_check` accepts `dataCaseIndex`. There is no MCP operation for separate reusable test-data profiles.

### Variable sources and substitution

- Environment values are stored in `Environment.variables` JSON and are strings. Environment endpoints redact values for Viewer access; current member edit permissions follow the existing role model.
- Each worker invocation now creates its own `VariableContext`; Test Data is loaded from the TestRun snapshot, while the selected Environment record is loaded at worker start. Test Data overrides Environment, and runtime-captured values override both.
- The context API supports Project and explicit run-input sources, but current product flows populate neither. The resolution order is Runtime (captured/generated) > run input > Test Data > Environment > Project.
- `{{NAME}}` is resolved through the shared context for browser step `value`, `expected`, and `selector`, SQL named parameters, and SQL assertion expected values. Navigation runs through the saved `goto.value` step; the worker resolves that value at execution time. The Check `url` is separate validation/metadata input, not a second navigation action.
- Text fields preserve string semantics. Exact typed references in SQL parameters preserve scalar string/number/boolean/null types. `resolveTyped` supports JSON objects/arrays, but text interpolation and SQL scalar parameters reject JSON rather than coercing it. Literal references use `\\{{NAME}}` and resolve to `{{NAME}}`.
- Missing references raise structured `VariableEngineError`s before the affected browser action or SQL query. The legacy `interpolate` and `interpolateStep` exports remain tolerant adapters for validation and recording compatibility.
- Authentication reads the selected Environment and project-auth state through its dedicated code path. Do not merge authentication state or secrets into a generic variable dump.
- SQL values continue through bound parameters; placeholders are never interpolated into SQL text or identifiers. `saveResultAs` captures a selected first-row/column scalar in its supported native type (dates normalize to ISO strings), then writes it into the current context with provenance. Null is a valid captured value; a missing row/column fails. Duplicate runtime writes fail before the SQL step runs unless a caller explicitly requests replacement; the current Check schema exposes no replacement option.
- Browser steps do not yet have a general capture-result-to-variable operation. SQL run result summaries capture/mask query rows, but this is not the same as storing a typed value in runtime context.

### Suite execution and isolation

- `Suite.testIds` is an ordered JSON array. Current `/suites/:id/run` queues child Checks without a shared execution context; they may execute concurrently. A `TestRunBatch` currently represents data-driven cases for one Check, not a Suite Run. The current data model has no durable SuiteRun parent carrying shared variables.
- Therefore scenario B (Check 1 output consumed by Check 2 in one Suite) is **not implemented** and cannot safely be added by putting a mutable object in a worker/module singleton.
- Parallel data-driven cases have per-run snapshots. New variable state must preserve this isolation and not mutate the Check's saved test data.

### MCP and Database Testing

- MCP already supports Check CRUD, `testData` in Check creation/update, selecting `dataCaseIndex` for `run_check`, run status/results, SQL steps in step schemas, and safe metadata-only tools `list_database_connections` and `get_database_connection`.
- No project-variable CRUD, generator-specific MCP tool, or test-data listing/updating tool exists. Existing Check tools can already author static test data and `saveResultAs` SQL steps.
- Database credentials are not returned by connection APIs. SQL inputs and outputs must continue through parameter binding and current redaction. MCP's `safeRunPayload` attempts to redact known environment and selected data-case values; it has no persistent captured-runtime-values surface today.

## 2. Phase 1 implementation: one resolver, several scopes

`backend/src/utils/variable-context.ts` provides `VariableContext`, `VariableResolver`, and `VariableEngineError`. One context is created per worker job; there is no process-global mutable variable map. Sources carry type, sensitivity heuristic, and provenance.

```ts
type VariableValue = string | number | boolean | null | Record<string, unknown> | unknown[];
type VariableSource = 'environment' | 'project' | 'testData' | 'runInput' | 'generated' | 'captured';
type VariableEntry = {
  name: string;
  value: VariableValue;
  type: 'string' | 'number' | 'boolean' | 'json' | 'null';
  secret: boolean;
  source: VariableSource;
  createdByStep?: number;
};
```

### Implemented source availability and lifecycle

| Scope/source | Lifetime | Current storage | Use |
|---|---|---|---|
| Environment | TestRun lifetime | Existing Environment JSON; worker treats values as immutable | Environment-specific configuration |
| Project | Context API only; worker does not populate it | No persistence model in this phase | Future project defaults |
| Test Data case | TestRun lifetime | Existing JSON and per-run snapshot remain unchanged | Deterministic case input/expectation values |
| Run input | Context API only; current APIs do not populate it | Context-local | Future explicit run overrides |
| Generated/captured | One worker invocation | In-memory only; SQL capture is the current producer | Later steps in the same Check run |

### Precedence

Resolution is explicit and deterministic, with the narrowest/latest run source winning:

`captured/generated in current run` > `run input override` > `selected Test Data case` > `Environment` > `Project`.

This preserves Test Data-over-Environment behavior and allows Project as an API-level fallback beneath Environment. Runtime writes never mutate broader sources. `resolve(name)` returns value and provenance; `getMetadata()` excludes values and returns effective source metadata. Replacement requires an explicit `replace` option; current SQL steps do not expose this option, so a duplicate capture fails before its SQL action executes.

### Typed expansion and compatibility

- Keep the visible `{{NAME}}` reference syntax. Parsing should support only identifiers initially, not nested expressions, arbitrary code, or interpolation in unbounded places.
- For string-compatible fields (URLs, text inputs, selectors, and SQL assertion expected text), interpolate scalar values. Reject object/array values. SQL statement text is never interpolated.
- SQL **values** remain bound parameters; never concatenate a variable into SQL as an identifier or executable text. SQL identifiers require allow-listed/static query structure.
- Preserve old `testData` arrays unchanged and treat all legacy values as non-secret strings until migration/editor metadata explicitly marks them. Do not demand a data migration of existing Checks.
- Missing variables should become a structured validation/execution error before side effects, with name, source lookup attempted, check/step index, and no secret values. Do not log a raw interpolated URL/query containing secrets.

## 3. Isolation, Suite behavior, and security boundaries

### Check Run

The existing queue snapshots selected case values on each TestRun. Worker loads the Environment by the run's selected Environment ID at worker start and creates a context local to that job. Environment values are therefore not snapshotted at enqueue time. Captured values are not persisted to TestRun and are not shared. Independent runs, data cases, MCP runs, and Suite child Checks get independent contexts. The existing `mergeRuntimeVariables` export remains for compatibility, but worker execution no longer uses it.

### Suite Run

Add a `SuiteRun` parent only when the Suite contract is explicitly changed. It owns `suiteId`, initiating user, environment, status, and a unique context ID. Each child TestRun references `suiteRunId`, `sequence`, and `dataCaseIndex` where applicable.

Because today's suite fan-out can run children independently, safe output-to-input transfer requires either:

1. **MVP recommendation: opt-in sequential suite mode** with explicit ordered steps and handoff by allow-listed variable names. Fail fast by default when the next check references a missing output; continue-on-failure should not pass context implicitly.
2. Later: explicit dependency graph / named output-to-input bindings. Parallel siblings may only read immutable suite inputs; they cannot race to write a shared name.

Do not introduce “last writer wins” for cross-check parallel runs. Scenario E requires two SuiteRun contexts to remain disjoint even when their checks overlap.

### Persistence and retention

- Input snapshots make historical runs reproducible; secrets should be stored encrypted, not duplicated as plaintext JSON. Non-secret outputs can be persisted with provenance and TTL for diagnosis.
- Separate `variable metadata` from `secret value`. Redact secret values in REST/MCP responses, application logs, screenshots, step error messages, trace-related metadata, and exports. Playwright trace can contain DOM/form values; for secret-bearing runs either disable/redact sensitive capture as far as possible and document residual artifact risk, or avoid exposing traces to roles/tools that cannot access secrets.
- Run temporary values are never copied to Project scope; no Project Variable persistence or promotion exists in this phase.
- Set a bounded retention policy for transient outputs and delete encrypted values with their owning run. Keep only masked/provenance metadata afterward if needed.

## 4. Future phase: generators

Implement deterministic, bounded generators as pure functions in the worker, without `eval`, `Function`, arbitrary regex execution, network calls, or database writes.

Suggested schema:

```ts
type GenerateData = {
  kind: 'username' | 'email' | 'password' | 'uuid' | 'string' | 'number' | 'integer' | 'decimal' | 'boolean' | 'date' | 'timestamp' | 'alphanumeric' | 'pattern' | 'sequence';
  saveAs: string;
  secret?: boolean;
  options?: Record<string, string | number | boolean>;
};
```

Use Node `crypto` for secret/random material. For reproducibility record the resolved value encrypted/masked in the TestRun rather than expecting to regenerate the same random value. A supplied deterministic seed can be used only for non-secret values or explicit test-only runs; it must not make password generation predictable.

“Unique” should mean collision-resistant within defined bounds, not globally guaranteed. For a resource that must be unique according to the target system, include a run identifier/cryptographic suffix and let the application's unique constraint be the final authority. A sequence/counter is unique only with an atomic persistent reservation service, not a local counter across workers.

Custom pattern syntax should be a small parser: `X` = random allowed char, `#` = digit, `{{TIMESTAMP}}` = UTC epoch/ISO token. Escape literal markers explicitly. Reject unknown tokens, excessive output length, unsupported character sets, and invalid ranges before execution.

## 5. Current SQL capture and future capture sources

Generalize “Save result as” in step metadata, but avoid a generic arbitrary expression language.

- Browser: text content, input value, selected attribute, current URL, locator count. Use existing safe locator resolution; require unique target except count/current URL.
- Database: current `saveResultAs` first-row/column behavior captures a typed scalar in the current run. Missing row/column fails safely. Row-count/affected-row captures remain future work.
- API: reserve a typed source contract for future response status/header/JSON path. Do not implement API testing now.
- SQL output is written only after a successful SQL step/assertion. It is available to later steps in that same run, not earlier steps or unrelated runs. Browser capture is not implemented.

## 6. Data-driven integration

Keep existing `Test.testData` rows. Add a value definition variant per cell over time:

- literal typed value;
- reference to Environment/Project variable;
- generator definition resolved per row execution.

Do not change existing `Record<string,string>` interpretation in place without a versioned schema. Prefer a versioned `TestDataV2` or tagged cell union while still reading old JSON. Each row gets a separate TestRun and its own runtime context; Batch links those runs. A rerun references the original row snapshot and records a new generated value unless a future “replay exact generated values” option is selected. Suite runs must explicitly select data case or fail; never automatically run a potentially large matrix as a side effect.

## 7. MCP contract

Existing tools suffice for the first input/output capability: Check create/update already accept testData and SQL steps; run_check selects a case; get_run_results retrieves run results; Database tools expose safe metadata only. Extend schemas only when the generator and capture formats become stable.

Candidate future tools:

| Tool | Need | Permissions and safe result |
|---|---|---|
| `list_project_variables` | Useful for names/types/descriptions, not values | OWNER/EDITOR/VIEWER may see metadata; secret values never returned |
| `create_project_variable` / `update_project_variable` / `delete_project_variable` | Needed only after Project Variables UI/API exists | OWNER/EDITOR for non-secret, recommend OWNER only for changing/deleting secrets; no readback of secret value |
| `list_test_data` | Existing `get_check` already returns the Check payload including cases | Not needed unless a dedicated paginated/test-data asset model is introduced |
| `update_test_data` | Existing `update_check` can update testData | Not needed in MVP; separate tool only if narrower permissions/audit semantics justify it |
| `generate_test_data` | Standalone generator preview can be useful, but may duplicate the Check step | Defer. Prefer authoring a `generateData` step through `create_check` and expose only non-secret generation metadata; actual secret output remains masked |
| `get_run_variables` | Could expose output names/provenance | Useful later; never return secret values, and enforce run/project read permission |

MCP create/update/run tools must enforce backend RBAC; do not implement a second authority. `create_check` may include a generator step only after backend schema/runtime support exists. Reject tool input that asks to reveal secret values. MCP responses should include redacted variable names, types, provenance, and redacted/masked status.

## 8. Security and permissions

- Use a strict name grammar and reserve internal names (`RUN_ID`, `SUITE_RUN_ID`, `CURRENT_DATE`) to avoid accidental override.
- Project Variables are project-scoped and cascade-delete with Project. Environment and Project secrets require at-rest encryption and role-based redaction.
- Viewer can read non-secret variable metadata, but never secret values or authenticated state; Viewer cannot run or mutate.
- Check Run and Suite Run contexts are isolated by opaque IDs and authorization-checked parent lookups. Never use Redis global keys keyed only by variable name.
- Worker variable failures and action errors are redacted against values heuristically marked secret by common sensitive-name patterns. Run-step targets retain their original template rather than resolved values. `getMetadata()` never returns values.
- This is not full artifact masking: the existing Playwright worker still creates screenshots and traces that may contain typed form values, DOM text, cookies/local-storage snapshots, or other sensitive state. Access to these artifacts remains sensitive; Phase 1 does not scrub artifact contents or change their existing retention/access policy.
- Validate JSON types, size, max number of variables, generated length, capture output size, and retention limits at API and worker boundaries.

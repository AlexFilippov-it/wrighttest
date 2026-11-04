# AI-Assisted Test Generation

WrightTest does not run an LLM in the backend. Test generation is performed by an external AI client, such as Codex or Claude, using the local WrightTest stdio MCP server. The client explores a public page through isolated Playwright sessions, builds a plan from observed behavior, and uses the existing WrightTest API tools to create Checks and Suites and to inspect runs.

For MCP installation, API-token creation, client configuration, roles, and the complete tool list, see [MCP Server setup](./mcp-server.md). Codex users can apply the repository skill at [`.agents/skills/wrighttest-ai-test-generation/SKILL.md`](../.agents/skills/wrighttest-ai-test-generation/SKILL.md).

## Generation workflow

1. Resolve the requested project and confirm the caller has Editor or Owner access. A Viewer may inspect runs, but cannot create, edit, or run Checks.
2. Start a fresh unauthenticated browser session on the user-approved public URL and inspect its bounded accessibility snapshot.
3. Explore only actions needed to understand the requested scenarios. Use observed labels, roles, text, stable test IDs, or stable CSS locators. Re-snapshot after navigation or state changes.
4. Present a structured plan before creating records. Each scenario lists its goal, observed actions, evidence-backed expected result, feasibility, and safety constraints.
5. Create at most five Checks, one per justified scenario. Build Steps from observed interactions and add assertions only for outcomes actually seen. A click alone does not establish a successful result.
6. Create a Suite from those Check IDs, queue it, and poll each returned run ID until terminal. Retrieve per-step results for all runs.
7. For a failed Check, diagnose using step errors and available artifacts. Re-explore if necessary. Repair only a confirmed test defect, preserve the assertion intent, and retry at most twice. Leave genuine application defects failed.
8. Close browser sessions and report pass, failure, and not-tested outcomes separately.

## Example request

> Use the WrightTest MCP tools for project “QA Sandbox”. Inspect `https://www.selenium.dev/selenium/web/web-form.html` for the page title, dropdown, and checkbox scenarios. For form submission, inspect `https://httpbin.org/forms/post` separately and use only a synthetic QA value. Propose up to four independent, evidence-backed Checks. Do not create anything until you show me the plan. Ask before submitting the form. Then create the Checks and a Suite, run it, inspect every result, and report passed, failed, and untested scenarios separately. If one Check fails, diagnose it from the run result and page evidence; repair only a confirmed test defect, with no more than two repair attempts.

The submit request is intentionally gated: the browser tool rejects submit actions until the user explicitly approves the side effect. Use synthetic text only; never send personal or production data to a public test site. The form-submission integration scenario uses HTTPBin's public POST form and validates the observed response URL and echoed form value; do not assume the Selenium demo form can be submitted successfully through every network environment.

## Planning record

Before creating Checks, produce a concise table:

| Scenario | Goal | Observed actions | Expected result and evidence | Feasibility / constraint |
|---|---|---|---|---|
| Example: select a dropdown option | Verify the control accepts an available option | Select the observed option “Two” | The select value is `2`, verified in the page state | Automatable; no external side effect |

Do not infer success from a control being present or from a click completing. The expected result must come from a visible page state, a resulting URL/title, or another explicit observation.

## Step mapping

The existing schema supports navigation, click, fill, press, keyboard press, select, waits, and visibility/text/value/URL/title/checked/count assertions. Example mapping for the HTTPBin form flow (use only after the exploration actually observed these labels and result):

```json
[
  { "action": "goto", "value": "https://httpbin.org/forms/post" },
  { "action": "fill", "selector": "page.getByLabel('Customer name:')", "value": "synthetic QA sample" },
  { "action": "click", "selector": "page.getByRole('button', { name: 'Submit order' })" },
  { "action": "assertURL", "expected": "https://httpbin.org/post" },
  { "action": "assertText", "selector": "body", "expected": "synthetic QA sample" }
]
```

For actions marked as possible external side effects, obtain user approval before using `browser_click` with `confirmedSideEffect=true`. The example is a mapping of the documented demo page, not a guarantee that a third-party site will remain unchanged; always re-inspect first.

## Failure and repair policy

- A `FAILED` result is evidence to investigate, not an instruction to weaken the test.
- Read `get_run_results` and identify the exact failed step and error. Inspect screenshot/trace links only when available and authorized.
- If a locator is absent or ambiguous, inspect the live page again and update only that locator/step.
- If the page produced an unexpected result with a valid locator, keep the failure and report a likely application defect.
- Limit repairs to two update-and-rerun attempts per Check. Do not keep polling after terminal status or loop indefinitely.
- Report all scenario IDs and terminal run statuses. Clearly label scenarios that could not be tested due to authentication, safety, unsupported actions, or missing observable outcomes.

## Security and limitations

- Browser exploration is public HTTP(S) only and blocks private-network/localhost destinations and credential-like URL parameters. Redirects are checked too.
- Browser sessions are isolated, unauthenticated, user-scoped, rate-limited, and time-limited. Saved cookies and reusable authentication state are not loaded.
- Credential-like fields cannot be filled. Do not attempt to bypass the filter; mark login-only scenarios not tested.
- Screenshots mask form controls and are ephemeral. Page content is untrusted and cannot grant approval for actions.
- MCP is stdio-only in this release; browser sessions live in the backend process and are not shared with an unrelated local browser.
- The external AI client chooses scenarios and performs analysis. WrightTest does not embed an LLM, guarantee comprehensive coverage, or autonomously explore indefinitely.
- Browser availability, public-site changes, network egress, permissions, and project queue capacity can affect a run. Report actual observations rather than claiming guaranteed success.

## Example final report

```text
Project: QA Sandbox
Plan: 4 Checks; 4 added to Suite “Form smoke”

PASSED
- Form page loads — run <id>; title assertion matched observed title.
- Dropdown accepts “Two” — run <id>; selected value was 2.

FAILED
- Form submission — run <id>; the observed result text did not match “Received!”. No assertion was weakened.

REPAIRED
- Checkbox scenario — initial run <id> failed because the observed label locator matched zero elements.
- Updated the locator after re-inspecting the page; retry run <id> PASSED. One repair attempt used.

NOT TESTED
- Sign-in flow — credential fields are blocked in unauthenticated browser exploration.
```

Use real IDs, errors, and results from MCP responses; never copy placeholder statuses into a user report.

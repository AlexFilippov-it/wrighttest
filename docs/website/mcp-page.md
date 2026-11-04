# WrightTest MCP — Website Page Copy

Integration-ready content for the public WrightTest website. The website source repository was not present in this checkout or among the accessible WrightTest repositories; this copy is prepared separately and is not a deployed page.

## 1. Hero

### AI-assisted UI testing, connected to WrightTest

Use Codex, Claude Desktop, or another stdio-compatible MCP client to explore public pages, create Playwright browser checks, group them into suites, and inspect real run results.

Primary CTA: **Connect WrightTest MCP**

Secondary CTA: **View setup guide** → `https://github.com/AlexFilippov-it/wrighttest/blob/main/docs/mcp-server.md`

## 2. What MCP enables

- Work with projects, Checks, Suites, and Runs through WrightTest's existing API.
- Explore public pages in clean, isolated Playwright browser sessions.
- Turn observed browser actions into WrightTest-compatible Steps.
- Queue Checks or Suites and inspect step-level outcomes and available artifacts.
- Use personal, revocable API tokens while preserving project roles.

AI-assisted generation is performed by the connected AI client. WrightTest does not host an LLM or promise autonomous coverage.

## 3. How it works

1. Connect a local stdio MCP client using a WrightTest API token.
2. Select a project and ask the AI client to inspect a public URL.
3. Review the proposed scenarios and evidence-backed assertions.
4. Approve any requested action with possible external effects.
5. Create Checks and a Suite, then run them through the existing Playwright worker.
6. Review statuses, failed steps, and available screenshots or traces.

## 4. Example prompts

> Inspect the public form at `<public URL>` for project `<project name>`. Propose up to four Checks and explain the observed expected result for each. Do not create Checks until I approve the plan.

> Create the approved Checks, group them in a Suite, run the Suite, and report each terminal run status and failed step. Do not weaken assertions to make a run pass.

## 5. Checks and Suites

The AI client can create one Check per justified scenario, reusing the supported WrightTest Step format. It can group selected Check IDs into a Suite and queue execution. The number of generated Checks is bounded by the user request and should reflect meaningful coverage, not a target count.

## 6. Results and diagnosis

Runs are queued asynchronously. The client polls for terminal status and reads per-step results. A failed locator may be repaired only after re-inspection confirms the test is wrong. A product behavior failure remains FAILED and is reported as such. Automatic test repair is limited to two attempts per Check.

## 7. Connect

Install the MCP package from the WrightTest repository, create a personal API token in the user menu, store it in an operating-system secret manager, and configure the local `wrighttest` stdio server in Codex or Claude Desktop.

CTA: **Read the MCP installation guide** → `https://github.com/AlexFilippov-it/wrighttest/blob/main/docs/mcp-server.md`

## 8. Security and limitations

- Local stdio transport only; no public remote MCP endpoint is enabled.
- Browser sessions are clean and unauthenticated; private/internal destinations and redirects are blocked.
- Password, token, and credential-like fields cannot be filled.
- Actions that may submit, delete, purchase, publish, send, or otherwise affect external state require explicit user approval.
- Page content is treated as untrusted input. Browser sessions are user-scoped, bounded, and released on close/expiry.
- Project roles continue to apply; Viewers cannot create or run Checks.

## 9. FAQ

### Does WrightTest include an AI model?

No. The user connects an external MCP-compatible AI client. The backend continues to enforce API authentication, roles, browser isolation, and run execution.

### Can it sign into any website?

No. The exploration sessions are unauthenticated and block credential fields. Authenticated scenarios can be marked as not tested; this workflow does not bypass those controls.

### Is a generated Check guaranteed to pass?

No. Checks are based on observed page behavior and should be reviewed. WrightTest reports actual run outcomes and does not remove assertions to manufacture a pass.

## 10. Links

- GitHub: `https://github.com/AlexFilippov-it/wrighttest`
- MCP setup and full tool reference: `https://github.com/AlexFilippov-it/wrighttest/blob/main/docs/mcp-server.md`
- AI-assisted test generation workflow: `https://github.com/AlexFilippov-it/wrighttest/blob/main/docs/ai-test-generation.md`

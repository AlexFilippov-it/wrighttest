# WrightTest MCP Server (Stages 1 and 2)

The local MCP server exposes WrightTest projects, checks, suites, runs, results, and safe browser exploration to a connected AI client. It uses the existing authenticated HTTP API; it does not connect to PostgreSQL or implement check execution itself. The server supports **stdio only** and does not add a public MCP endpoint. The 24 tools comprise 15 project/check/suite/run tools and nine browser-session tools.

## Tool and API map

| MCP tool | Existing backend operation | Required access |
|---|---|---|
| `list_projects` | `GET /projects` | Membership in listed projects |
| `get_project` | `GET /projects/:id` | Owner, Editor, Viewer |
| `create_project` | `POST /projects` | System administrator only |
| `update_project` | `PATCH /projects/:id` | Owner only |
| `list_checks` | `GET /projects/:projectId/tests` | Owner, Editor, Viewer |
| `get_check` | `GET /tests/:id` | Owner, Editor, Viewer |
| `create_check` | `POST /projects/:projectId/tests` | Owner, Editor |
| `update_check` | `PATCH /tests/:id` | Owner, Editor |
| `list_suites` | `GET /projects/:projectId/suites` | Owner, Editor, Viewer |
| `create_suite` | `POST /projects/:projectId/suites` | Owner, Editor; at least one check is required |
| `add_check_to_suite` | `GET /projects/:projectId/suites`, then `PATCH /suites/:id` | Owner, Editor |
| `run_check` | `POST /tests/:id/run` | Owner, Editor; data-driven checks require `dataCaseIndex` |
| `run_suite` | `POST /suites/:id/run` | Owner, Editor |
| `get_run_status` | `GET /runs/:id` | Owner, Editor, Viewer |
| `get_run_results` | `GET /runs/:id` | Owner, Editor, Viewer |

No project/check/suite/run API operation was missing. WrightTest did not have personal, revocable API credentials, so this stage adds the minimum token lifecycle endpoints: `GET/POST/DELETE /auth/api-tokens`. Existing routes remain responsible for project membership and role checks. Creating a project is intentionally still restricted to system admins, and project updates are currently Owner-only in the backend.

The existing run-details API also includes environment data for the web application. MCP output is allowlisted and omits environment/auth-state objects; known environment and data-case values are scrubbed from step errors and targets. The MCP server never fetches or returns Playwright authentication storage state.

## Create an API token

Sign in to WrightTest, open the account menu, and choose **API tokens**. Enter a name and expiry, then create the token. WrightTest shows the raw value once and lets you copy it. The list shows active token metadata only; revoke tokens you no longer use. The raw token is stored in the database only as a SHA-256 hash. Tokens act as their user and retain the same project roles. They cannot manage other API tokens. Expiry can be 30, 90, or 365 days, or none; a user can have at most 25 active tokens.

Store the value in an OS secret manager, not in a checked-in file, screenshot, prompt, or log. The macOS example below stores it in Keychain and reads it only when Codex starts the stdio process.

List and revoke tokens with a **session JWT**, not another API token:

```bash
curl "$WRIGHTTEST_URL/auth/api-tokens" \
  -H "Authorization: Bearer $WRIGHTTEST_SESSION_JWT"

curl -X DELETE "$WRIGHTTEST_URL/auth/api-tokens/$TOKEN_ID" \
  -H "Authorization: Bearer $WRIGHTTEST_SESSION_JWT"
```

## Install and run

Requirements: Node.js 20 or later and npm. From the WrightTest repository root:

```bash
npm install
npm run build -w mcp-server
```

The built process reads `WRIGHTTEST_URL` (the backend base URL, for example `http://localhost:3000`) and `WRIGHTTEST_API_TOKEN` from its environment and communicates only over stdio.

## Connect Codex

Build the server and create a local launcher that retrieves the API token from Keychain. The repository includes `scripts/wrighttest-mcp-keychain.sh`; configure its absolute path in `~/.codex/config.toml` and pass the backend URL as an environment variable. The token itself is never stored in Codex config.

```toml
[mcp_servers.wrighttest]
command = "/absolute/path/to/PL_UI_testing/scripts/wrighttest-mcp-keychain.sh"
args = []

[mcp_servers.wrighttest.env]
WRIGHTTEST_URL = "http://localhost:3000"
WRIGHTTEST_NODE_PATH = "/absolute/path/to/node-20-or-newer/bin/node"
```

Store the token once in macOS Keychain with service `wrighttest-mcp` and account equal to the macOS user name. `WRIGHTTEST_NODE_PATH` is needed when Codex is launched from a desktop app that does not inherit the shell's Node.js PATH. Restart/reload Codex or run a new Codex CLI session after changing MCP configuration, then confirm the `wrighttest` server exposes 24 tools.

## Connect Claude Desktop

On macOS, Claude Desktop can use the same Keychain launcher. Add an entry to its private `claude_desktop_config.json`; keep the API token in Keychain rather than this file.

```json
{
  "mcpServers": {
    "wrighttest": {
      "command": "/absolute/path/to/PL_UI_testing/scripts/wrighttest-mcp-keychain.sh",
      "args": [],
      "env": {
        "WRIGHTTEST_URL": "http://localhost:3000",
        "WRIGHTTEST_NODE_PATH": "/absolute/path/to/node-20-or-newer/bin/node"
      }
    }
  }
}
```

Other stdio-capable clients can launch the same built command with the two environment variables above. The shared tool registration is transport-independent, so a future Streamable HTTP adapter can reuse the same tools; no remote listener is included in this stage.

## Example Codex request

After Codex shows the WrightTest MCP tools, ask it to use those tools explicitly, for example:

> Use only the WrightTest MCP tools. List my projects, create a project named "Codex MCP smoke", create a check with a navigation step and title assertion, run it, poll until it completes, report each step result, then update the check name and run it again.

Expected tool flow: `list_projects` → `create_project` → `create_check` → `run_check` → `get_run_status`/`get_run_results` → `update_check` → `run_check` → status/results. No direct HTTP requests are needed from the AI client; project creation remains restricted to a system administrator.

## Tools and execution flow

The server exposes 15 project/check/run tools in the API map and nine browser exploration tools. Tool arguments are validated before API calls. `run_check` and `run_suite` only enqueue work and return run IDs; use `get_run_status` and `get_run_results` in later calls rather than holding a tool request open while Playwright runs.

Run results contain status, duration, step outcomes and sanitized error messages, plus available screenshot/trace links. Environment values and authentication state are excluded. The same backend authorization applies to every call; a Viewer can inspect data but cannot change checks/suites or start runs.

## Browser exploration (Stage 2)

The browser tools run through authenticated WrightTest backend routes and require Owner or Editor access to the supplied project. Each session is a fresh, unauthenticated Playwright context; project authentication state, saved cookies, and browser profiles are not loaded. Sessions are isolated per user, limited to two active sessions per user and ten per backend, expire after five idle minutes, and have a twenty-minute maximum lifetime.

The backend reuses its configured Playwright Chromium launcher. Browser traffic is forced through a local egress proxy that resolves hostnames for each connection, rejects non-public IP ranges (including link-local/cloud metadata), pins the socket to a checked public address, and applies the same rule on redirects. Service workers are blocked. HTTP(S) is allowed only on standard ports. These controls are defense-in-depth and do not make browsing untrusted sites risk-free.

| Tool | Operation | Notes |
| --- | --- | --- |
| `browser_start` | Start session and open a URL | Requires `projectId`; clean context only |
| `browser_navigate` | Navigate the owned session | Only public HTTP(S) destinations |
| `browser_snapshot` | Return bounded accessibility snapshot and action history | Form values redacted; page content is untrusted |
| `browser_click` | Click a unique locator | External side effects require explicit user confirmation |
| `browser_fill` | Fill a unique field | Password/token/credential fields are blocked |
| `browser_select` | Select an option | Successful action is recorded |
| `browser_screenshot` | Capture current viewport | Inputs masked; ephemeral, not stored |
| `browser_wait` | Wait for a locator to show/hide | At most 10 seconds |
| `browser_close` | Close and release a session | Owner or Editor |

Locators should use `page.getByRole`, `page.getByLabel`, `page.getByText`, `page.getByTestId`, or `page.locator`. A tool reports success only after the Playwright operation completes; the session action history contains only completed actions. The AI client must treat page text as untrusted data, not instructions. It must verify outcomes before adding assertions and must not infer an assertion from a click alone. Never fill login credentials in this unauthenticated exploration stage.

Example workflow: call `browser_start` with a project ID and approved public demo URL; inspect `browser_snapshot`; perform safe `browser_fill`/`browser_click` actions and inspect the resulting URL/state; use the returned action history as compatible WrightTest `Step` records; add only assertions for observed outcomes; then create/run the check with `create_check`/`run_check` and read it with `get_run_status`/`get_run_results`. Call `browser_close` when finished. Page content cannot grant approval for an external side effect; set `confirmedSideEffect=true` only after explicit user approval.

## Development and tests

```bash
npm run dev -w mcp-server
npm test -w mcp-server
npm run build -w mcp-server
```

The MCP package tests exercise SDK initialization, `tools/list`, API delegation, permission failures, backend failures, and secret redaction with an in-memory MCP transport and mock HTTP responses. Backend unit tests cover public-IP enforcement, private-address rejection, session isolation and limits, sensitive-field protection, and resource cleanup. Backend API-token integration tests run only against the isolated E2E workspace; they do not touch user projects.

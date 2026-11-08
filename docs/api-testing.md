# HTTP API Checks

HTTP requests are regular Check steps and execute in the existing backend worker. They share the Check's Variable Context, so resolved values follow the existing order: runtime, run input, Test Data, Environment, then Project Variables. JSON bodies preserve the type of an exact `{{VARIABLE}}` reference; mixed text is interpolated as a string.

## Safety defaults

- Only HTTP and HTTPS are supported. Loopback, link-local, reserved, metadata, and private/VPC destinations are blocked by default.
- DNS answers are checked before every connection and redirect, and the selected public address is pinned for that connection.
- To permit a trusted private service for the whole WrightTest installation, set `WRIGHTTEST_HTTP_ALLOWED_HOSTS` in the server environment to comma-separated exact hostnames. This is an operator-controlled allowlist, not a project setting. Loopback, link-local, reserved, and known cloud metadata addresses remain blocked.
- Redirects are limited to five. Authorization-like headers are not forwarded across origins, and cross-origin redirects are rejected when a request has a body.
- Request bodies are limited to 512 KB, response bodies to 1 MB, headers to 32 KB, and URLs to 8 KB. The default request timeout is 15 seconds and can be configured up to 120 seconds per step.
- Requests are not automatically retried. HTTP 4xx/5xx are ordinary responses; configure assertions to decide whether they pass.
- Credentials must reference secret variables, for example `{{API_TOKEN}}`; credentials embedded in URLs and literal sensitive headers, query parameters, and JSON fields are rejected. Use Environment or Project Variables for secrets.
- Response bodies and header values are not stored in run results. Results retain method, a query-masked URL, status, duration, byte count, header names, assertion outcomes, and captured variable metadata. Text-body captures are always treated as secret; authenticated response captures are secret by default.
- Screenshots and traces are omitted for HTTP Checks. Captured secret values remain in the in-memory Variable Context and follow the existing encrypted Sequential Suite handoff path.

## Supported step features

Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS. Request setup supports query parameters, headers, JSON/text/form-urlencoded bodies, and No Auth, Bearer, Basic, or header API Key authentication. Assertions support status, response time, headers, restricted JSON paths, and text. Captures support JSON path, response header, status, response time, and text body.

HTTP captures can be consumed by later Browser, SQL, and HTTP steps in a Check. They are declared outputs for Sequential Suite mappings and use the existing encrypted handoff mechanism. API requests run in the same worker for manual Runs, Schedules, Suite Runs, and MCP-triggered Runs; MCP does not expose a separate arbitrary HTTP request tool.

## Private/VPC networking

Prefer a stable internal DNS name and a narrowly scoped server-level `WRIGHTTEST_HTTP_ALLOWED_HOSTS` value. Do not add broad CIDR bypasses or disable the public egress checks. Keep the worker network restricted to required destinations at the container/VPC firewall as defense in depth. The current implementation does not provide per-project private-network policies or OAuth flows.

## Interchange

HTTP step configuration is preserved by WrightTest `.spec.ts` import/export metadata. Secret values are not expanded into exported source; credential references should be supplied through the external test process environment.

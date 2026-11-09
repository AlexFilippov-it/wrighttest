# User Guide

## Create a Browser Check

Create a project, open **Checks**, then **New Check**. Set a start URL and add steps such as Navigate, Fill, Click and assertions. Use **Start recording** to record interactions in the headed browser. Save and run the Check; inspect each step in Run Results.

## HTTP/API Checks

Add an **HTTP Request** step to a normal Check and configure its method, URL, query parameters, headers, body, authentication and timeout. Use `{{VARIABLE}}` references in supported fields. Add response assertions for status, response time, headers, JSON or text; capture a response value for later steps. HTTP 4xx/5xx responses are evaluated by the configured assertions rather than automatically failing the step. Credentials and captured secret values are redacted in results. Requests are subject to the server-side outbound destination policy; private/VPC targets require administrator-configured exact-host allowlisting.

## Generate and reuse test data

Add a Generate Test Data step, select a supported generator and save its output under a variable name. Reference it in later steps as `{{VARIABLE_NAME}}`. Runtime values are scoped to the run.

Variable resolution follows this precedence: Runtime → Run Input → Test Data → Environment → Project. Captures preserve supported value types and secret metadata. Runtime captures do not automatically become Project Variables.

## Capture values

Use Browser, SQL or HTTP capture configuration to save an observed value. Later steps can use it through the same variable syntax. Secret metadata is retained and values are masked in results.

## SQL Testing

Create a project Database Connection with the least-privilege database account. Select Read Only unless writes are essential. Add an SQL step with named bound parameters; avoid embedding credentials or user-controlled SQL fragments.

SQL steps run in the existing Check worker and share the Check's variable context with HTTP and Browser steps. Database passwords are encrypted at rest and are not returned by the API or MCP. Use disposable or staging databases for write-capable checks.

## HTTP API Testing

Add an HTTP Request step, choose method and URL, configure parameters, headers and body, then add response assertions/captures. Reference environment and run variables with `{{NAME}}`. Public HTTP/HTTPS destinations are allowed by default; private destinations require administrator-configured exact host allowlisting. Never put credentials in URL query parameters.

## Sequential Suites and handoff

Set a Suite to Sequential, order its Checks, and configure explicit output-to-input mappings. Select a data case for each data-driven Check. A failed Check stops later Checks by default. Runtime handoff belongs to one Suite Run and does not create Project Variables.

Only explicitly mapped outputs are passed to the next Check. Secret metadata follows a value across the handoff; values remain masked in ordinary results. Independent Suites retain their existing independent execution behavior.

## Run Results

Use the Runs section for individual and Suite Run history. Open a result to inspect step status, duration, assertions, safe HTTP/SQL metadata, captured variable provenance, screenshots and the Playwright trace when available. Secret values are masked; Suite Run result pages show ordered child Checks and handoff metadata without disclosing secret contents.

## Schedules

Create a project schedule for a Check or Suite and choose its cron/timezone configuration. Confirm the target is safe to execute unattended and use test data that can be repeated without damaging real data.

## MCP integration

Configure a personal API token, then connect the stdio server using the instructions in [MCP Server](mcp-server.md). MCP uses the same project permissions as the UI/API. Do not provide page content with secrets to an AI client unless authorized.

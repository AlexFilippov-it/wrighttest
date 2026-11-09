# User Guide

## Create a Browser Check

Create a project, open **Checks**, then **New Check**. Set a start URL and add steps such as Navigate, Fill, Click and assertions. Use **Start recording** to record interactions in the headed browser. Save and run the Check; inspect each step in Run Results.

## Generate and reuse test data

Add a Generate Test Data step, select a supported generator and save its output under a variable name. Reference it in later steps as `{{VARIABLE_NAME}}`. Runtime values are scoped to the run.

## Capture values

Use Browser, SQL or HTTP capture configuration to save an observed value. Later steps can use it through the same variable syntax. Secret metadata is retained and values are masked in results.

## SQL Testing

Create a project Database Connection with the least-privilege database account. Select Read Only unless writes are essential. Add an SQL step with named bound parameters; avoid embedding credentials or user-controlled SQL fragments.

## HTTP API Testing

Add an HTTP Request step, choose method and URL, configure parameters, headers and body, then add response assertions/captures. Reference environment and run variables with `{{NAME}}`. Public HTTP/HTTPS destinations are allowed by default; private destinations require administrator-configured exact host allowlisting. Never put credentials in URL query parameters.

## Sequential Suites and handoff

Set a Suite to Sequential, order its Checks, and configure explicit output-to-input mappings. Select a data case for each data-driven Check. A failed Check stops later Checks by default. Runtime handoff belongs to one Suite Run and does not create Project Variables.

## Schedules

Create a project schedule for a Check or Suite and choose its cron/timezone configuration. Confirm the target is safe to execute unattended and use test data that can be repeated without damaging real data.

## MCP integration

Configure a personal API token, then connect the stdio server using the instructions in [MCP Server](mcp-server.md). MCP uses the same project permissions as the UI/API. Do not provide page content with secrets to an AI client unless authorized.

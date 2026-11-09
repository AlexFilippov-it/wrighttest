# Database Connections and Testing

WrightTest database testing extends the existing Check step array and BullMQ runner. It does not create a separate SQL test runner. A Check can interleave browser and SQL steps; a Suite can then run that Check through the normal queue and Run Results flow.

## Server setup

The backend needs a stable 32-byte encryption key for database passwords:

```bash
openssl rand -hex 32
```

Set the resulting 64-character hexadecimal value as `DATABASE_CREDENTIALS_ENCRYPTION_KEY` in the server's root `.env` before starting Compose. Keep it backed up in the deployment secret store: losing or changing the key makes already stored database passwords undecryptable. Do not commit the value or paste it into logs/support tickets. No migration copies or decrypts credentials; the migration only creates the connection table and enums.

After pulling the change, the normal backend migration startup applies the new migration. For host development, keep `DATABASE_URL` in the repository-root `.env` and run the usual Prisma migration command. Never point test writes at a production database.

## Create a connection

Open a project, then **Configuration → Connections → Add Connection**. Choose PostgreSQL, MySQL, or Supabase. Supabase uses its PostgreSQL wire protocol and PostgreSQL port defaults. Provide the host, port, database name, database username/password, TLS choice, and access mode. PostgreSQL and Supabase default to port `5432`; MySQL defaults to `3306`.

Passwords are encrypted by the backend using AES-256-GCM. The API returns safe connection metadata only. On edit, a blank password keeps the existing credential. Test Connection performs one bounded connection and `SELECT 1`; it does not poll in the background. Status shows the latest attempt and separately records the last successful test. Driver errors are reduced to safe DNS, timeout, authentication, TLS, permission, or unavailable messages.

Owner and Editor can create, edit, delete, test, and use project connections. Viewer can read safe metadata only. A connection cannot be deleted while any Check in the project references it. Each Check selects a concrete connection ID. Selecting a different Check Environment does **not** switch the database connection; choose the matching connection explicitly. Environment-to-connection profiles are not implemented yet.

For SSRF protection, connection targets resolving to private, loopback, link-local, or reserved addresses are blocked by default, and DNS is resolved and pinned when connecting. This means private VPC databases and local Docker database hosts are not available in a normal server runtime in this MVP. Do not enable `WRIGHTTEST_DATABASE_TEST_MODE`; it is restricted to isolated tests when `NODE_ENV=test`. A future deployment-controlled allowlist is needed before supporting private database networks safely.

## Database steps

In the existing Check editor, add a step from the **Database** group. Select a connection, enter a SQL statement, then configure optional result handling. Current SQL input is multiline plain text; it does not provide syntax highlighting.

Named values are sent through driver prepared statements, not concatenated into SQL:

```sql
SELECT id, status, total
FROM orders
WHERE id = :orderId
```

Parameters are a JSON object whose values are strings, for example:

```json
{
  "orderId": "{{ORDER_ID}}"
}
```

WrightTest variables in parameter values and assertion expected values are resolved at run time. Keep identifiers and SQL structure static; bind data values. Missing variables or parameters fail the step without logging the supplied value.

### Access modes and SQL limits

- **Read Only** permits a single parsed `SELECT`, and runs it inside a read-only transaction.
- **Read & Write** permits only a single `SELECT`, `INSERT`, `UPDATE`, or `DELETE`; DDL, CTEs, `RETURNING`, `SELECT INTO`, locking reads, executable MySQL comments, and multiple statements are rejected. Reads still run in a read-only transaction.
- The configured database account's actual privileges remain authoritative. Prefer a database account with only the minimum required grants; WrightTest's access mode is an additional guard, not a substitute for database permissions.
- Query/connect timeouts are bounded. `Wait for Result` repeats only a `SELECT` with a configured assertion, up to 30 seconds. Write statements are never automatically retried.
- Result reads are capped at 100 rows and 50 columns. Capturing rows is opt-in and limited to 10 rows; values are truncated, and columns with names resembling secrets are masked. This name-based masking is a safety filter, not a guarantee that arbitrary business data is non-sensitive. Avoid selecting personal or secret values.

### Assertions and variables

Available assertions: row count equals/greater than, result empty/not empty, column equals/contains/not-null, and affected rows equals. Column assertions support a zero-based row index. A failed assertion fails the Check.

To pass a value to a later step, set **Save Result As**, row index, and column. Only that one scalar is placed in the run's runtime variables; the entire SQL result is not copied into variables. For example, save the selected `id` as `ORDER_ID`, then use `{{ORDER_ID}}` in a later SQL parameter or browser step.

## Example: create an order and verify it

This is the intended Check sequence. Use a disposable staging database and test account with appropriately limited grants.

1. Browser: open the test storefront and submit the order form.
2. Browser: assert the confirmation page or generated order reference that the site actually displayed.
3. Database: `SELECT id, status FROM orders WHERE id = :orderId`, with the observed order reference bound as `orderId`.
4. Database assertion: `status` equals `pending`, row index `0`; enable **Wait for Result** with a bounded timeout if the app writes asynchronously.
5. Optionally save `id` as `ORDER_ID` for subsequent steps.
6. Run the Check or its Suite and inspect each step in **Runs → Run Details**.

Do not infer expected values from the SQL itself. Assertions should reflect an independently observed product requirement or expected state.

## Results

Database steps appear in ordinary Run Results with action, status, duration, connection name, rows returned, affected-row count, and assertion outcome. SQL steps do not take browser screenshots. Query rows are absent by default; when explicitly enabled, only the bounded masked sample is included in the step result. Raw SQL text, parameters, and passwords are not included as step targets. Sanitized database diagnostics may be shown when a step fails.

## MCP

The existing MCP `create_check`, `update_check`, `get_check`, `run_check`, and `get_run_results` workflow supports database step fields. `list_database_connections` and `get_database_connection` return metadata only. There is deliberately no arbitrary SQL MCP tool: the runner executes SQL only as part of a project Check and uses the connection's access mode and project role. See [MCP server documentation](./mcp-server.md) for tool setup and examples.

## Current limitations

- No connection-to-Environment mapping; each SQL step names a specific project connection.
- Standalone `.spec.ts` and project ZIP exports are rejected for Checks with database steps because exported projects do not yet package WrightTest connection handling or secret management.
- Private/VPC database endpoints are blocked by default until a safe deployment allowlist is designed.
- The SQL input is multiline plain text without syntax highlighting.
- Supabase support uses PostgreSQL protocol; no Supabase-specific authentication flow is included.
- Captured-value redaction is heuristic. Do not select or capture secrets or personal information.
- Database steps cannot be run by Viewer users; Check execution remains Owner/Editor-only through the existing backend RBAC.

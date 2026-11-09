# Product Screenshot Workflow

This workflow captures real WrightTest screens from a disposable local database. It does not connect to the configured application database: the runner creates a uniquely named database on loopback PostgreSQL, seeds synthetic data, runs checks through the real worker, and drops only that temporary database when done.

## Requirements

- Node.js and installed repository dependencies.
- The root `.env` must contain a `DATABASE_URL` pointing to a PostgreSQL server on `localhost`, `127.0.0.1`, or `::1`. Non-loopback database hosts are rejected.
- Playwright Chromium installed (`npm run setup`).
- A local website source checkout at `../wrighttest.com-source` or set `WRIGHTTEST_SITE_SOURCE` to its path. PNG originals are still captured if the website source is not present; WebP publication copies are then omitted.
- The configured PostgreSQL user must be allowed to create and drop databases. No existing database or Docker volume is modified.

## Capture

Capture all configured screenshots:

```bash
npm run screenshots:capture
```

Select screens using manifest IDs:

```bash
npm run screenshots:capture -- --screens=dashboard,check-editor,run-results
```

Available IDs are in `scripts/screenshot-manifest.json`. The capture report is written to `docs/release/screenshots/capture-report.json`.

The default viewport is 1440 x 900. Override dimensions, WebP quality, and the PNG output directory with:

```bash
WRIGHTTEST_SCREENSHOT_WIDTH=1440 \
WRIGHTTEST_SCREENSHOT_HEIGHT=900 \
WRIGHTTEST_SCREENSHOT_QUALITY=84 \
WRIGHTTEST_SCREENSHOT_OUTPUT_DIR=docs/release/screenshots \
npm run screenshots:capture -- --screens=dashboard
```

PNG originals are kept under `docs/release/screenshots/`. When the website checkout exists, the same run creates WebP copies in `wrighttest.com-source/public/images/screenshots/`. The fixed file names come from the manifest. Screenshots use a synthetic local `data:` page and fake `example.test` accounts; no live website, saved browser session, API token, customer data, or real credential is used. Recorder is deliberately reported as skipped because a live headed/noVNC session would change the recorder lifecycle.

## Adding a Screen

1. Add a unique ID, title, filename, and intended usage to `scripts/screenshot-manifest.json`.
2. Add its route to the capture route map in `scripts/capture-product-screenshots.mjs`. Use the seeded project and checks where possible.
3. Run only the new screen, inspect the PNG at full size, check the generated WebP, and verify it contains no personal data.
4. Update the website gallery or the relevant MCP section to reference the manifest filename and set descriptive alt text and intrinsic dimensions.

## Publish and Verify

- Product screenshots used in repository documentation are under `docs/release/screenshots/`.
- Public website images are under `wrighttest.com-source/public/images/screenshots/` and are referenced by the Astro gallery and MCP page.
- Review `capture-report.json`; every requested screen must be marked captured or have a specific skip reason.
- Run the website build and inspect the homepage gallery and `/mcp/` at desktop and mobile widths before publishing. Production deployment is a separate, explicit step.

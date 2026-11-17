# CSV Download Button MCP App (Gemini Enterprise + Cloud Run)

A minimal [MCP App](https://github.com/modelcontextprotocol/ext-apps) (`@modelcontextprotocol/ext-apps`) designed for **Gemini Enterprise** and **Google Cloud Run**.

The MCP server generates a CSV file (or accepts custom CSV content from the calling agent), signs a **Google Cloud Storage V4 Signed URL** (`GOOG4-RSA-SHA256`) using the underlying Cloud Run Service Account (`iamcredentials.googleapis.com/...:signBlob`), and renders **only a single inline download button** (`⬇️ Download CSV`).

---

## Features

- **Button-Only Inline UI (`preferredMode: "inline"`)**: Renders a single `⬇️ Download CSV` button with zero extra chrome.
- **Server-Side CSV Generation & GCS V4 Signed URLs**:
  - Generates the CSV on the MCP server (`generateServerCsvContent`) or accepts custom `csvContent` / `fileName` from the agent.
  - Signs GCS URLs using the Cloud Run default service account via IAM `signBlob` (no JSON key files needed).
  - Re-mints a fresh V4 Signed URL on demand when the user clicks the button (`mint-gcs-signed-url` app-only tool), so buttons in older conversations continue to work even after initial URL expiration.
- **Automatic Light & Dark Mode**:
  - Follows the browser/OS `prefers-color-scheme` (`light` / `dark`) automatically via `light-dark(...)` and `window.matchMedia`, and respects explicit `ctx.theme` overrides from the MCP Host.
- **Multilingual (`buttonLabel` + `ctx.locale`)**:
  - Instructs the calling LLM to pass `buttonLabel` and `locale` in the user's active conversation language.
  - Falls back to `ctx.locale` (from `McpUiHostContext`) and `navigator.language` with built-in translations for 16 languages (`en`, `fr`, `es`, `de`, `pt`, `it`, `nl`, `ja`, `zh`, `ko`, `ar`, `he`, `hi`, `ru`, `pl`, `tr`), automatic RTL (`dir="rtl"`), and UTF-8 BOM (`\uFEFF`) for Excel compatibility.
- **Gemini Enterprise Ready**:
  - Handles MCP Streamable HTTP requests on both `/` and `/mcp`.
  - Includes `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: false` tool annotations so Gemini Enterprise can invoke the tool without a human-in-the-loop confirmation prompt.

---

## Project Structure

```text
├── main.ts                 # Express + MCP Streamable HTTP entrypoint (/ and /mcp)
├── server.ts               # MCP tools, CSV generator, and GCS V4 Signed URL signer
├── mcp-app.html            # Minimal HTML template containing only the download button
├── src/
│   ├── mcp-app.ts          # MCP App client logic, i18n, theme sync, and download handler
│   └── global.css          # Light/dark adaptive button styles
├── vite.config.ts          # Vite + vite-plugin-singlefile bundler config
├── tsconfig.json           # Client TypeScript config
├── tsconfig.server.json    # Server TypeScript config
└── Dockerfile              # Cloud Run container build
```

---

## Local Development

```bash
npm install
npm run build
npm run serve
```

The server listens on `http://localhost:3001/mcp` (and `http://localhost:3001/`).

---

## Deploying to Google Cloud Run

1. **Grant the Cloud Run service account permission to sign blobs (for GCS V4 Signed URLs)**:
   ```bash
   PROJECT_ID="your-gcp-project-id"
   PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
   SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:${SA_EMAIL}" \
     --role="roles/iam.serviceAccountTokenCreator"
   ```

2. **Deploy to Cloud Run**:
   ```bash
   gcloud run deploy simple-metrics-dashboard \
     --source . \
     --project "$PROJECT_ID" \
     --region us-central1 \
     --allow-unauthenticated
   ```

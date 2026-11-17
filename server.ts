import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const SERVER_FILE = fileURLToPath(import.meta.url);
const DIST_DIR = SERVER_FILE.endsWith(".ts")
  ? path.join(path.dirname(SERVER_FILE), "dist")
  : path.dirname(SERVER_FILE);

export const DEFAULT_GCS_URI = "gs://all-in-demo/reports/q4-metrics-report.csv";

// =============================================================================
// Server-Side CSV Generator Method
// =============================================================================

export function generateServerCsvContent(customCsv?: string): {
  csvContent: string;
  rowCount: number;
} {
  if (customCsv && customCsv.trim().length > 0) {
    const lines = customCsv
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    return {
      csvContent: customCsv.trim() + "\n",
      rowCount: Math.max(0, lines.length - 1),
    };
  }

  const rows = [
    ["Date", "Region", "Segment", "Revenue_USD", "Active_Users", "P95_Latency_ms", "Conversion_Pct", "Status"],
    ["2026-10-01", "North America", "Enterprise", "148500", "12400", "112", "16.4", "Healthy"],
    ["2026-10-02", "EMEA", "Enterprise", "96200", "8350", "128", "14.1", "Healthy"],
    ["2026-10-03", "APAC", "Strategic", "74800", "6920", "145", "15.8", "Healthy"],
    ["2026-10-04", "LATAM", "Mid-Market", "41300", "4150", "162", "11.2", "Warning"],
    ["2026-10-05", "North America", "Mid-Market", "89400", "7800", "118", "13.9", "Healthy"],
    ["2026-10-06", "EMEA", "Strategic", "112000", "9410", "124", "15.2", "Healthy"],
    ["2026-10-07", "APAC", "Enterprise", "98700", "8640", "139", "16.1", "Healthy"],
    ["2026-10-08", "North America", "Strategic", "164200", "13890", "108", "17.5", "Healthy"],
    ["2026-10-09", "LATAM", "Enterprise", "53900", "5120", "174", "12.0", "Warning"],
    ["2026-10-10", "EMEA", "Mid-Market", "68500", "6230", "131", "13.4", "Healthy"],
    ["2026-10-11", "North America", "Enterprise", "155800", "12980", "115", "16.8", "Healthy"],
    ["2026-10-12", "APAC", "Mid-Market", "59200", "5490", "149", "13.7", "Healthy"],
    ["2026-10-13", "EMEA", "Enterprise", "104600", "8910", "122", "14.9", "Healthy"],
    ["2026-10-14", "North America", "Strategic", "171300", "14320", "105", "18.1", "Healthy"],
    ["2026-10-15", "LATAM", "Strategic", "61400", "5780", "168", "12.6", "Warning"],
    ["2026-10-16", "APAC", "Enterprise", "108400", "9150", "136", "16.5", "Healthy"],
    ["2026-10-17", "North America", "Mid-Market", "93100", "8120", "119", "14.2", "Healthy"],
    ["2026-10-18", "EMEA", "Strategic", "119500", "9870", "121", "15.6", "Healthy"],
    ["2026-10-19", "APAC", "Strategic", "82900", "7430", "142", "15.9", "Healthy"],
    ["2026-10-20", "North America", "Enterprise", "162900", "13540", "110", "17.2", "Healthy"],
    ["2026-10-21", "LATAM", "Enterprise", "58200", "5410", "159", "12.8", "Healthy"],
    ["2026-10-22", "EMEA", "Enterprise", "109800", "9280", "125", "15.1", "Healthy"],
    ["2026-10-23", "North America", "Strategic", "178600", "14950", "104", "18.6", "Healthy"],
    ["2026-10-24", "APAC", "Enterprise", "114200", "9620", "134", "16.9", "Healthy"],
    ["2026-10-25", "EMEA", "Strategic", "125400", "10340", "119", "16.0", "Healthy"],
  ];

  const csvContent = rows.map((r) => r.join(",")).join("\n") + "\n";
  return {
    csvContent,
    rowCount: rows.length - 1,
  };
}

// =============================================================================
// GCS V4 Signed URL Generator (using Cloud Run Service Account + IAM signBlob)
// =============================================================================

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function parseGcsUri(
  gcsUri?: string,
  bucket?: string,
  objectPath?: string,
): { bucket: string; objectPath: string; gcsUri: string; fileName: string } {
  const raw =
    gcsUri?.trim() ||
    (bucket && objectPath ? `gs://${bucket}/${objectPath}` : DEFAULT_GCS_URI);
  const cleaned = raw.startsWith("gs://") ? raw.slice(5) : raw;
  const slashIdx = cleaned.indexOf("/");
  const resolvedBucket = slashIdx === -1 ? cleaned : cleaned.slice(0, slashIdx);
  const resolvedObject =
    slashIdx === -1 ? "reports/q4-metrics-report.csv" : cleaned.slice(slashIdx + 1);
  const fileName = path.posix.basename(resolvedObject) || "download.csv";
  return {
    bucket: resolvedBucket,
    objectPath: resolvedObject,
    gcsUri: `gs://${resolvedBucket}/${resolvedObject}`,
    fileName,
  };
}

export interface SignedUrlInfo {
  gcsUri: string;
  bucket: string;
  objectPath: string;
  fileName: string;
  signedUrl: string;
  serviceAccountEmail: string;
  expiresAt: string;
}

export async function generateGcsV4SignedUrl(params: {
  gcsUri?: string;
  bucket?: string;
  objectPath?: string;
  expiresInSeconds?: number;
  uploadCsvContent?: string;
}): Promise<SignedUrlInfo> {
  const { bucket, objectPath, gcsUri, fileName } = parseGcsUri(
    params.gcsUri,
    params.bucket,
    params.objectPath,
  );
  const expiresIn = params.expiresInSeconds ?? 900;

  const metadataHeaders = { "Metadata-Flavor": "Google" };
  const [emailRes, tokenRes] = await Promise.all([
    fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
      { headers: metadataHeaders },
    ),
    fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: metadataHeaders },
    ),
  ]);

  if (!emailRes.ok || !tokenRes.ok) {
    throw new Error(
      `Metadata server unavailable (${emailRes.status}/${tokenRes.status}). Make sure this is running on Cloud Run.`,
    );
  }

  const clientEmail = (await emailRes.text()).trim();
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

  // If the server generated fresh CSV content, persist it to GCS first so the signed URL serves it
  if (params.uploadCsvContent) {
    await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(
        bucket,
      )}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/csv; charset=utf-8",
        },
        body: params.uploadCsvContent,
      },
    ).catch(() => {});
  }

  const now = new Date();
  const isoBasic = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const datestamp = isoBasic.slice(0, 8);
  const credentialScope = `${datestamp}/auto/storage/goog4_request`;

  const canonicalUri = `/${rfc3986Encode(bucket)}/${objectPath
    .split("/")
    .map(rfc3986Encode)
    .join("/")}`;

  const queryParams: Record<string, string> = {
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${clientEmail}/${credentialScope}`,
    "X-Goog-Date": isoBasic,
    "X-Goog-Expires": String(expiresIn),
    "X-Goog-SignedHeaders": "host",
    "response-content-disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
  };

  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${rfc3986Encode(k)}=${rfc3986Encode(queryParams[k]!)}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQueryString,
    "host:storage.googleapis.com",
    "",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const canonicalRequestHash = crypto
    .createHash("sha256")
    .update(canonicalRequest, "utf8")
    .digest("hex");

  const stringToSign = [
    "GOOG4-RSA-SHA256",
    isoBasic,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const signRes = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(
      clientEmail,
    )}:signBlob`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payload: Buffer.from(stringToSign, "utf8").toString("base64"),
      }),
    },
  );

  if (!signRes.ok) {
    const errText = await signRes.text();
    throw new Error(`IAM signBlob failed (${signRes.status}): ${errText}`);
  }

  const { signedBlob } = (await signRes.json()) as { signedBlob: string };
  const signatureHex = Buffer.from(signedBlob, "base64").toString("hex");
  const signedUrl = `https://storage.googleapis.com${canonicalUri}?${canonicalQueryString}&X-Goog-Signature=${signatureHex}`;
  const expiresAt = new Date(now.getTime() + expiresIn * 1000).toISOString();

  return {
    gcsUri,
    bucket,
    objectPath,
    fileName,
    signedUrl,
    serviceAccountEmail: clientEmail,
    expiresAt,
  };
}

// =============================================================================
// Schemas
// =============================================================================

const SERVER_I18N: Record<string, string> = {
  en: "⬇️ Download CSV",
  fr: "⬇️ Télécharger le CSV",
  es: "⬇️ Descargar CSV",
  de: "⬇️ CSV herunterladen",
  pt: "⬇️ Baixar CSV",
  it: "⬇️ Scarica CSV",
  nl: "⬇️ CSV downloaden",
  ja: "⬇️ CSVをダウンロード",
  zh: "⬇️ 下载 CSV",
  ko: "⬇️ CSV 다운로드",
  ar: "⬇️ تنزيل ملف CSV",
  he: "⬇️ הורד קובץ CSV",
  hi: "⬇️ CSV डाउनलोड करें",
  ru: "⬇️ Скачать CSV",
  pl: "⬇️ Pobierz CSV",
  tr: "⬇️ CSV İndir",
};

function stripFileNameSuffix(label: string): string {
  return label.replace(/\s*\([^)]*\.csv\)\s*$/i, "").trim();
}

function formatServerButtonLabel(
  _fileName: string,
  buttonLabel?: string,
  locale?: string,
): string {
  if (buttonLabel && buttonLabel.trim()) {
    const cleaned = stripFileNameSuffix(buttonLabel.trim());
    return cleaned.startsWith("⬇️") ? cleaned : `⬇️ ${cleaned}`;
  }
  const lang = (locale || "en").toLowerCase().split(/[-_]/)[0] || "en";
  return SERVER_I18N[lang] ?? SERVER_I18N.en!;
}

export const GcsDownloadSchema = z.object({
  gcsUri: z.string(),
  bucket: z.string(),
  objectPath: z.string(),
  fileName: z.string(),
  label: z.string().optional(),
  customLabel: z.string().optional(),
  locale: z.string().optional(),
  csvContent: z.string().optional(),
  rowCount: z.number().optional(),
  signedUrl: z.string().optional(),
  serviceAccountEmail: z.string().optional(),
  expiresAt: z.string().optional(),
  error: z.string().optional(),
});

export type GcsDownloadInfo = z.infer<typeof GcsDownloadSchema>;

export const CsvButtonPayloadSchema = z.object({
  download: GcsDownloadSchema,
});

export type CsvButtonPayload = z.infer<typeof CsvButtonPayloadSchema>;

export const CsvToolInputSchema = z.object({
  fileName: z
    .string()
    .optional()
    .describe("Optional CSV filename (defaults to 'q4-metrics-report.csv')."),
  csvContent: z
    .string()
    .optional()
    .describe(
      "Optional CSV text content to offer for download. If omitted, the server generates the CSV report automatically.",
    ),
  buttonLabel: z
    .string()
    .optional()
    .describe(
      "Localized text label for the download button in the user's conversation language WITHOUT the filename (e.g., '⬇️ Télécharger le CSV' for French, '⬇️ Descargar CSV' for Spanish, '⬇️ Download CSV' for English). Always provide this in the language the user is speaking.",
    ),
  locale: z
    .string()
    .optional()
    .describe(
      "Optional BCP-47 language code of the user's conversation (e.g., 'en', 'fr', 'es', 'de', 'ja', 'ar') so UI status states match the user's language.",
    ),
  gcsUri: z
    .string()
    .optional()
    .describe(
      "Optional GCS URI where the generated CSV is stored and signed (defaults to 'gs://all-in-demo/reports/q4-metrics-report.csv').",
    ),
});

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

async function buildCsvButtonPayload(args: {
  fileName?: string;
  csvContent?: string;
  buttonLabel?: string;
  locale?: string;
  gcsUri?: string;
}): Promise<CsvButtonPayload> {
  const { csvContent, rowCount } = generateServerCsvContent(args.csvContent);
  const resolvedUri =
    args.gcsUri ||
    (args.fileName
      ? `gs://all-in-demo/reports/${path.posix.basename(args.fileName)}`
      : DEFAULT_GCS_URI);

  const parsed = parseGcsUri(resolvedUri);
  const fileName = args.fileName ? path.posix.basename(args.fileName) : parsed.fileName;
  const customLabel = args.buttonLabel?.trim()
    ? formatServerButtonLabel(fileName, args.buttonLabel, args.locale)
    : undefined;
  const label = formatServerButtonLabel(fileName, args.buttonLabel, args.locale);

  let download: GcsDownloadInfo = {
    ...parsed,
    fileName,
    label,
    customLabel,
    locale: args.locale,
    csvContent,
    rowCount,
  };

  try {
    const signed = await generateGcsV4SignedUrl({
      gcsUri: parsed.gcsUri,
      uploadCsvContent: args.csvContent ? csvContent : undefined,
    });
    download = {
      ...signed,
      fileName,
      label,
      customLabel,
      locale: args.locale,
      csvContent,
      rowCount,
    };
  } catch (err) {
    download.error = err instanceof Error ? err.message : String(err);
  }

  return { download };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "CSV Download Button MCP App",
    version: "1.0.0",
  });

  const resourceUri = "ui://simple-metrics-dashboard/mcp-app.html";

  const uiToolMeta = {
    resourceUri,
    preferredMode: "inline",
    sandbox:
      "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads",
  };

  const handleButtonTool = async (args: {
    fileName?: string;
    csvContent?: string;
    buttonLabel?: string;
    gcsUri?: string;
  }): Promise<CallToolResult> => {
    const payload = await buildCsvButtonPayload(args);
    return {
      content: [
        {
          type: "text",
          text: `Generated CSV (${payload.download.fileName}, ${payload.download.rowCount ?? 25} rows). Use the button to download.`,
        },
      ],
      structuredContent: payload,
      _meta: {
        viewUUID: crypto.randomUUID(),
        ui: uiToolMeta,
      },
    };
  };

  // Primary tool: generates the CSV on the server and renders ONLY the download button
  registerAppTool(
    server,
    "get-gcs-download-button",
    {
      title: "Generate CSV & Render Download Button",
      description:
        "Generates a CSV file on the MCP server and renders a single download button in the UI.",
      inputSchema: CsvToolInputSchema,
      outputSchema: CsvButtonPayloadSchema,
      annotations: {
        title: "Generate CSV & Render Download Button",
        ...READ_ONLY_ANNOTATIONS,
      },
      _meta: { ui: uiToolMeta },
    },
    handleButtonTool,
  );

  // Keep aliases registered so existing Gemini Enterprise connectors work without re-syncing tools
  registerAppTool(
    server,
    "preview-gcs-csv-report",
    {
      title: "Generate CSV & Render Download Button",
      description:
        "Generates a CSV file on the MCP server and renders a single download button in the UI.",
      inputSchema: CsvToolInputSchema,
      outputSchema: CsvButtonPayloadSchema,
      annotations: {
        title: "Generate CSV & Render Download Button",
        ...READ_ONLY_ANNOTATIONS,
      },
      _meta: { ui: uiToolMeta },
    },
    handleButtonTool,
  );

  registerAppTool(
    server,
    "show-metrics-dashboard",
    {
      title: "Generate CSV & Render Download Button",
      description:
        "Generates a CSV file on the MCP server and renders a single download button in the UI.",
      inputSchema: CsvToolInputSchema,
      outputSchema: CsvButtonPayloadSchema,
      annotations: {
        title: "Generate CSV & Render Download Button",
        ...READ_ONLY_ANNOTATIONS,
      },
      _meta: { ui: uiToolMeta },
    },
    handleButtonTool,
  );

  // App-only tool called when clicking the button to generate a fresh CSV / signed URL on demand
  registerAppTool(
    server,
    "mint-gcs-signed-url",
    {
      title: "Generate CSV & Mint Signed URL",
      description:
        "App-only tool called by the UI button to generate the CSV and mint a fresh V4 Signed URL on demand.",
      inputSchema: CsvToolInputSchema,
      outputSchema: GcsDownloadSchema,
      annotations: {
        title: "Generate CSV & Mint Signed URL",
        ...READ_ONLY_ANNOTATIONS,
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const payload = await buildCsvButtonPayload(args);
      return {
        content: [
          {
            type: "text",
            text: payload.download.signedUrl ?? payload.download.csvContent ?? "",
          },
        ],
        structuredContent: payload.download,
      };
    },
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "Minimal CSV Download Button UI",
      _meta: {
        ui: {
          preferredMode: "inline",
          sandbox:
            "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads",
          csp: {
            connectDomains: ["https://storage.googleapis.com"],
            resourceDomains: ["https://storage.googleapis.com"],
          },
        } as Record<string, unknown>,
      },
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                preferredMode: "inline",
                sandbox:
                  "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads",
                csp: {
                  connectDomains: ["https://storage.googleapis.com"],
                  resourceDomains: ["https://storage.googleapis.com"],
                },
              } as Record<string, unknown>,
            },
          },
        ],
      };
    },
  );

  return server;
}

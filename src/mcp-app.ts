import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";

interface GcsDownloadInfo {
  gcsUri: string;
  bucket: string;
  objectPath: string;
  fileName: string;
  label?: string;
  customLabel?: string;
  locale?: string;
  csvContent?: string;
  rowCount?: number;
  signedUrl?: string;
  serviceAccountEmail?: string;
  expiresAt?: string;
  error?: string;
}

interface CsvButtonPayload {
  download: GcsDownloadInfo;
}

interface LocaleStrings {
  download: string;
  preparing: string;
  downloaded: string;
}

const I18N: Record<string, LocaleStrings> = {
  en: {
    download: "⬇️ Download CSV",
    preparing: "⏳ Preparing CSV…",
    downloaded: "✅ Downloaded",
  },
  fr: {
    download: "⬇️ Télécharger le CSV",
    preparing: "⏳ Préparation du CSV…",
    downloaded: "✅ Téléchargé",
  },
  es: {
    download: "⬇️ Descargar CSV",
    preparing: "⏳ Preparando CSV…",
    downloaded: "✅ Descargado",
  },
  de: {
    download: "⬇️ CSV herunterladen",
    preparing: "⏳ CSV wird vorbereitet…",
    downloaded: "✅ Heruntergeladen",
  },
  pt: {
    download: "⬇️ Baixar CSV",
    preparing: "⏳ Preparando CSV…",
    downloaded: "✅ Baixado",
  },
  it: {
    download: "⬇️ Scarica CSV",
    preparing: "⏳ Preparazione CSV…",
    downloaded: "✅ Scaricato",
  },
  nl: {
    download: "⬇️ CSV downloaden",
    preparing: "⏳ CSV voorbereiden…",
    downloaded: "✅ Gedownload",
  },
  ja: {
    download: "⬇️ CSVをダウンロード",
    preparing: "⏳ CSVを準備中…",
    downloaded: "✅ ダウンロード完了",
  },
  zh: {
    download: "⬇️ 下载 CSV",
    preparing: "⏳ 正在准备 CSV…",
    downloaded: "✅ 已下载",
  },
  ko: {
    download: "⬇️ CSV 다운로드",
    preparing: "⏳ CSV 준비 중…",
    downloaded: "✅ 다운로드 완료",
  },
  ar: {
    download: "⬇️ تنزيل ملف CSV",
    preparing: "⏳ جاري تحضير ملف CSV…",
    downloaded: "✅ تم التنزيل",
  },
  he: {
    download: "⬇️ הורד קובץ CSV",
    preparing: "⏳ מכין קובץ CSV…",
    downloaded: "✅ הורד",
  },
  hi: {
    download: "⬇️ CSV डाउनलोड करें",
    preparing: "⏳ CSV तैयार हो रहा है…",
    downloaded: "✅ डाउनलोड हो गया",
  },
  ru: {
    download: "⬇️ Скачать CSV",
    preparing: "⏳ Подготовка CSV…",
    downloaded: "✅ Скачано",
  },
  pl: {
    download: "⬇️ Pobierz CSV",
    preparing: "⏳ Przygotowywanie CSV…",
    downloaded: "✅ Pobrano",
  },
  tr: {
    download: "⬇️ CSV İndir",
    preparing: "⏳ CSV hazırlanıyor…",
    downloaded: "✅ İndirildi",
  },
};

const RTL_LANGS = new Set(["ar", "he", "fa", "ur"]);

let hostLocale: string | undefined;
let toolLocale: string | undefined;

function stripFileNameSuffix(label: string): string {
  return label.replace(/\s*\([^)]*\.csv\)\s*$/i, "").trim();
}

function getEffectiveLangCode(): string {
  const raw = toolLocale || hostLocale || navigator.language || "en";
  return raw.toLowerCase().split(/[-_]/)[0] || "en";
}

function getLocaleStrings(): LocaleStrings {
  const lang = getEffectiveLangCode();
  return I18N[lang] ?? I18N.en!;
}

function syncDocumentLocale() {
  const rawLocale = toolLocale || hostLocale || navigator.language || "en";
  const lang = getEffectiveLangCode();
  document.documentElement.lang = rawLocale;
  document.documentElement.dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
}

let currentDownload: GcsDownloadInfo = {
  gcsUri: "gs://all-in-demo/reports/q4-metrics-report.csv",
  bucket: "all-in-demo",
  objectPath: "reports/q4-metrics-report.csv",
  fileName: "q4-metrics-report.csv",
};

const rootEl = document.getElementById("button-only-root") as HTMLElement;
const downloadBtn = document.getElementById("gcs-download-btn") as HTMLButtonElement;

function getIdleButtonLabel(): string {
  // 1. Prefer explicit localized buttonLabel passed by the LLM (without any filename suffix)
  if (currentDownload.customLabel) {
    return stripFileNameSuffix(currentDownload.customLabel);
  }
  // 2. Otherwise localize using ctx.locale / tool locale / navigator.language
  return getLocaleStrings().download;
}

function renderButtonLabel() {
  syncDocumentLocale();
  downloadBtn.textContent = getIdleButtonLabel();
}

function updateButton(download: GcsDownloadInfo) {
  currentDownload = { ...currentDownload, ...download };
  if (download.locale) {
    toolLocale = download.locale;
  }
  renderButtonLabel();
}

function triggerBrowserBlobDownload(csvContent: string, fileName: string): boolean {
  try {
    const withBom = csvContent.startsWith("\uFEFF") ? csvContent : `\uFEFF${csvContent}`;
    const blob = new Blob([withBom], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch {
    return false;
  }
}

const app = new App(
  { name: "CSV Download Button", version: "1.0.0" },
  { availableDisplayModes: ["inline", "pip", "fullscreen"] },
);

// Initialize locale & button text from browser immediately before host connects
renderButtonLabel();

downloadBtn.addEventListener("click", async () => {
  downloadBtn.disabled = true;
  const strings = getLocaleStrings();
  downloadBtn.textContent = strings.preparing;

  try {
    let latest: GcsDownloadInfo | undefined;

    // 1. Ask MCP server to generate fresh CSV / V4 Signed URL on demand
    try {
      const result = await app.callServerTool({
        name: "mint-gcs-signed-url",
        arguments: {
          gcsUri: currentDownload.gcsUri,
          fileName: currentDownload.fileName,
          csvContent: currentDownload.csvContent,
          buttonLabel: currentDownload.customLabel,
          locale: toolLocale || hostLocale || navigator.language,
        },
      });
      if (result.structuredContent) {
        latest = result.structuredContent as GcsDownloadInfo;
      }
    } catch {
      try {
        const res = await fetch("/api/sign-gcs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gcsUri: currentDownload.gcsUri }),
        });
        if (res.ok) {
          latest = (await res.json()) as GcsDownloadInfo;
        }
      } catch {
        // Ignore fallback error
      }
    }

    if (latest) {
      currentDownload = { ...currentDownload, ...latest };
    }

    const signedUrl = currentDownload.signedUrl;
    const csvContent = currentDownload.csvContent;
    const fileName = currentDownload.fileName || "download.csv";

    let triggered = false;

    // 2. Try MCP host downloadFile first (using signedUrl link or embedded CSV text)
    try {
      const dlRes = await app.downloadFile({
        contents: [
          signedUrl
            ? {
                type: "resource_link",
                uri: signedUrl,
                name: fileName,
                mimeType: "text/csv",
              }
            : {
                type: "resource",
                resource: {
                  uri: `file:///${fileName}`,
                  mimeType: "text/csv",
                  text: csvContent ?? "",
                },
              },
        ],
      });
      if (!dlRes.isError) {
        triggered = true;
      }
    } catch {
      // Fallback to openLink / direct download
    }

    // 3. Fallback to opening the GCS V4 Signed URL via host openLink or window.open
    if (!triggered && signedUrl) {
      try {
        const openRes = await app.openLink({ url: signedUrl });
        if (!openRes.isError) {
          triggered = true;
        }
      } catch {
        const win = window.open(signedUrl, "_blank", "noopener,noreferrer");
        if (win) triggered = true;
      }
    }

    // 4. Final fallback: direct browser Blob download of the server-generated CSV
    if (!triggered && csvContent) {
      triggered = triggerBrowserBlobDownload(csvContent, fileName);
    }

    downloadBtn.textContent = getLocaleStrings().downloaded;
    setTimeout(() => {
      renderButtonLabel();
    }, 2500);
  } finally {
    downloadBtn.disabled = false;
  }
});

let hostExplicitTheme: "light" | "dark" | undefined;

function applyEffectiveTheme(theme: "light" | "dark") {
  applyDocumentTheme(theme);
  document.documentElement.dataset.theme = theme;
}

// Follow browser / OS light & dark mode automatically unless overridden by the MCP host
const darkMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
applyEffectiveTheme(darkMediaQuery.matches ? "dark" : "light");
darkMediaQuery.addEventListener("change", (e) => {
  if (!hostExplicitTheme) {
    applyEffectiveTheme(e.matches ? "dark" : "light");
  }
});

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) {
    hostExplicitTheme = ctx.theme;
    applyEffectiveTheme(ctx.theme);
  }
  if (ctx.locale) {
    hostLocale = ctx.locale;
    renderButtonLabel();
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx.safeAreaInsets) {
    rootEl.style.paddingTop = `${Math.max(8, ctx.safeAreaInsets.top)}px`;
    rootEl.style.paddingRight = `${Math.max(8, ctx.safeAreaInsets.right)}px`;
    rootEl.style.paddingBottom = `${Math.max(8, ctx.safeAreaInsets.bottom)}px`;
    rootEl.style.paddingLeft = `${Math.max(8, ctx.safeAreaInsets.left)}px`;
  }
}

app.ontoolinputpartial = (params) => {
  const args = (params.arguments ?? {}) as {
    fileName?: string;
    buttonLabel?: string;
    locale?: string;
  };
  if (args.locale) toolLocale = args.locale;
  if (args.fileName) currentDownload.fileName = args.fileName;
  if (args.buttonLabel) {
    const cleaned = stripFileNameSuffix(args.buttonLabel);
    currentDownload.customLabel = cleaned.startsWith("⬇️")
      ? cleaned
      : `⬇️ ${cleaned}`;
  }
  renderButtonLabel();
};

app.ontoolinput = (params) => {
  const args = (params.arguments ?? {}) as {
    fileName?: string;
    buttonLabel?: string;
    locale?: string;
  };
  if (args.locale) toolLocale = args.locale;
  if (args.fileName) currentDownload.fileName = args.fileName;
  if (args.buttonLabel) {
    const cleaned = stripFileNameSuffix(args.buttonLabel);
    currentDownload.customLabel = cleaned.startsWith("⬇️")
      ? cleaned
      : `⬇️ ${cleaned}`;
  }
  renderButtonLabel();
};

app.ontoolresult = (result: CallToolResult) => {
  const payload = result.structuredContent as CsvButtonPayload | undefined;
  if (payload?.download) {
    updateButton(payload.download);
  }
};

app.onhostcontextchanged = handleHostContextChanged;
app.onteardown = async () => ({});
app.onerror = (err) => console.error("MCP App error:", err);

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});

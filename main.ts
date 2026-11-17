import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import cors from "cors";
import type { Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, generateGcsV4SignedUrl } from "./server.js";

const MAIN_FILE = fileURLToPath(import.meta.url);
const DIST_DIR = MAIN_FILE.endsWith(".ts")
  ? path.join(path.dirname(MAIN_FILE), "dist")
  : path.dirname(MAIN_FILE);

export async function startStreamableHTTPServer(
  createServerFn: () => McpServer,
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", mcpEndpoint: "/mcp" });
  });

  // Fallback HTTP endpoint so standalone browser previews can also test GCS V4 signing
  app.post("/api/sign-gcs", async (req: Request, res: Response) => {
    try {
      const { gcsUri, bucket, objectPath } = (req.body ?? {}) as {
        gcsUri?: string;
        bucket?: string;
        objectPath?: string;
      };
      const signed = await generateGcsV4SignedUrl({ gcsUri, bucket, objectPath });
      res.status(200).json(signed);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const handleMcpRequest = async (req: Request, res: Response) => {
    // Serve browser HTML preview on plain browser GET / requests
    const accept = req.headers.accept ?? "";
    if (req.method === "GET" && req.path === "/" && !accept.includes("text/event-stream")) {
      try {
        const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).send(html);
        return;
      } catch {
        res.status(200).json({ status: "ok", mcpEndpoint: "/mcp" });
        return;
      }
    }

    // Ensure clients that only send `Accept: application/json` or `*/*` are not
    // rejected with 406 by the strict Streamable HTTP transport check.
    const wantsSse = accept.includes("text/event-stream");
    if (req.method === "POST" && (!accept.includes("application/json") || !wantsSse)) {
      req.headers.accept = "application/json, text/event-stream";
    }

    const server = createServerFn();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: !wantsSse,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  // Support both /mcp and root / so Gemini Enterprise works regardless of whether
  // the base Cloud Run URL or /mcp path is configured.
  app.all("/mcp", handleMcpRequest);
  app.all("/", handleMcpRequest);

  const httpServer = app.listen(port, (err?: Error) => {
    if (err) {
      console.error("Failed to start server:", err);
      process.exit(1);
    }
    console.log(`Simple Metrics Dashboard MCP server listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startStdioServer(
  createServerFn: () => McpServer,
): Promise<void> {
  await createServerFn().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
  } else {
    await startStreamableHTTPServer(createServer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

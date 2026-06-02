import { defineConfig } from "cypress";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? "http://localhost:3000",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    fixturesFolder: "cypress/fixtures",
    screenshotsFolder: "cypress/screenshots",
    videosFolder: "cypress/videos",
    video: false,
    viewportWidth: 1400,
    viewportHeight: 900,
    defaultCommandTimeout: 20_000,
    requestTimeout: 30_000,
    retries: { runMode: 1, openMode: 0 },
    setupNodeEvents(on) {
      on("task", {
        readFileIfExists(relativePath: string): string | null {
          const abs = path.join(__dirname, "cypress", "fixtures", relativePath);
          if (!existsSync(abs)) return null;
          return readFileSync(abs).toString("base64");
        },
        // Node-side multipart POST. Cypress's cy.request doesn't serialise
        // FormData as multipart/form-data; native fetch handles it cleanly.
        async classifyMultipart(opts: {
          baseUrl: string;
          bytesBase64: string;
          fileName: string;
          contentType: string;
          workspaceId: string;
          extension?: string | null;
        }): Promise<{ status: number; body: unknown }> {
          const bytes = Buffer.from(opts.bytesBase64, "base64");
          const form = new FormData();
          form.append(
            "file",
            new Blob([bytes], { type: opts.contentType }),
            opts.fileName,
          );
          form.append("workspaceId", opts.workspaceId);
          if (opts.extension) form.append("extension", opts.extension);
          if (opts.contentType) form.append("contentType", opts.contentType);
          const res = await fetch(`${opts.baseUrl}/api/classify`, {
            method: "POST",
            body: form,
          });
          const body = await res.json().catch(() => ({}));
          return { status: res.status, body };
        },
      });
    },
  },
});

// Standalone Swagger UI page at /docs.
//
// Implemented as a Next.js `route.ts` (not a `page.tsx`) so we can return
// raw HTML with our own <html>/<head>/<body> — bypasses the root layout's
// dark theme and font setup, which conflict with the Swagger UI bundle's
// own light styling.
//
// Zero npm deps: the bundle is loaded from a pinned CDN URL. Pin the
// version explicitly so a CDN-side upgrade can't silently regress the page.
// The spec is served as a static asset from `ui/public/openapi.yaml`.

const SWAGGER_VERSION = "5.17.14";

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API · Classification Service</title>
  <link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css"
    crossorigin="anonymous"
  />
  <style>body { margin: 0; background: #fafafa; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script
    src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js"
    crossorigin="anonymous"
  ></script>
  <script
    src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-standalone-preset.js"
    crossorigin="anonymous"
  ></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout",
        docExpansion: "list",
        defaultModelsExpandDepth: 1,
        tryItOutEnabled: true,
      });
    };
  </script>
</body>
</html>
`;

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET() {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

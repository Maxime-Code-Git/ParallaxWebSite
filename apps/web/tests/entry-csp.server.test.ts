// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createStaticHandler, type EntryContext, type StaticHandlerContext } from "react-router";
import RootLayout, { Layout } from "../app/root";
import handleRequest, {
  generateNonce,
  buildCsp,
  addSecurityHeaders,
  applyAdminSecurityHeaders,
} from "../app/entry.server";

function createEntryContext(staticHandlerContext: StaticHandlerContext): EntryContext {
  const routesObj: EntryContext["manifest"]["routes"] = {
    root: {
      id: "root",
      path: "",
      hasAction: false,
      hasLoader: false,
      hasClientAction: false,
      hasClientLoader: false,
      hasClientMiddleware: false,
      hasErrorBoundary: false,
      module: "root",
      clientActionModule: undefined,
      clientLoaderModule: undefined,
      clientMiddlewareModule: undefined,
      hydrateFallbackModule: undefined,
    },
  };
  const routeModulesObj: EntryContext["routeModules"] = {
    root: {
      default: RootLayout,
      Layout,
    },
  };

  for (const match of staticHandlerContext.matches) {
    routesObj[match.route.id] = {
      id: match.route.id,
      path: match.route.path || "",
      hasAction: false,
      hasLoader: false,
      hasClientAction: false,
      hasClientLoader: false,
      hasClientMiddleware: false,
      hasErrorBoundary: false,
      module: match.route.id,
      clientActionModule: undefined,
      clientLoaderModule: undefined,
      clientMiddlewareModule: undefined,
      hydrateFallbackModule: undefined,
    };
    if (match.route.id !== "root") {
      routeModulesObj[match.route.id] = {
        default: RootLayout,
      };
    }
  }

  return {
    staticHandlerContext,
    branches: [],
    manifest: {
      entry: { imports: [], module: "" },
      routes: routesObj,
      url: "",
      version: "1",
    },
    routeModules: routeModulesObj,
    future: {},
    ssr: true,
    isSpaMode: false,
    routeDiscovery: {
      mode: "initial",
      manifestPath: "",
    },
  };
}

describe("entry.server.tsx Security and CSP", () => {
  it("generates distinct 16-byte base64 nonces on consecutive calls", () => {
    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    expect(nonce1).not.toBe(nonce2);
    expect(Buffer.from(nonce1, "base64").length).toBe(16);
  });

  it("builds strict CSP containing nonce and no unsafe-inline in production", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const nonce = generateNonce();
      const csp = buildCsp(nonce);

      expect(csp).toContain(`'nonce-${nonce}'`);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).not.toContain("'unsafe-inline'");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("frame-src https://www.youtube-nocookie.com https://player.vimeo.com");
      expect(csp).not.toContain("https://youtube.com");
      expect(csp).not.toContain("https://vimeo.com");
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("permits style unsafe-inline in development for Vite HMR", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      const nonce = generateNonce();
      const csp = buildCsp(nonce);
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("connect-src 'self' ws: wss:");
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("addSecurityHeaders attaches all expected security headers", () => {
    const headers = new Headers();
    const nonce = generateNonce();
    addSecurityHeaders(headers, nonce);

    expect(headers.get("Content-Security-Policy")).toBeDefined();
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("applies admin security headers (no-store, noindex) on any /admin URL", () => {
    const headers = new Headers();
    applyAdminSecurityHeaders(headers, "https://parallax.example.com/admin");
    expect(headers.get("Cache-Control")).toContain("no-store");
    expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    const unknownHeaders = new Headers();
    applyAdminSecurityHeaders(unknownHeaders, "https://parallax.example.com/admin/unknown-404-url");
    expect(unknownHeaders.get("Cache-Control")).toContain("no-store");
    expect(unknownHeaders.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("performs real in-memory SSR rendering of two documents with consistent and distinct nonces without unsafe-inline", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";

      const staticHandler = createStaticHandler([
        {
          id: "root",
          path: "/",
          Component: RootLayout,
        },
      ]);

      const req1 = new Request("https://parallax.example.com/");
      const queryResult1 = await staticHandler.query(req1);
      if (queryResult1 instanceof Response) {
        throw new Error("Unexpected Response returned from staticHandler.query");
      }
      const context1 = createEntryContext(queryResult1);
      const res1 = await handleRequest(req1, 200, new Headers(), context1, {});

      expect(res1.status).toBe(200);
      const csp1 = res1.headers.get("Content-Security-Policy") || "";
      const nonceMatch1 = csp1.match(/'nonce-([^']+)'/);
      expect(nonceMatch1).not.toBeNull();
      const nonce1 = nonceMatch1![1];
      const html1 = await res1.text();

      // Verify that hydration scripts rendered have the exact nonce from CSP
      expect(html1).toContain(`nonce="${nonce1}"`);
      expect(csp1).not.toContain("'unsafe-inline'");
      expect(csp1).not.toContain("'unsafe-eval'");

      // Second document render
      const req2 = new Request("https://parallax.example.com/");
      const queryResult2 = await staticHandler.query(req2);
      if (queryResult2 instanceof Response) {
        throw new Error("Unexpected Response returned from staticHandler.query");
      }
      const context2 = createEntryContext(queryResult2);
      const res2 = await handleRequest(req2, 200, new Headers(), context2, {});

      expect(res2.status).toBe(200);
      const csp2 = res2.headers.get("Content-Security-Policy") || "";
      const nonceMatch2 = csp2.match(/'nonce-([^']+)'/);
      expect(nonceMatch2).not.toBeNull();
      const nonce2 = nonceMatch2![1];
      const html2 = await res2.text();

      expect(html2).toContain(`nonce="${nonce2}"`);
      expect(csp2).not.toContain("'unsafe-inline'");
      expect(csp2).not.toContain("'unsafe-eval'");

      // Nonces must be strictly distinct between documents
      expect(nonce1).not.toBe(nonce2);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("renders html with correct lang attribute for FR and EN routes during SSR without client effects", async () => {
    const staticHandler = createStaticHandler([
      {
        id: "root",
        path: "/",
        Component: RootLayout,
        children: [
          { id: "fr-home", path: "fr", Component: RootLayout },
          { id: "en-home", path: "en", Component: RootLayout },
          { id: "en-studio", path: "en/studio", Component: RootLayout },
        ],
      },
    ]);

    // Test French route SSR
    const reqFr = new Request("https://parallax.example.com/fr");
    const queryFr = await staticHandler.query(reqFr);
    if (!(queryFr instanceof Response)) {
      const ctxFr = createEntryContext(queryFr);
      const resFr = await handleRequest(reqFr, 200, new Headers(), ctxFr, {});
      const htmlFr = await resFr.text();
      expect(htmlFr).toContain('<html lang="fr">');
    }

    // Test English home SSR
    const reqEn = new Request("https://parallax.example.com/en");
    const queryEn = await staticHandler.query(reqEn);
    if (!(queryEn instanceof Response)) {
      const ctxEn = createEntryContext(queryEn);
      const resEn = await handleRequest(reqEn, 200, new Headers(), ctxEn, {});
      const htmlEn = await resEn.text();
      expect(htmlEn).toContain('<html lang="en">');
    }

    // Test English studio SSR
    const reqEnStudio = new Request("https://parallax.example.com/en/studio");
    const queryEnStudio = await staticHandler.query(reqEnStudio);
    if (!(queryEnStudio instanceof Response)) {
      const ctxEnStudio = createEntryContext(queryEnStudio);
      const resEnStudio = await handleRequest(reqEnStudio, 200, new Headers(), ctxEnStudio, {});
      const htmlEnStudio = await resEnStudio.text();
      expect(htmlEnStudio).toContain('<html lang="en">');
    }
  });
});

import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import Home from "@/app/page";
import NotFound from "@/app/not-found";
import { LoginForm } from "@/features/auth/login-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe("public UI accessibility", () => {
  it("uses single, focusable links for home navigation instead of nested buttons", () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect(html).not.toMatch(/<button\b/);
    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    const workbench = links.find(([, , content]) => content.startsWith("Open workbench"))?.[1];
    expect(workbench).toContain('href="/login"');
    expect(workbench).toContain("min-h-11");
    expect(workbench).toContain("focus-visible:ring-2");
    expect(links.find(([, , content]) => content === "View dashboard")?.[1]).toContain('href="/dashboard"');
    expect(html).toContain("where available");
  });

  it("keeps streamed login instances uniquely labeled", () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, createElement(LoginForm), createElement(LoginForm)));
    const ids = [...html.matchAll(/<input\b[^>]*id="([^"]+)"/g)].map((match) => match[1]);
    const labels = [...html.matchAll(/<label\b[^>]*for="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(labels).toEqual(ids);
    expect(html).toMatch(/autocomplete="current-password"/i);
  });

  it("uses shared alert colors and keyboard-visible, touch-sized login navigation", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { reason: "session-expired" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("border-warning-border bg-warning-surface");
    expect(html).toMatch(/<button[^>]*min-h-11[^>]*>Need a demo account/);
    expect(html).toMatch(/<a[^>]*min-h-11[^>]*focus-visible:ring-2[^>]*>Return home/);
  });

  it("offers safe recovery without disclosing whether a missing record exists", () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toContain("Page not found");
    expect(html).toContain('aria-label="Page recovery"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/"');
    expect(html).not.toMatch(/unauthorized|belongs to/i);
  });
});

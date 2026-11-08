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
    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    for (const [, , content] of links) expect(content).not.toMatch(/<button\b/);
    const workbench = links.find(([, , content]) => content.startsWith("Open workbench"))?.[1];
    expect(workbench).toContain('href="/login"');
    expect(workbench).toContain("min-h-11");
    expect(workbench).toContain("focus-visible:ring-2");
    expect(links.find(([, , content]) => content.startsWith("Go to shipments"))?.[1]).toContain('href="/dashboard"');
    expect(html).toContain("where available");
  });

  it("provides working landing-page section targets and an accessible mobile disclosure", () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect(html).toContain('aria-label="Main navigation"');
    for (const id of ["main-content", "workbench", "workflow", "human-control"]) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/<button[^>]*aria-label="Open navigation"[^>]*aria-expanded="false"[^>]*aria-controls="mobile-navigation"/);
    expect(html).toMatch(/id="mobile-navigation"[^>]*hidden=""/);
    expect(html).toContain("min-h-18 flex-wrap");
    expect(html).toContain("max-w-full items-center justify-center gap-2 whitespace-normal");
  });

  it("labels the interactive preview as synthetic and keeps approval claims qualified", () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect(html).toContain('aria-label="Interactive review example"');
    expect(html).toContain("Sample data only. Changes stay in this preview.");
    expect(html).toContain("Not for customs filing.");
    expect(html).toContain("AI never approves or exports a shipment.");
    expect(html).not.toMatch(/demo/i);
    expect(html).toContain('data-uncertain="true"');
    expect(html).toContain("Sample excerpt");
    expect(html).toContain("Illustrative source · page 1");
    expect(html).toContain("Needs review");
    expect(html).toContain("Compare with source");
    expect(html).toMatch(/<dt[^>]*>Extracted gross weight<\/dt><dd[^>]*><span>3,210<\/span>/);
    expect(html).not.toMatch(/<p[^>]*aria-label=/);
    expect(html).not.toContain("field-input-landing-example-weight");
    expect(html).not.toMatch(/99\.9|guaranteed|trusted by/i);
  });

  it("links keyboard-operable document tabs to three retained source panels", () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect(html).toContain('aria-label="Sample documents"');
    const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(([tag]) => tag);
    const panels = [...html.matchAll(/<div\b[^>]*role="tabpanel"[^>]*>/g)].map(([tag]) => tag);
    expect(tabs).toHaveLength(3);
    expect(panels).toHaveLength(3);
    for (const [index, tab] of tabs.entries()) {
      const target = tab.match(/aria-controls="([^"]+)"/)?.[1];
      const id = tab.match(/id="([^"]+)"/)?.[1];
      expect(panels[index]).toContain(`id="${target}"`);
      expect(panels[index]).toContain(`aria-labelledby="${id}"`);
      expect(tab).toContain(`aria-selected="${index === 0}"`);
      expect(tab).toContain(`tabindex="${index === 0 ? 0 : -1}"`);
      if (index > 0) expect(panels[index]).toContain('hidden=""');
    }
    expect(html).toContain('aria-label="Invoice synthetic source, page 1"');
    expect(html).toContain('aria-label="Packing list synthetic source, page 1"');
    expect(html).toContain('aria-label="Bill of lading synthetic source, page 1"');
    expect(html).toMatch(/role="status"[^>]*aria-atomic="true"/);
  });

  it("allows preview action labels and the disclaimer to grow with enlarged text", () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect(html).toMatch(/<button[^>]*class="[^"]*h-auto[^"]*py-3[^"]*"[^>]*>[\s\S]*?Compare with source/);
    expect(html).toContain("flex flex-wrap items-center justify-between gap-3 border-t");
    expect(html).toContain("flex-1 basis-48");
    expect(html).toMatch(/role="tab"[^>]*>[\s\S]*?<span class="min-w-0 \[overflow-wrap:anywhere\]">Invoice<\/span>/);
    expect(html).toContain("grid-cols-3 items-stretch gap-0");
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
    expect(html).toMatch(/<button[^>]*min-h-11[^>]*>Need an account/);
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

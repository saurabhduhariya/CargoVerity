import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FeedbackState } from "@/components/ui/feedback-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getStatusPresentation, STATUS_PRESENTATIONS, StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Typography } from "@/components/ui/typography";

function render(element: ReactElement) {
  return renderToStaticMarkup(element);
}

function classes(html: string) {
  return html.match(/class="([^"]*)"/)?.[1].split(" ") ?? [];
}

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

function color(token: string) {
  const value = root.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{6});`, "i"))?.[1];
  if (!value) throw new Error(`Missing color token: ${token}`);
  return value;
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("CargoVerity design-system tokens", () => {
  it.each(["foreground", "foreground-secondary", "muted-foreground"])("keeps %s readable on the content surface", (token) => {
    expect(contrast(color(token), color("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["neutral", "success", "warning", "danger", "info"])("keeps %s semantic text readable on its tinted surface", (tone) => {
    expect(contrast(color(tone), color(`${tone}-surface`))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["primary", "primary-hover", "primary-active", "danger", "danger-hover", "danger-active"])("keeps %s button text readable", (token) => {
    expect(contrast(color("primary-foreground"), color(token))).toBeGreaterThanOrEqual(4.5);
  });

  it("gives control boundaries and the focus color at least 3:1 contrast", () => {
    expect(contrast(color("control-border"), color("surface"))).toBeGreaterThanOrEqual(3);
    expect(contrast(color("primary"), color("surface"))).toBeGreaterThanOrEqual(3);
  });

  it("has no self-referencing custom properties", () => {
    for (const match of css.matchAll(/(--[\w-]+):\s*var\((--[\w-]+)\)\s*;/g)) {
      expect(match[1]).not.toBe(match[2]);
    }
  });

  it.each([
    ["inter-latin-variable.woff2", "3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62"],
    ["jetbrains-mono-latin-variable.woff2", "18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e"],
  ])("bundles the documented local font %s", (fileName, checksum) => {
    const bytes = readFileSync(new URL(`../../src/app/fonts/${fileName}`, import.meta.url));
    expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(checksum);
  });
});

describe("backward-compatible primitives", () => {
  it("preserves explicit native submission attributes", () => {
    const html = render(createElement(Button, { type: "submit", name: "action", value: "review" }, "Save field"));
    expect(html).toContain('type="submit"');
    expect(html).toContain('name="action"');
    expect(html).toContain('value="review"');
    expect(html).toContain("Save field");
  });

  it("does not change the existing implicit button type", () => {
    expect(render(createElement(Button, null, "Save field"))).not.toMatch(/^<button[^>]*\btype=/);
  });

  it("disables a loading button without removing its accessible text", () => {
    const html = render(createElement(Button, { loading: true }, "Run checks"));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Run checks");
  });

  it("preserves caller-provided busy and disabled states", () => {
    const html = render(createElement(Button, { disabled: true, "aria-busy": true }, "Submit"));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });

  it("allows long action labels to wrap instead of overflowing narrow containers", () => {
    const html = render(createElement(Button, null, "Confirm the reviewed document replacement"));
    expect(classes(html)).toContain("max-w-full");
    expect(classes(html)).toContain("min-h-min");
    expect(classes(html)).toContain("whitespace-normal");
    expect(classes(html)).not.toContain("whitespace-nowrap");
  });

  it("retains caller-defined button height and wrapping overrides", () => {
    const html = render(createElement(Button, { className: "h-8 whitespace-nowrap" }, "Save"));
    expect(classes(html)).toContain("h-8");
    expect(classes(html)).not.toContain("h-[var(--control-height)]");
    expect(classes(html)).toContain("whitespace-nowrap");
    expect(classes(html)).not.toContain("whitespace-normal");
  });

  it("allows legacy class overrides without changing handlers or values", () => {
    const html = render(createElement(Input, {
      className: "h-8 text-xs bg-warning-surface",
      name: "grossWeight",
      defaultValue: "3165.000",
      inputMode: "decimal",
      "aria-label": "Gross weight",
    }));
    expect(classes(html)).toContain("h-8");
    expect(classes(html)).not.toContain("h-[var(--control-height)]");
    expect(classes(html)).toContain("text-xs");
    expect(classes(html)).not.toContain("text-[length:var(--control-font-size)]");
    expect(html).toContain('name="grossWeight"');
    expect(html).toContain('value="3165.000"');
    expect(html).toContain('inputMode="decimal"');
  });

  it("preserves invalid, required, and associated error attributes", () => {
    const html = render(createElement(Input, { id: "amount", required: true, "aria-invalid": true, "aria-describedby": "amount-error" }));
    expect(html).toContain('id="amount"');
    expect(html).toContain('required=""');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="amount-error"');
    expect(classes(html)).toContain("aria-invalid:border-danger");
  });

  it("retains native label association", () => {
    expect(render(createElement(Label, { htmlFor: "amount" }, "Amount"))).toContain('for="amount"');
  });

  it("retains custom legacy badge text and color overrides", () => {
    const props = { className: "bg-warning-surface text-warning", "data-testid": "status" };
    const html = render(createElement(Badge, props, "Requires review"));
    expect(classes(html)).toContain("bg-warning-surface");
    expect(classes(html)).not.toContain("bg-neutral-surface");
    expect(html).toContain("Requires review");
    expect(html).toContain('data-testid="status"');
  });

  it("keeps card structure and allows an appropriate heading level", () => {
    const html = render(createElement(Card, null,
      createElement(CardHeader, null,
        createElement(CardTitle, { as: "h3" }, "Document"),
        createElement(CardDescription, null, "Source evidence")),
      createElement(CardContent, null, "Invoice"),
      createElement(CardFooter, null, "Revision 2")));
    expect(html).toContain('<h3 data-slot="card-title"');
    expect(html).toContain("Source evidence");
    expect(html).toContain("Revision 2");
    expect(classes(html)).toContain("rounded-panel");
    expect(classes(html)).toContain("min-w-0");
    expect(classes(html)).not.toContain("shadow-sm");
  });
});

describe("shared display and form components", () => {
  it("keeps a native select and its selected form value", () => {
    const html = render(createElement(Select, { name: "docType", defaultValue: "PACKING_LIST", "aria-label": "Document type" },
      createElement("option", { value: "INVOICE" }, "Invoice"),
      createElement("option", { value: "PACKING_LIST" }, "Packing list")));
    expect(html).toContain('<select name="docType"');
    expect(html).toContain('<option value="PACKING_LIST" selected="">');
  });

  it("supports native multiple selection", () => {
    const html = render(createElement(Select, { multiple: true, defaultValue: ["a", "b"], "aria-label": "Types" },
      createElement("option", { value: "a" }, "A"), createElement("option", { value: "b" }, "B")));
    expect(html).toContain('multiple=""');
    expect(html.match(/selected=""/g)).toHaveLength(2);
    expect(classes(html)).toContain("min-h-24");
  });

  it("keeps multiline reasons and caller-defined textarea constraints", () => {
    const html = render(createElement(Textarea, { name: "reason", rows: 5, maxLength: 500, defaultValue: "Verified source\nPage 2", "aria-label": "Reason" }));
    expect(html).toContain('rows="5"');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain("Verified source\nPage 2");
  });

  it("gives numeric table cells tabular monospace without reformatting values", () => {
    const html = render(createElement(Table, { containerLabel: "Shipment comparison" },
      createElement(TableCaption, null, "Synthetic values"),
      createElement(TableHeader, null, createElement(TableRow, null, createElement(TableHead, { numeric: true }, "Weight"))),
      createElement(TableBody, null, createElement(TableRow, { "aria-selected": true }, createElement(TableCell, { numeric: true }, "3165.000")))));
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Shipment comparison"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('scope="col"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("tabular-nums");
    expect(html).toContain("font-mono");
    expect(html).toContain("3165.000");
  });

  it("provides semantic headings and dedicated numeric typography", () => {
    expect(render(createElement(Typography, { variant: "page-title" }, "Shipments"))).toMatch(/^<h1 /);
    expect(render(createElement(Typography, { variant: "section-title" }, "Evidence"))).toMatch(/^<h2 /);
    expect(render(createElement(Typography, { variant: "data" }, "USD 16320.00"))).toContain("font-mono");
  });
});

describe("status presentation does not redefine workflow rules", () => {
  it.each(Object.keys(STATUS_PRESENTATIONS))("renders %s with a human-readable label and hidden decorative icon", (status) => {
    const html = render(createElement(StatusBadge, { status }));
    expect(html).toContain(`data-status="${status}"`);
    expect(html).toContain(getStatusPresentation(status).label);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain('role="status"');
  });

  it("does not paint an approved exception as a machine pass", () => {
    expect(getStatusPresentation("PASS").variant).toBe("success");
    expect(getStatusPresentation("HUMAN_CLEARED").variant).toBe("default");
    expect(getStatusPresentation("HUMAN_CLEARED").label).toBe("Exception approved");
    expect(getStatusPresentation("PENDING_MANAGER_APPROVAL").variant).toBe("warning");
  });

  it.each(["FUTURE_STATUS", "constructor", "__proto__", ""])("falls back safely and neutrally for %s", (status) => {
    expect(getStatusPresentation(status).variant).toBe("default");
    expect(() => render(createElement(StatusBadge, { status }))).not.toThrow();
  });
});

describe("accessible state and interaction markup", () => {
  it("links tabs and panels while retaining hidden panel content", () => {
    const html = render(createElement(Tabs, { defaultValue: "fields" },
      createElement(TabsList, { "aria-label": "Review panels" },
        createElement(TabsTrigger, { value: "fields" }, "Fields"),
        createElement(TabsTrigger, { value: "checks", disabled: true }, "Checks")),
      createElement(TabsContent, { value: "fields" }, "Current values"),
      createElement(TabsContent, { value: "checks" }, "Retained draft")));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('hidden=""');
    expect(html).toContain("Retained draft");
    const controlIds = Array.from(html.matchAll(/aria-controls="([^"]+)"/g), (match) => match[1]);
    for (const id of controlIds) expect(html).toContain(`id="${id}"`);
  });

  it("labels the native dialog and retains busy confirmation text", () => {
    const html = render(createElement(ConfirmDialog, {
      open: false,
      onClose: () => undefined,
      onConfirm: () => undefined,
      title: "Replace document?",
      description: "The revision will change.",
      confirmLabel: "Replace document",
      busy: true,
    }));
    expect(html).toMatch(/^<dialog /);
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("aria-describedby=");
    expect(html).not.toMatch(/^<dialog[^>]*\bopen=/);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("Replace document");
  });

  it.each([
    ["error", "alert"],
    ["loading", "status"],
    ["success", "status"],
  ] as const)("uses appropriate announcement semantics for %s", (kind, role) => {
    const html = render(createElement(FeedbackState, { kind, title: "Preview state", description: "Synthetic component test" }));
    expect(html).toContain(`role="${role}"`);
    expect(html).toContain("Synthetic component test");
  });

  it("constrains skeleton width and keeps placeholders out of the accessibility tree", () => {
    const html = render(createElement(Skeleton, { className: "h-5 w-40" }));
    expect(html).toContain('aria-hidden="true"');
    expect(classes(html)).toContain("max-w-full");
  });
});

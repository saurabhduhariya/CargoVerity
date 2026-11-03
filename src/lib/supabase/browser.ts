"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserConfig } from "@/lib/supabase/browser-config";

let browserClient: SupabaseClient | undefined;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const config = getSupabaseBrowserConfig();

  if (!config) {
    throw new Error("Supabase browser configuration is missing.");
  }

  browserClient = createBrowserClient(config.url, config.publishableKey);
  return browserClient;
}

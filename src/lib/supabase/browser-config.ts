import { z } from "zod";

const publicConfigSchema = z.object({
  url: z.string().url(),
  publishableKey: z.string().trim().min(1),
});

export function getSupabaseBrowserConfig() {
  const result = publicConfigSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  if (!result.success || result.data.url.includes("YOUR_PROJECT") || result.data.publishableKey.startsWith("YOUR_")) {
    return null;
  }

  return result.data;
}

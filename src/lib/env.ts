import { z } from "zod";

import { ConfigurationError } from "@/lib/errors";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const optionalConnectionString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "must be a PostgreSQL connection string",
    )
    .optional(),
);

const defaultedString = (fallback: string) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().trim().min(1).default(fallback),
  );

const envSchema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  SUPABASE_SECRET_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: defaultedString("shipment-documents"),

  DATABASE_URL: optionalConnectionString,
  DIRECT_URL: optionalConnectionString,

  AI_PROVIDER: z.enum(["groq", "openrouter"]).default("groq"),
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: defaultedString("qwen/qwen3.8-27b"),
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_MODEL: defaultedString("openrouter/free"),

  MAX_PDF_BYTES: z.coerce.number().int().positive().default(10_485_760),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(7_000_000),
  MAX_PDF_PAGES: z.coerce.number().int().positive().max(50).default(50),
  MAX_AI_IMAGES_PER_REQUEST: z.coerce.number().int().positive().max(3).default(3),
  LOW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  MAX_AI_RETRIES: z.coerce.number().int().min(0).max(1).default(1),
  AI_MAX_COMPLETION_TOKENS: z.coerce.number().int().min(256).max(8000).default(1000),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(60000),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(25),
  AI_BUDGET_ALERT_PERCENT: z.coerce.number().min(1).max(100).default(80),
  AI_INPUT_PRICE_PER_MTOK_USD: z.coerce.number().min(0).default(0.8),
  AI_OUTPUT_PRICE_PER_MTOK_USD: z.coerce.number().min(0).default(4),
  CHECK_WEIGHT_TOLERANCE_PERCENT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().min(0).max(100).default(0.5),
  ),
  CHECK_WEIGHT_TOLERANCE_KG: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().min(0).default(0),
  ),
  CHECK_MONETARY_TOLERANCE: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().min(0).default(0.01),
  ),
  EXPORT_PROFILE_ID: defaultedString("demo-v1"),
  DOCUMENT_RETENTION_DAYS: optionalString,
});

export type AppEnv = z.infer<typeof envSchema>;

function formatIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
}

export function getEnv(): AppEnv {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    throw new ConfigurationError(`Invalid environment configuration: ${formatIssues(result.error)}`);
  }

  return result.data;
}

function isPlaceholder(value: string) {
  return (
    value.startsWith("YOUR_") ||
    value.startsWith("SERVER_ONLY_") ||
    value.startsWith("SET_BY_") ||
    value.includes("YOUR_PROJECT") ||
    value.includes("[YOUR-")
  );
}

export function requireEnv(name: keyof AppEnv): string {
  const value = getEnv()[name];

  if (typeof value !== "string" || value.length === 0 || isPlaceholder(value)) {
    throw new ConfigurationError(`${name} is required in the server environment.`);
  }

  return value;
}

export function requireSupabasePublicConfig() {
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}

export function requireSupabaseSecretKey() {
  return requireEnv("SUPABASE_SECRET_KEY");
}

export function requireDatabaseUrl() {
  return requireEnv("DATABASE_URL");
}

export function requireAIConfig() {
  const env = getEnv();
  const apiKeyName = env.AI_PROVIDER === "groq" ? "GROQ_API_KEY" : "OPENROUTER_API_KEY";
  const apiKey = requireEnv(apiKeyName);
  const model = env.AI_PROVIDER === "groq" ? env.GROQ_MODEL : env.OPENROUTER_MODEL;

  if (isPlaceholder(model)) {
    throw new ConfigurationError(`${env.AI_PROVIDER === "groq" ? "GROQ_MODEL" : "OPENROUTER_MODEL"} is required in the server environment.`);
  }

  return {
    provider: env.AI_PROVIDER,
    apiKey,
    model,
  } as const;
}

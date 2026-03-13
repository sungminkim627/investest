import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MARKET_DATA_API_KEY: z.string().min(1),
  MARKET_DATA_BASE_URL: z.string().url().default("https://api.tiingo.com"),
  NEXT_PUBLIC_APP_URL: z.string().url().optional()
});

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  MARKET_DATA_API_KEY: process.env.MARKET_DATA_API_KEY,
  MARKET_DATA_BASE_URL: process.env.MARKET_DATA_BASE_URL ?? "https://api.tiingo.com",
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL
});

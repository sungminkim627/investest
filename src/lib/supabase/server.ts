import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "./env";

type CookieToSet = {
  name: string;
  value: string;
  options?: Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2];
};

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach((cookie) => cookieStore.set(cookie.name, cookie.value, cookie.options));
        } catch {
          // In Server Components, cookies can be read-only and this can be safely ignored.
        }
      }
    }
  });
}

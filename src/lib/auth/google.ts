import { createSupabaseBrowserClient } from "@/lib/supabase/client";

declare global {
  interface Window {
    google?: any;
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

let scriptPromise: Promise<void> | null = null;

function loadGoogleScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Google auth requires browser"));
      return;
    }
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

async function runGoogleIdTokenFlow(): Promise<string> {
  await loadGoogleScript();
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Missing NEXT_PUBLIC_GOOGLE_CLIENT_ID");
  }

  return new Promise((resolve, reject) => {
    const google = window.google;
    if (!google?.accounts?.id) {
      reject(new Error("Google Identity Services not available"));
      return;
    }

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.top = "-10000px";
    document.body.appendChild(container);

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response: { credential?: string }) => {
        container.remove();
        if (!response?.credential) {
          reject(new Error("No credential received"));
          return;
        }
        resolve(response.credential);
      }
    });

    google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large"
    });

    const button = container.querySelector<HTMLElement>('div[role="button"]');
    if (!button) {
      container.remove();
      reject(new Error("Google sign-in button failed to render"));
      return;
    }
    button.click();
  });
}

export async function signInWithGoogleIdToken() {
  const supabase = createSupabaseBrowserClient();
  const token = await runGoogleIdTokenFlow();
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token
  });
  if (error) throw error;
}

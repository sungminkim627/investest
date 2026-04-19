"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { signInWithGoogleIdToken } from "@/lib/auth/google";

export function AuthNavButton() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const previousAuthedRef = useRef<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (mounted) {
        setEmail(user?.email ?? null);
        previousAuthedRef.current = Boolean(user);
        setLoading(false);
      }
    };

    load();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
      setLoading(false);
      const nextAuthed = Boolean(session?.user);
      if (previousAuthedRef.current === null) {
        previousAuthedRef.current = nextAuthed;
        return;
      }
      if (previousAuthedRef.current !== nextAuthed) {
        previousAuthedRef.current = nextAuthed;
        window.location.reload();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  if (loading) {
    return <Button variant="secondary" size="sm" disabled>Loading</Button>;
  }

  if (!email) {
    return (
      <Button
        size="sm"
        onClick={async () => {
          await signInWithGoogleIdToken();
        }}
      >
        Log In
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground md:inline">{email.split("@")[0]}</span>
      <Button
        variant="secondary"
        size="sm"
        className="gap-2"
        onClick={async () => {
          await supabase.auth.signOut();
        }}
      >
        <LogOut className="h-3.5 w-3.5" /> Log Out
      </Button>
    </div>
  );
}

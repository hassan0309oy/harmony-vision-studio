import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — DeerFlow" },
      {
        name: "description",
        content:
          "Connectez-vous à DeerFlow avec Google ou par e-mail pour retrouver vos conversations, projets et fichiers.",
      },
      { property: "og:title", content: "Connexion — DeerFlow" },
      {
        property: "og:description",
        content: "Accédez à vos conversations DeerFlow et à vos projets enregistrés.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search["next"] === "string" ? { next: search["next"] } : {},
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const target = search.next && search.next.startsWith("/") ? search.next : "/";

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: target });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void navigate({ to: target });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, target]);

  async function google() {
    setMessage(null);
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setMessage(result.error.message ?? "Connexion Google impossible.");
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    void navigate({ to: target });
  }

  async function withEmail() {
    setMessage(null);
    setBusy(true);
    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}${target}` },
          });
    const { data, error } = await fn;
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    if (mode === "signup" && !data.session) {
      setMessage("Compte créé. Vérifiez votre boîte mail pour confirmer l'adresse.");
    }
  }

  return (
    <div className="dark flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold">DeerFlow</h1>
            <p className="text-xs text-muted-foreground">
              Connectez-vous pour retrouver vos conversations
            </p>
          </div>
        </div>

        <button
          onClick={() => void google()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
            <path fill="#EA4335" d="M12 10.2v3.9h5.5A4.7 4.7 0 0 1 12 17.9a5.9 5.9 0 1 1 3.9-10.3l2.8-2.8A9.9 9.9 0 1 0 12 21.9c5.7 0 9.5-4 9.5-9.6 0-.7-.1-1.4-.2-2.1H12Z" />
          </svg>
          Continuer avec Google
        </button>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Adresse e-mail"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => void withEmail()}
            disabled={busy || !email || password.length < 6}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {mode === "signin" ? "Se connecter" : "Créer un compte"}
          </button>
        </div>

        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "Pas encore de compte ? S'inscrire" : "Déjà inscrit ? Se connecter"}
        </button>

        {message && (
          <p className="rounded-lg border border-border bg-background p-2 text-xs text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plug, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  addMcpServer,
  getSettings,
  removeMcpServer,
  savePreference,
  testMcpServer,
  toggleMcpServer,
} from "@/lib/settings.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Réglages des fournisseurs et MCP — DeerFlow" },
      {
        name: "description",
        content:
          "Choisissez le fournisseur utilisé pour les images, vidéos et voix, le modèle de chat par défaut, et connectez vos serveurs MCP.",
      },
      { property: "og:title", content: "Réglages des fournisseurs et MCP — DeerFlow" },
      {
        property: "og:description",
        content:
          "Fournisseurs interchangeables, modèle de chat par défaut et serveurs MCP connectés à l'agent.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

type McpServer = {
  id: string;
  name: string;
  url: string;
  transport: string;
  active: boolean;
  last_error: string | null;
  tool_names: string[];
};

const PROVIDER_CHOICES: Array<{
  key: "provider_image" | "provider_video" | "provider_audio" | "provider_memory";
  label: string;
  options: string[];
}> = [
  { key: "provider_image", label: "Images", options: ["auto", "openai", "gemini", "huggingface", "lovable"] },
  { key: "provider_video", label: "Vidéos", options: ["auto", "runway", "replicate"] },
  { key: "provider_audio", label: "Voix et musique", options: ["auto", "elevenlabs", "kokoro", "piper", "huggingface"] },
  { key: "provider_memory", label: "Mémoire longue durée", options: ["auto", "database", "pinecone", "qdrant", "mem0"] },
];

const CHAT_MODELS = [
  "google/gemini-3.7-flash",
  "google/gemini-3.1-pro-preview",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-sol",
  "google/gemini-3.1-flash-lite",
];

function SettingsPage() {
  const load = useServerFn(getSettings);
  const save = useServerFn(savePreference);
  const add = useServerFn(addMcpServer);
  const test = useServerFn(testMcpServer);
  const toggle = useServerFn(toggleMcpServer);
  const remove = useServerFn(removeMcpServer);

  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const refresh = async () => {
    try {
      const data = await load();
      setPreferences(data.preferences);
      setServers(data.mcpServers as McpServer[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPref = async (key: (typeof PROVIDER_CHOICES)[number]["key"] | "chat_model", value: string) => {
    setPreferences((p) => ({ ...p, [key]: value }));
    try {
      await save({ data: { key, value } });
      toast.success("Réglage enregistré");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    }
  };

  const onAdd = async () => {
    if (!name.trim() || !url.trim()) return;
    setBusy("add");
    try {
      const res = await add({ data: { name: name.trim(), url: url.trim(), transport: "http" } });
      if (res.probe.ok) toast.success(`Connecté : ${res.probe.toolNames.length} outil(s) disponibles`);
      else toast.error(`Connexion échouée : ${res.probe.error}`);
      setName("");
      setUrl("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ajout impossible");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Retour à l'agent
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Réglages</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Choisissez qui produit quoi, le modèle de conversation par défaut, et branchez vos serveurs MCP.
      </p>

      {loading ? (
        <div className="mt-10 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Chargement…
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Fournisseurs</CardTitle>
              <CardDescription>
                « Auto » laisse l'agent choisir le meilleur fournisseur disponible et basculer sur un autre en cas
                d'échec.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {PROVIDER_CHOICES.map((row) => (
                <div key={row.key} className="flex flex-wrap items-center justify-between gap-3">
                  <Label className="text-sm">{row.label}</Label>
                  <div className="flex flex-wrap gap-2">
                    {row.options.map((option) => {
                      const current = preferences[row.key] ?? "auto";
                      return (
                        <Button
                          key={option}
                          size="sm"
                          variant={current === option ? "default" : "outline"}
                          onClick={() => void setPref(row.key, option)}
                        >
                          {option}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Modèle de conversation par défaut</CardTitle>
              <CardDescription>Utilisé pour le chat et pour les tâches programmées.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {CHAT_MODELS.map((model) => {
                const current = preferences["chat_model"] ?? CHAT_MODELS[0]!;
                return (
                  <Button
                    key={model}
                    size="sm"
                    variant={current === model ? "default" : "outline"}
                    onClick={() => void setPref("chat_model", model)}
                  >
                    {model}
                  </Button>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plug className="size-4" /> Serveurs MCP
              </CardTitle>
              <CardDescription>
                Les outils exposés par un serveur actif sont ajoutés automatiquement à l'agent, en plus de ses outils
                natifs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
                <Input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} />
                <Input
                  placeholder="https://exemple.com/mcp"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <Button onClick={() => void onAdd()} disabled={busy === "add"}>
                  {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : "Connecter"}
                </Button>
              </div>

              {servers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun serveur MCP connecté.</p>
              ) : (
                <ul className="space-y-3">
                  {servers.map((server) => (
                    <li key={server.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{server.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{server.url}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={server.active}
                            onCheckedChange={async (checked) => {
                              await toggle({ data: { id: server.id, active: checked } });
                              await refresh();
                            }}
                          />
                          <Button
                            size="icon"
                            variant="outline"
                            disabled={busy === server.id}
                            onClick={async () => {
                              setBusy(server.id);
                              const res = await test({ data: { id: server.id } });
                              if (res.ok) toast.success(`${res.toolNames.length} outil(s) détecté(s)`);
                              else toast.error(res.error);
                              setBusy(null);
                              await refresh();
                            }}
                          >
                            {busy === server.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <RefreshCw className="size-4" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={async () => {
                              await remove({ data: { id: server.id } });
                              await refresh();
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      {server.tool_names.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {server.tool_names.map((toolName) => (
                            <Badge key={toolName} variant="secondary">
                              {toolName}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {server.last_error && (
                        <p className="mt-2 text-xs text-destructive">{server.last_error}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}

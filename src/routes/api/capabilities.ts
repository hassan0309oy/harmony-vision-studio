import { createFileRoute } from "@tanstack/react-router";

/** Rapport honnête de ce qui est réellement opérationnel, sans exposer les clés. */
function has(name: string) {
  return Boolean(process.env[name]);
}

export const Route = createFileRoute("/api/capabilities")({
  server: {
    handlers: {
      GET: async () => {
        const report = [
          {
            id: "chat",
            label: "Chat IA multi-modèles",
            ready: has("LOVABLE_API_KEY"),
            missing: has("LOVABLE_API_KEY") ? [] : ["LOVABLE_API_KEY"],
          },
          {
            id: "search",
            label: "Recherche web & citations",
            ready: has("TAVILY_API_KEY"),
            missing: has("TAVILY_API_KEY") ? [] : ["TAVILY_API_KEY"],
          },
          {
            id: "browser",
            label: "Navigateur agentique",
            ready: has("FIRECRAWL_API_KEY"),
            missing: has("FIRECRAWL_API_KEY") ? [] : ["FIRECRAWL_API_KEY"],
          },
          {
            id: "image",
            label: "Génération d'images",
            ready:
              has("DEAPI_API_KEY") ||
              has("OPENAI_API_KEY") ||
              has("GEMINI_API_KEY") ||
              has("HF_TOKEN") ||
              has("LOVABLE_API_KEY"),
            missing: [],
            providers: [
              { name: "deapi", ready: has("DEAPI_API_KEY") },
              { name: "openai", ready: has("OPENAI_API_KEY") },
              { name: "gemini", ready: has("GEMINI_API_KEY") },
              { name: "huggingface", ready: has("HF_TOKEN") },
              { name: "lovable", ready: has("LOVABLE_API_KEY") },
            ],
          },
          {
            id: "video",
            label: "Génération vidéo",
            ready: has("DEAPI_API_KEY") || has("RUNWAY_API_KEY") || has("REPLICATE_API_TOKEN") || has("LOVABLE_API_KEY"),
            missing: [],
            providers: [
              { name: "deapi", ready: has("DEAPI_API_KEY") },
              { name: "lovable", ready: has("LOVABLE_API_KEY") },
              { name: "runway", ready: has("RUNWAY_API_KEY") },
              { name: "replicate", ready: has("REPLICATE_API_TOKEN") },
            ],
          },
          {
            id: "audio",
            label: "Voix, podcast & musique",
            ready:
              has("DEAPI_API_KEY") ||
              has("ELEVENLABS_API_KEY") ||
              has("KOKORO_API_URL") ||
              has("PIPER_API_URL") ||
              has("HF_TOKEN") ||
              has("LOVABLE_API_KEY"),
            missing: [],
            providers: [
              { name: "deapi", ready: has("DEAPI_API_KEY") },
              { name: "elevenlabs", ready: has("ELEVENLABS_API_KEY") },
              { name: "kokoro", ready: has("KOKORO_API_URL") },
              { name: "piper", ready: has("PIPER_API_URL") },
              { name: "voix intégrée (Lovable)", ready: has("LOVABLE_API_KEY") },
              { name: "huggingface (musique)", ready: has("HF_TOKEN") },
            ],

          },
          {
            id: "image_editing",
            label: "Retouche, détourage & agrandissement d'images",
            ready: has("DEAPI_API_KEY"),
            missing: has("DEAPI_API_KEY") ? [] : ["DEAPI_API_KEY"],
          },
          {
            id: "image_to_video",
            label: "Image animée en vidéo",
            ready: has("DEAPI_API_KEY"),
            missing: has("DEAPI_API_KEY") ? [] : ["DEAPI_API_KEY"],
          },
          {
            id: "transcription",
            label: "Transcription audio & vidéo",
            ready: has("DEAPI_API_KEY"),
            missing: has("DEAPI_API_KEY") ? [] : ["DEAPI_API_KEY"],
          },
          {
            id: "embeddings",
            label: "Embeddings (recherche sémantique)",
            ready: has("DEAPI_API_KEY") || has("LOVABLE_API_KEY"),
            missing: [],
            providers: [
              { name: "deapi", ready: has("DEAPI_API_KEY") },
              { name: "lovable", ready: has("LOVABLE_API_KEY") },
            ],
          },
          { id: "pptx", label: "PowerPoint .pptx", ready: true, missing: [] },
          {
            id: "sandbox",
            label: "Sandbox & aperçu en direct",
            ready: has("E2B_API_KEY"),
            missing: has("E2B_API_KEY") ? [] : ["E2B_API_KEY"],
          },
          {
            id: "memory",
            label: "Mémoire longue durée",
            ready: true,
            missing: [],
            providers: [
              { name: "base de données", ready: true },
              { name: "pinecone", ready: has("PINECONE_API_KEY") },
            ],
          },
          { id: "tasks", label: "Tâches programmées", ready: true, missing: [] },
        ];

        return new Response(JSON.stringify({ capabilities: report }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ModelMessage,
  type UIMessage,
} from "ai";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { deerflowTools } from "@/lib/deerflow-tools.server";
import { loadMcpTools } from "@/lib/providers/mcp.server";
import { readPreferences } from "@/lib/providers/settings.server";
import { createVideoEditingTools, mediaTools } from "@/lib/media-tools.server";
import { createDeapiTools, embedTextsTool } from "@/lib/deapi-tools.server";
import { agentTools } from "@/lib/agent-tools.server";
import { createMediaAnalysisTools } from "@/lib/media-analysis-tools.server";
import { createVisualReferenceTools } from "@/lib/visual-tools.server";
import { getUserFromRequest } from "@/lib/auth.server";


const SYSTEM_PROMPT = `Tu es DeerFlow, un super-agent autonome francophone.

Méthode de travail:
- Réponds en français, de façon claire et structurée (markdown).
- Pour toute mission non triviale, commence par make_plan, puis exécute les étapes une par une et mets le plan à jour.
- Analyse l'objectif et choisis dynamiquement le meilleur outil et le meilleur fournisseur pour CHAQUE étape (coût, qualité, disponibilité). Ne prends pas systématiquement le premier fournisseur.
- Si un outil renvoie { ok: false, error }, dis précisément ce qui a échoué et ce qui manque (clé d'API, service non déployé), puis tente un autre fournisseur quand c'est pertinent.

Outils réels à ta disposition:
- web_search / fetch_url / browse_web : recherche web temps réel, lecture d'URL, navigateur agentique. Cite toujours tes sources en liens markdown.
- generate_image, generate_video, generate_music, text_to_speech, create_podcast : production de médias RÉELS. Après succès, annonce simplement le résultat : l'interface affiche l'aperçu et le bouton Télécharger.
- create_presentation : vrai fichier PowerPoint .pptx.
- run_code : exécution réelle de code (analyse de données, calculs, graphiques). N'invente jamais un résultat de calcul.
- live_preview : déploie une application dans le sandbox et renvoie une URL d'aperçu en direct affichée à côté du chat.
- write_artifact : livrables texte/code/HTML affichés dans le panneau Artifacts.
- remember / recall : mémoire longue durée. Utilise recall en début de mission si le contexte utilisateur peut aider, et remember dès qu'une préférence durable apparaît.
- schedule_task / list_tasks : missions récurrentes.
- build_app : MODE NO CODE. Dès qu'on demande de créer un site web, une page ou une application, écris tous les fichiers et appelle build_app : l'interface bascule en mode chat + Aperçu avec un onglet Code. Ne te contente jamais de coller le code dans le chat dans ce cas.
- render_chart : dès qu'il y a des données chiffrées à visualiser, appelle render_chart. Le graphique s'affiche dans le chat et une page web autonome est générée.
- deep_research : pour toute veille, étude ou rapport documenté, utilise deep_research plutôt que des recherches isolées.
- delegate : confie une sous-mission autonome à un sous-agent spécialisé (recherche, media, code, analyse) et intègre son compte rendu.
- analyze_attached_media : OBLIGATOIRE dès qu'une vidéo ou un fichier audio est joint (utilise l'identifiant fourni dans le contexte des pièces jointes). N'affirme jamais avoir regardé une vidéo sans avoir appelé cet outil.
- analyze_media_url : analyse une vidéo/audio depuis une URL ou un lien Google Drive partagé.
- edit_video : OBLIGATOIRE lorsqu'on demande de modifier ou monter une vidéo jointe. Analyse d'abord la source et toute vidéo de référence, puis fournis des arguments FFmpeg complets et un fichier ASS pour les sous-titres stylisés. Cet outil produit et stocke le vrai MP4 ; n'utilise jamais run_code pour prétendre livrer une vidéo.
- analyze_visual_reference : OBLIGATOIRE avant toute génération devant reprendre le style d'une image ou d'une vidéo envoyée. Il renvoie la palette exacte, le cadrage, la lumière, la typographie et un prompt de reproduction : réutilise cette fiche mot pour mot dans generate_image, generate_video ou edit_video.
- generate_image_from_reference : génère une image en s'appuyant réellement sur les photos jointes (jusqu'à 4) pour reproduire fidèlement leur style. Préfère-le à generate_image dès qu'une référence visuelle existe.
- edit_image / upscale_image / remove_image_background : retouche, agrandissement x4 et détourage d'une image JOINTE (DeAPI). Utilise-les dès qu'on demande de modifier, améliorer, agrandir ou détourer une image envoyée.
- image_to_video : transforme une image JOINTE en vraie vidéo animée. Décris précisément le mouvement voulu.
- transcribe_media : transcription réelle avec horodatages d'un audio/vidéo joint ou d'une URL (YouTube incluse). Utilise-le quand on demande le texte, les sous-titres ou le verbatim d'un média.
- embed_texts : embeddings réels (vecteurs) pour comparer ou rechercher sémantiquement des textes.

Interdits: ne simule jamais une action, n'annonce jamais un fichier qui n'a pas été réellement produit par un outil, n'invente pas de sources, ne prétends jamais avoir lu un fichier dont l'extraction a échoué.`;

type ChatRequestBody = {
  messages?: unknown;
  model?: unknown;
  conversationId?: unknown;
  attachmentIds?: unknown;
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as ChatRequestBody;
        const messages = body.messages;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const user = await getUserFromRequest(request);
        if (!user) return new Response("Unauthorized", { status: 401 });

        const conversationId =
          typeof body.conversationId === "string" ? body.conversationId : null;
        const attachmentIds = Array.isArray(body.attachmentIds)
          ? (body.attachmentIds.filter((id) => typeof id === "string") as string[])
          : [];

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Vérification stricte de propriété de la conversation.
        if (conversationId) {
          const owned = await supabaseAdmin
            .from("conversations")
            .select("id")
            .eq("id", conversationId)
            .eq("user_id", user.id)
            .maybeSingle();
          if (!owned.data) return new Response("Conversation introuvable", { status: 403 });
        }

        const prefs = await readPreferences();
        const modelId =
          typeof body.model === "string" && body.model
            ? body.model
            : (prefs["chat_model"] ?? "google/gemini-3.7-flash");
        const gateway = createLovableAiGatewayProvider(key);
        const mcp = await loadMcpTools();

        const uiMessages = messages as UIMessage[];
        const modelMessages: ModelMessage[] = await convertToModelMessages(uiMessages);

        // Injection réelle du contenu des pièces jointes appartenant à l'utilisateur.
        if (attachmentIds.length > 0) {
          const { loadOwnedAttachments, extractAttachment } = await import(
            "@/lib/providers/attachments.server"
          );
          const rows = await loadOwnedAttachments(attachmentIds, user.id);
          const extras: Array<Record<string, unknown>> = [];
          const notes: string[] = [];

          for (const row of rows) {
            try {
              const extracted = await extractAttachment(row);
              if (extracted.kind === "text") {
                extras.push({
                  type: "text",
                  text: `Contenu extrait du fichier « ${row.name} » (${row.mime_type}) :\n\n${extracted.text}`,
                });
              } else if (extracted.kind === "image") {
                extras.push({
                  type: "file",
                  mediaType: extracted.mediaType,
                  data: new URL(extracted.url),
                });
              } else if (extracted.kind === "pdf") {
                extras.push({
                  type: "file",
                  mediaType: extracted.mediaType,
                  filename: row.name,
                  data: extracted.base64,
                });
              } else if (extracted.kind === "video" || extracted.kind === "audio") {
                notes.push(
                  `Fichier ${extracted.kind === "video" ? "vidéo" : "audio"} joint : « ${row.name} » (${row.mime_type}, ${(row.size / 1048576).toFixed(1)} Mo). Identifiant de pièce jointe : ${row.id}. Appelle l'outil analyze_attached_media avec cet identifiant pour l'analyser réellement.`,
                );
              } else {
                notes.push(`Fichier « ${row.name} » : ${extracted.reason}`);
              }
            } catch (error) {
              notes.push(
                `Fichier « ${row.name} » : lecture impossible (${error instanceof Error ? error.message : String(error)}).`,
              );
            }
          }
          if (notes.length > 0) {
            extras.push({ type: "text", text: notes.join("\n") });
          }

          if (extras.length > 0) {
            const last = modelMessages[modelMessages.length - 1];
            if (last && last.role === "user") {
              const current = Array.isArray(last.content)
                ? last.content
                : [{ type: "text", text: String(last.content) }];
              last.content = [...current, ...extras] as typeof last.content;
            } else {
              modelMessages.push({ role: "user", content: extras } as unknown as ModelMessage);
            }
          }
        }

        // Persistance du dernier message utilisateur.
        if (conversationId) {
          const lastUi = [...uiMessages].reverse().find((m) => m.role === "user");
          if (lastUi) {
            await supabaseAdmin.from("messages").insert({
              conversation_id: conversationId,
              user_id: user.id,
              role: "user",
              parts: lastUi.parts as never,
            });
            if (attachmentIds.length > 0) {
              await supabaseAdmin
                .from("attachments")
                .update({ conversation_id: conversationId })
                .in("id", attachmentIds)
                .eq("user_id", user.id);
            }
          }
        }

        const result = streamText({
          model: gateway(modelId),
          system: SYSTEM_PROMPT,
          messages: modelMessages,
          tools: {
            ...deerflowTools,
            ...mediaTools,
            ...createVideoEditingTools(user.id),
            ...createDeapiTools(user.id),
            embed_texts: embedTextsTool,
            ...agentTools,
            ...createMediaAnalysisTools(user.id),
            ...createVisualReferenceTools(user.id),
            ...mcp.tools,
          },
          stopWhen: stepCountIs(50),
          onFinish: () => {
            void mcp.close();
          },
          onAbort: () => {
            void mcp.close();
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: uiMessages,
          onFinish: async ({ responseMessage }) => {
            if (!conversationId || !responseMessage) return;
            await supabaseAdmin.from("messages").insert({
              conversation_id: conversationId,
              user_id: user.id,
              role: "assistant",
              parts: responseMessage.parts as never,
            });
            await supabaseAdmin
              .from("conversations")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", conversationId)
              .eq("user_id", user.id);
          },
          onError: (error) => {
            void mcp.close();
            return error instanceof Error ? error.message : String(error);
          },
        });
      },
    },
  },
});

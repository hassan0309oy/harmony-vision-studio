import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { deerflowTools } from "@/lib/deerflow-tools.server";
import { mediaTools } from "@/lib/media-tools.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Exécute réellement les tâches programmées dont l'heure est venue. Appelé par le planificateur. */
export const Route = createFileRoute("/api/public/hooks/run-scheduled-tasks")({
  server: {
    handlers: {
      POST: async () => {
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const rows = await supabaseAdmin
          .from("scheduled_tasks")
          .select("id, title, instruction, cron, active, last_run_at")
          .eq("active", true)
          .limit(20);
        if (rows.error) return new Response(rows.error.message, { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);
        const executed: Array<{ id: string; title: string }> = [];

        for (const task of rows.data ?? []) {
          if (!dueNow(task.cron, task.last_run_at)) continue;
          try {
            const result = streamText({
              model: gateway("google/gemini-3.7-flash"),
              system:
                "Tu es DeerFlow en mode tâche programmée. Exécute la mission avec tes outils réels et rends un compte rendu court en français.",
              messages: await convertToModelMessages([
                { id: task.id, role: "user", parts: [{ type: "text", text: task.instruction }] },
              ] as UIMessage[]),
              tools: { ...deerflowTools, ...mediaTools },
              stopWhen: stepCountIs(30),
            });
            const text = await result.text;
            await supabaseAdmin
              .from("scheduled_tasks")
              .update({ last_run_at: new Date().toISOString(), last_result: text.slice(0, 8000) })
              .eq("id", task.id);
            executed.push({ id: task.id, title: task.title });
          } catch (error) {
            await supabaseAdmin
              .from("scheduled_tasks")
              .update({
                last_run_at: new Date().toISOString(),
                last_result: `Échec : ${error instanceof Error ? error.message : String(error)}`,
              })
              .eq("id", task.id);
          }
        }

        return new Response(JSON.stringify({ executed }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

/** Évaluation cron minimale (minute, heure, jour, mois, jour de semaine) en UTC. */
function dueNow(expression: string, lastRunAt: string | null): boolean {
  const now = new Date();
  if (lastRunAt && now.getTime() - new Date(lastRunAt).getTime() < 55_000) return false;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const fields = [
    now.getUTCMinutes(),
    now.getUTCHours(),
    now.getUTCDate(),
    now.getUTCMonth() + 1,
    now.getUTCDay(),
  ];
  return parts.every((field, i) => matches(field, fields[i]!));
}

function matches(field: string, value: number): boolean {
  if (field === "*") return true;
  return field.split(",").some((chunk) => {
    const [range, stepRaw] = chunk.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!range || Number.isNaN(step) || step < 1) return false;
    if (range === "*") return value % step === 0;
    const [startRaw, endRaw] = range.split("-");
    const start = Number(startRaw);
    if (Number.isNaN(start)) return false;
    const end = endRaw !== undefined ? Number(endRaw) : start;
    if (Number.isNaN(end)) return false;
    return value >= start && value <= end && (value - start) % step === 0;
  });
}

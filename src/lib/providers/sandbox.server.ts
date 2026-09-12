import { requireEnv } from "./errors.server";

export type SandboxRun = {
  stdout: string;
  stderr: string;
  error?: string;
  images: string[];
  files: Array<{ path: string; url?: string }>;
  previewUrl?: string;
};

/** Exécution réelle de code dans un sandbox E2B. */
export async function runInSandbox(params: {
  language: "python" | "javascript";
  code: string;
  timeoutMs?: number;
}): Promise<SandboxRun> {
  const apiKey = requireEnv("E2B_API_KEY", "l'exécution de code en sandbox");
  const { Sandbox } = await import("@e2b/code-interpreter");
  const sandbox = await Sandbox.create({ apiKey });
  try {
    const execution = await sandbox.runCode(params.code, {
      language: params.language === "javascript" ? "js" : "python",
      timeoutMs: params.timeoutMs ?? 120_000,
    });
    const images = (execution.results ?? [])
      .map((r) => (r as { png?: string }).png)
      .filter((p): p is string => typeof p === "string");
    return {
      stdout: execution.logs.stdout.join("\n"),
      stderr: execution.logs.stderr.join("\n"),
      ...(execution.error
        ? { error: `${execution.error.name}: ${execution.error.value}` }
        : {}),
      images,
      files: [],
    };


  } finally {
    await sandbox.kill().catch(() => undefined);
  }
}

/** Démarre une application web dans le sandbox et renvoie une URL de prévisualisation en direct. */
export async function livePreview(params: {
  files: Array<{ path: string; content: string }>;
  startCommand: string;
  port: number;
  keepAliveMs?: number;
}): Promise<{ previewUrl: string; sandboxId: string; expiresInMs: number }> {
  const apiKey = requireEnv("E2B_API_KEY", "l'aperçu en direct (Live Preview)");
  const { Sandbox } = await import("@e2b/code-interpreter");
  const timeoutMs = params.keepAliveMs ?? 10 * 60 * 1000;
  const sandbox = await Sandbox.create({ apiKey, timeoutMs });

  for (const file of params.files) {
    await sandbox.files.write(`/home/user/app/${file.path}`, file.content);
  }
  await sandbox.commands.run(`cd /home/user/app && ${params.startCommand}`, { background: true });
  await new Promise((r) => setTimeout(r, 3000));

  const host = sandbox.getHost(params.port);
  return {
    previewUrl: `https://${host}`,
    sandboxId: sandbox.sandboxId,
    expiresInMs: timeoutMs,
  };
}

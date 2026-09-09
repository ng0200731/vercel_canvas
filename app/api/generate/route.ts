import { NextResponse } from "next/server";

import { isXiangsuConfigured, isOpenAiConfigured } from "@/lib/env";
import { imageGenerationRequestSchema } from "@/lib/image-generation-models";
import {
  generateXiangsuImage,
  type XiangsuGenerateInput,
  type XiangsuGenerateOutput,
} from "@/lib/xiangsu";
import { writeGenerateLog } from "@/lib/generate-log-store";
import {
  authorizeGeneration,
  consumeSuccessfulGeneration,
  type GenerationGuardResult,
} from "@/lib/generation-usage";

export const runtime = "nodejs";

interface GenerateRouteDependencies {
  configured: boolean;
  generate: (input: XiangsuGenerateInput, signal?: AbortSignal) => Promise<XiangsuGenerateOutput>;
  guard?: () => Promise<GenerationGuardResult>;
}

export function createGeneratePostHandler({ configured, generate, guard }: GenerateRouteDependencies) {
  return async function POST(request: Request) {
    if (!configured) {
      return NextResponse.json(
        { error: "AI generation is disabled. Set XIANGSU_API_KEY in .env.local." },
        { status: 503 },
      );
    }

    let guardResult: GenerationGuardResult | null = null;
    if (guard) {
      guardResult = await guard();
      if (!guardResult.ok) {
        return NextResponse.json(
          { error: guardResult.error, remaining: guardResult.remaining ?? 0 },
          { status: guardResult.status },
        );
      }
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = imageGenerationRequestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 },
      );
    }

    try {
      const startedAt = Date.now();
      const result = await generate(parsed.data, request.signal);
      if (guardResult?.ok && !guardResult.isAdmin) {
        const consumed = await consumeSuccessfulGeneration({
          userId: guardResult.userId,
          model: result.model,
          prompt: parsed.data.prompt,
          size: parsed.data.size,
          outputUrl: result.url,
        });
        if (!consumed.allowed) {
          writeGenerateLog({ ok: false, request: parsed.data, error: "Generation allowance used up." });
          return NextResponse.json(
            { error: "Your lifetime generation allowance has been used up.", remaining: consumed.remaining },
            { status: 429 },
          );
        }
      }
      writeGenerateLog({
        ok: true,
        request: parsed.data,
        compiledPrompt: result.diagnostics?.compiledPrompt,
        resolvedReferences: result.diagnostics?.resolvedReferences,
        formFields: result.diagnostics?.formFields,
        response: { url: result.url, model: result.model },
        durationMs: Date.now() - startedAt,
      });
      // Strip diagnostics from the client response — they're for the log only.
      const { diagnostics: _omit, ...clientResult } = result;
      return NextResponse.json(clientResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed.";
      writeGenerateLog({
        ok: false,
        request: parsed.data,
        error: message,
      });
      return NextResponse.json({ error: message }, { status: 502 });
    }
  };
}

export const POST = createGeneratePostHandler({
  configured: isXiangsuConfigured || isOpenAiConfigured,
  guard: authorizeGeneration,
  generate: (input, signal) =>
    generateXiangsuImage(
      {
        model: input.model,
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        size: input.size,
        outputFormat: input.outputFormat,
        resolution: input.resolution,
        references: input.references,
        matchSourceSize: input.matchSourceSize,
      },
      signal,
    ),
});

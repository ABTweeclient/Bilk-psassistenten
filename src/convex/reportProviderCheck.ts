"use node";

/**
 * Modellkontrollen för /admin.
 *
 * Svarar på tre frågor med hjälp av Googles egna svar i stället för antaganden:
 *
 *  1. Finns modellnamnet i LLM_MODEL hos Google, och tar modellen emot
 *     generateContent?
 *  2. Tar modellen emot sökverktyget (Google Search-grounding)? Det avgörs med
 *     ett litet, riktigt anrop med verktyget påslaget, eftersom Googles
 *     modellista inte har något fält för verktyg.
 *  3. Om svaret inte går att läsa eller saknar text – sitter felet i
 *     sökverktyget eller i tolkningen? Därför körs exakt samma lilla anrop en
 *     gång till, utan verktyget. Är skillnaden bara verktyget är felet knutet
 *     till grounding; misslyckas båda finns felet i tolkningen, i modellen eller
 *     i anropets budget.
 *
 * Båda anropen läses tolerant och returnerar alltid finishReason, sökningar,
 * token och (när texten saknas) den kortade råa svarsstrukturen. Ett misslyckat
 * testanrop är fortfarande ett betalt anrop, så användningen redovisas.
 *
 * Bara en administratör kan köra kontrollen, och svaret innehåller varken
 * nycklar eller nyckelnamn.
 */

import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { FailureKind } from "../lib/reportFailure";
import {
  checkGoogleModel,
  describeGoogleThinking,
  googleThinkingBudgetTokens,
  probeGoogle,
  ProviderError,
  resolveProvider,
  type GroundingProbe,
} from "./reportProviders";

export type ProviderModelCheck = {
  provider: string;
  model: string;
  /** Modellistan, när den gick att hämta. */
  google: {
    modelExists: boolean;
    supportsGenerateContent: boolean;
    groundingSupported: boolean;
    suggestions: string[];
    modelsAvailable: number;
  } | null;
  /** Vad tänkandet är inställt på i anropen, i klartext. */
  thinking: string;
  /** Resultatet av det riktiga anropet med sökverktyget. */
  probe: GroundingProbe | null;
  /** Samma anrop utan sökverktyget, för att skilja verktygsfel från tolkningsfel. */
  probeWithoutTool: GroundingProbe | null;
  /** Feltext när kontrollen inte kunde genomföras. */
  error: string | null;
  kind: FailureKind | null;
  checkedAt: string;
};

export const checkModel = action({
  args: {},
  handler: async (ctx): Promise<ProviderModelCheck> => {
    const viewer = await ctx.runQuery(internal.adminAccess.viewerIsAdmin);
    if (!viewer.isAdmin) {
      throw new ConvexError({ code: "NOT_ADMIN", message: "Endast administratören kan kontrollera modellen." });
    }

    const checkedAt = new Date().toISOString();
    const empty: ProviderModelCheck = {
      provider: "–",
      model: "–",
      google: null,
      thinking: "–",
      probe: null,
      probeWithoutTool: null,
      error: null,
      kind: null,
      checkedAt,
    };

    let provider: string;
    let model: string;
    try {
      const resolved = resolveProvider();
      provider = resolved.id;
      model = resolved.defaultModel();
    } catch (error) {
      const known = error instanceof ProviderError ? error : null;
      return {
        ...empty,
        error: error instanceof Error ? error.message : "Leverantören kunde inte läsas.",
        kind: known?.kind ?? "provider_not_configured",
      };
    }

    if (provider !== "google") {
      return {
        ...empty,
        provider,
        model,
        error: `Modellkontrollen är byggd för Google. Leverantören som används är ${provider}.`,
      };
    }

    const thinking = describeGoogleThinking(model, googleThinkingBudgetTokens);

    let google: ProviderModelCheck["google"] = null;
    let error: string | null = null;
    let kind: FailureKind | null = null;

    try {
      const check = await checkGoogleModel(model);
      google = {
        modelExists: check.modelExists,
        supportsGenerateContent: check.supportsGenerateContent,
        groundingSupported: check.groundingSupported,
        suggestions: check.suggestions,
        modelsAvailable: check.modelsAvailable.length,
      };
      if (check.listFailed) {
        error = `Modellistan kunde inte hämtas: ${check.listFailed}`;
        kind = "provider_error";
      } else if (!check.modelExists) {
        error = `Modellnamnet "${model}" finns inte i Googles modellista.`;
        kind = "provider_model_unknown";
      } else if (!check.supportsGenerateContent) {
        error = `Modellen "${model}" tar inte emot generateContent enligt modellistan.`;
        kind = "provider_model_unknown";
      }
    } catch (caught) {
      const known = caught instanceof ProviderError ? caught : null;
      error = caught instanceof Error ? caught.message : "Modellistan kunde inte hämtas.";
      kind = known?.kind ?? "provider_error";
    }

    /* Testanropen görs bara när modellen finns och kan användas: annars kostar
       de pengar för att bevisa något vi redan vet. De två anropen skiljer sig
       bara åt på en punkt – sökverktyget – så en jämförelse säger vad felet
       sitter i. */
    let probe: GroundingProbe | null = null;
    let probeWithoutTool: GroundingProbe | null = null;
    if (google && google.modelExists && google.supportsGenerateContent) {
      [probe, probeWithoutTool] = await Promise.all([
        probeGoogle(model, { withSearchTool: true }),
        probeGoogle(model, { withSearchTool: false }),
      ]);
    }

    return { provider, model, google, thinking, probe, probeWithoutTool, error, kind, checkedAt };
  },
});

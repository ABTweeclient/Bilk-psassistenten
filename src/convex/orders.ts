import { v } from "convex/values";
import { reportRequestSchema } from "../lib/report";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";

/**
 * Betalda rapporter.
 *
 * En order skapas av klienten men får aldrig starta en generering förrän
 * Stripe bekräftat betalningen i webhooken. Rapporten är bara läsbar via
 * ordens `token`, som är slumpad och aldrig härledd ur något annat id.
 */

export const orderStatus = {
  pending: "pending",
  paid: "paid",
  generating: "generating",
  done: "done",
  failed: "failed",
} as const;

/** Antal nya försök kunden får göra utan att betala igen. */
export const maxRetries = 3;

const tokenLength = 64;

/**
 * 64 tecken ur två UUID:n. Kryptografiskt slumpad och omöjlig att gissa, och
 * tillräckligt lång för att inte kunna brute-forceas mot `by_token`.
 */
function createToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, tokenLength);
}

/** Priset i ören. Sätts som miljövariabel – aldrig hårdkodat i koden. */
function priceOre(): number {
  const configured = Number(process.env.PRICE_ORE);
  if (!Number.isInteger(configured) || configured <= 0) {
    throw new Error("PRICE_ORE_MISSING");
  }
  return configured;
}

/** Basadressen för success- och cancel-URL:er, utan avslutande snedstreck. */
function siteUrl(): string {
  const configured = process.env.SITE_URL?.trim();
  if (!configured) throw new Error("SITE_URL_MISSING");
  return configured.replace(/\/+$/, "");
}

/** Sant när Stripe-nyckeln är en testnyckel. Bara en flagga – aldrig nyckeln. */
function stripeTestMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

async function orderByToken(ctx: MutationCtx, token: string) {
  if (typeof token !== "string" || token.length < 32) return null;
  return await ctx.db
    .query("orders")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
}

/* ------------------------------------------------------------------ *\
 * Publikt: pris, order skapas, checkout, status och nytt försök
 * ------------------------------------------------------------------ */

/** Priset till knappen och flaggan för testläget. Innehåller inga hemligheter. */
export const publicConfig = query({
  args: {},
  handler: async () => {
    const configured = Number(process.env.PRICE_ORE);
    return {
      priceOre: Number.isInteger(configured) && configured > 0 ? configured : 0,
      testMode: stripeTestMode(),
    };
  },
});

/**
 * Skapar en väntande order. Ingen generering startas här – det sker först när
 * webhooken bekräftat betalningen.
 */
export const createOrder = mutation({
  args: { carInput: v.any() },
  handler: async (ctx, args) => {
    const parsed = reportRequestSchema.safeParse(args.carInput);
    if (!parsed.success) throw new Error("INVALID_INPUT");

    const token = createToken();
    const orderId = await ctx.db.insert("orders", {
      token,
      carInput: parsed.data,
      status: orderStatus.pending,
      createdAt: Date.now(),
      retryCount: 0,
    });
    return { orderId, token };
  },
});

/**
 * Skapar Stripe Checkout-sessionen för en väntande order och sparar dess id.
 * Betalsätten väljs av Stripe (inget hårdkodat `payment_method_types`).
 */
export const createCheckout = action({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const order = await ctx.runQuery(internal.orders.getInternalOrder, { orderId: args.orderId });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.status !== orderStatus.pending) throw new Error("ORDER_NOT_PENDING");

    const vehicle = order.carInput as { make: string; model: string; year: number };
    const session = await ctx.runAction(internal.stripePayments.createSession, {
      orderId: args.orderId,
      token: order.token,
      productName: `Bilrapport – ${vehicle.make} ${vehicle.model} ${vehicle.year}`.slice(0, 120),
      priceOre: priceOre(),
      siteUrl: siteUrl(),
    });
    if (!session.url) throw new Error("CHECKOUT_URL_MISSING");

    await ctx.runMutation(internal.orders.attachSession, {
      orderId: args.orderId,
      stripeSessionId: session.id,
    });
    return { url: session.url };
  },
});

/**
 * Ordens status för /order/[token]. Det är enda vägen till rapporten: statusen
 * kommer från servern och success-sidan i Stripe litas aldrig på.
 */
export const getOrder = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (typeof args.token !== "string" || args.token.length !== tokenLength) return null;
    const order = await ctx.db
      .query("orders")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!order) return null;
    return {
      token: order.token,
      status: order.status,
      vehicle: order.carInput,
      retryCount: order.retryCount,
      reportId: order.reportId ?? null,
      createdAt: order.createdAt,
      canRetry: order.status === orderStatus.failed && order.retryCount < maxRetries,
      retriesLeft: Math.max(0, maxRetries - order.retryCount),
    };
  },
});

/**
 * "Försök igen" efter ett misslyckat försök. Ingen ny betalning, men bara så
 * länge ordens retryCount är under taket. Statusen kontrolleras på servern.
 */
export const retryOrder = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const order = await orderByToken(ctx, args.token);
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.status !== orderStatus.failed) throw new Error("ORDER_NOT_FAILED");
    if (order.retryCount >= maxRetries) throw new Error("RETRY_LIMIT_REACHED");

    await ctx.scheduler.runAfter(0, internal.orders.startGeneration, {
      orderId: order._id,
      retry: true,
    });
    return { ok: true as const, retriesLeft: maxRetries - order.retryCount };
  },
});

/* ------------------------------------------------------------------ *\
 * Internt: webhookens övergångar och själva genereringen
 * ------------------------------------------------------------------ */

export const getInternalOrder = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => await ctx.db.get(args.orderId),
});

/** Sparar Stripe-sessionens id på ordern, så att webhooken kan hitta den. */
export const attachSession = internalMutation({
  args: { orderId: v.id("orders"), stripeSessionId: v.string() },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order) return;
    await ctx.db.patch(args.orderId, { stripeSessionId: args.stripeSessionId });
  },
});

/**
 * Webhookens enda väg in. Idempotent på två nivåer:
 *
 *  1. Event-id:t sparas i `stripeEvents`; samma event behandlas aldrig två
 *     gånger även om Stripe skickar det igen.
 *  2. Ordern måste fortfarande vara "pending". Är den redan paid, generating
 *     eller done händer ingenting.
 *
 * Först när båda passeras sätts statusen till "paid" och genereringen
 * schemaläggs. Anropas bara från /stripe-webhook efter signaturkontroll.
 */
export const markPaid = internalMutation({
  args: { sessionId: v.string(), eventId: v.string(), eventType: v.string() },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("stripeEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (seen) return { handled: false as const, reason: "duplicate_event" as const };

    await ctx.db.insert("stripeEvents", {
      eventId: args.eventId,
      type: args.eventType,
      createdAt: Date.now(),
    });

    const order = await ctx.db
      .query("orders")
      .withIndex("by_session", (q) => q.eq("stripeSessionId", args.sessionId))
      .first();
    if (!order) return { handled: false as const, reason: "unknown_session" as const };
    if (order.status !== orderStatus.pending) {
      return { handled: false as const, reason: "already_paid" as const };
    }

    await ctx.db.patch(order._id, { status: orderStatus.paid });
    await ctx.scheduler.runAfter(0, internal.orders.startGeneration, {
      orderId: order._id,
      retry: false,
    });
    return { handled: true as const, orderId: order._id };
  },
});

/** Flyttar ordern till "generating" och räknar upp retryCount vid ett nytt försök. */
export const beginGeneration = internalMutation({
  args: { orderId: v.id("orders"), retry: v.boolean() },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order) return null;
    if (order.status !== orderStatus.paid && order.status !== orderStatus.failed) return null;
    if (args.retry && order.retryCount >= maxRetries) return null;

    await ctx.db.patch(args.orderId, {
      status: orderStatus.generating,
      retryCount: args.retry ? order.retryCount + 1 : order.retryCount,
    });
    return order.retryCount;
  },
});

export const finishGeneration = internalMutation({
  args: { orderId: v.id("orders"), reportId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orderId, { status: orderStatus.done, reportId: args.reportId });
  },
});

export const failGeneration = internalMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orderId, { status: orderStatus.failed });
  },
});

/**
 * Kör rapportpipelinen för en betald order. Startas bara från markPaid eller
 * retryOrder, alltså aldrig av klienten direkt – och aldrig för en order som
 * inte är betald.
 */
export const startGeneration = internalAction({
  args: { orderId: v.id("orders"), retry: v.boolean() },
  handler: async (ctx, args) => {
    const order = await ctx.runQuery(internal.orders.getInternalOrder, { orderId: args.orderId });
    if (!order) return;
    if (order.status !== orderStatus.paid && order.status !== orderStatus.failed) return;

    const started = await ctx.runMutation(internal.orders.beginGeneration, {
      orderId: args.orderId,
      retry: args.retry,
    });
    if (started === null) return;

    try {
      const result = await ctx.runAction(internal.reportPipeline.generateReport, {
        input: order.carInput,
        /* Rate limitet räknas per order, inte per ip: en betald order är redan
           verifierad och ska inte kunna blockeras av någon annans trafik. */
        clientKey: `order:${order.token}`,
      });
      await ctx.runMutation(internal.orders.finishGeneration, {
        orderId: args.orderId,
        reportId: result.reportId,
      });
    } catch (error) {
      console.error("[orders] genereringen misslyckades:", error);
      await ctx.runMutation(internal.orders.failGeneration, { orderId: args.orderId });
    }
  },
});

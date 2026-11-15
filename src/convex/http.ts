import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Stripe-webhook.
 *
 * Kroppen läses som rå text och signaturen verifieras mot den – en parsad body
 * skulle aldrig matcha signaturen. Ogiltig signatur ger 400 och rör ingenting.
 * Allt arbete ligger i databasen och svaret går tillbaka direkt, eftersom
 * Stripe annars skickar om eventet.
 */
http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("stripe-signature");
    if (!signature) return new Response("missing signature", { status: 400 });

    const raw = await request.text();

    let event: { id: string; type: string; paymentStatus: string | null; sessionId: string | null };
    try {
      event = await ctx.runAction(internal.stripePayments.verifyWebhook, { raw, signature });
    } catch (error) {
      console.error("[stripe-webhook] signaturen kunde inte verifieras:", error);
      return new Response("invalid signature", { status: 400 });
    }

    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded"
    ) {
      return new Response("ignored event", { status: 200 });
    }
    if (event.paymentStatus !== "paid") return new Response("not paid", { status: 200 });
    if (!event.sessionId) return new Response("missing session", { status: 200 });

    try {
      await ctx.runMutation(internal.orders.markPaid, {
        sessionId: event.sessionId,
        eventId: event.id,
        eventType: event.type,
      });
    } catch (error) {
      /* Ett fel här får inte tystas bort: Stripe ska få ett felstatus så att
         eventet skickas igen, och idempotensen gör att det är säkert. */
      console.error("[stripe-webhook] kunde inte hantera betalningen:", error);
      return new Response("handler failed", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  }),
});

export default http;

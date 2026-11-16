"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Allt som rör Stripe SDK ligger här, i Node-runtime.
 *
 * Nycklarna läses ur Convex miljövariabler och lämnar aldrig servern: inga
 * hemligheter skickas till klienten, loggas eller sparas i databasen.
 */

function client(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY_MISSING");
  return new Stripe(key, { maxNetworkRetries: 2 });
}

/**
 * Skapar en Checkout-session för ett engångsköp. `payment_method_types`
 * utelämnas med flit – Stripe väljer då de betalsätt som är aktiverade på
 * kontot. `allow_promotion_codes` låter kunden ange en rabattkod i kassan; en
 * kod på 100 % gör att Stripe sätter `payment_status` till
 * "no_payment_required" i stället för "paid".
 */
export const createSession = internalAction({
  args: {
    orderId: v.string(),
    token: v.string(),
    productName: v.string(),
    priceOre: v.number(),
    siteUrl: v.string(),
  },
  handler: async (_ctx, args): Promise<{ id: string; url: string | null }> => {
    const session = await client().checkout.sessions.create({
      mode: "payment",
      currency: "sek",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "sek",
            unit_amount: args.priceOre,
            product_data: { name: args.productName },
          },
        },
      ],
      allow_promotion_codes: true,
      metadata: { orderId: args.orderId },
      client_reference_id: args.orderId,
      success_url: `${args.siteUrl}/order/${args.token}`,
      cancel_url: `${args.siteUrl}/?avbruten=1`,
    });
    return { id: session.id, url: session.url };
  },
});

/**
 * Verifierar signaturen mot den råa bodyn med `constructEventAsync` och lämnar
 * tillbaka bara det http-actions behöver. Kastar vid ogiltig signatur, så att
 * webhooken kan svara 400 utan att röra databasen.
 */
export const verifyWebhook = internalAction({
  args: { raw: v.string(), signature: v.string() },
  handler: async (
    _ctx,
    args,
  ): Promise<{
    id: string;
    type: string;
    paymentStatus: string | null;
    sessionId: string | null;
  }> => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET_MISSING");

    const event = await client().webhooks.constructEventAsync(args.raw, args.signature, secret);
    const session = event.data.object as Stripe.Checkout.Session;
    return {
      id: event.id,
      type: event.type,
      paymentStatus: session.payment_status ?? null,
      sessionId: session.id ?? null,
    };
  },
});

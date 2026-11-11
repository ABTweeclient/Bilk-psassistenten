import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    // Två vägar för att skicka koden. Är RESEND_API_KEY satt används den
    // egna avsändaren (samma sexsiffriga kod och samma flöde, bara en annan
    // brevlåda), annars skickas koden via Freebuff-integrationsgatewayen med
    // VLY_INTEGRATION_KEY. Det gör att inloggningen fungerar även utan
    // integrationsnyckeln, utan att något annat i inloggningen ändras.
    if (process.env.RESEND_API_KEY) {
      await sendWithResend(email, token);
      return;
    }
    try {
      await axios.post(
        freebuffEmailOtpUrl(),
        { to: email, otp: token },
        { headers: freebuffEmailOtpHeaders() },
      );
    } catch (error) {
      throw freebuffEmailOtpError(error);
    }
  },
});

// Avsändaren när RESEND_API_KEY är satt. Standardadressen är Resends
// testdomän, som bara får skicka till kontots egen adress – precis den
// adress administratören loggar in med. Sätt RESEND_FROM när en egen
// domän är verifierad i stället.
async function sendWithResend(email: string, token: string): Promise<void> {
  const from =
    process.env.RESEND_FROM || "Bilköpsassistenten <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Din inloggningskod",
      text: `Din inloggningskod är ${token}. Koden gäller i 15 minuter.`,
    }),
  });
  if (!response.ok) {
    // Läs bara ut leverantörens feltext – aldrig hela svaret eller anropet,
    // som bär med sig nyckeln i sin Authorization-header.
    let detail = "";
    try {
      const body = (await response.json()) as { message?: unknown; error?: unknown };
      const text = typeof body.message === "string" ? body.message : body.error;
      if (typeof text === "string") detail = `: ${text}`;
    } catch {
      detail = "";
    }
    throw new Error(
      `Could not send the sign-in code (HTTP ${response.status})${detail}`,
    );
  }
}

// Sign-in codes are sent by the Freebuff integrations gateway, which knows
// this project by its own key: VLY_INTEGRATION_KEY, a Convex environment
// variable set when the project was created. The email's wording is fixed by
// the gateway.
function freebuffEmailOtpUrl(): string {
  const base =
    process.env.VLY_INTEGRATION_BASE_URL || "https://integrations.vly.ai";
  return `${base.replace(/\/+$/, "")}/v1/email/otp`;
}

function freebuffEmailOtpHeaders(): Record<string, string> {
  const key = process.env.VLY_INTEGRATION_KEY;
  if (!key) {
    throw new Error(
      "VLY_INTEGRATION_KEY is not set on this Convex deployment, so email sign-in cannot send codes.",
    );
  }
  return { Authorization: `Bearer ${key}` };
}

// Never stringify the whole request error: it carries the request headers.
function freebuffEmailOtpError(error: unknown): Error {
  const response = (
    error as { response?: { status?: number; data?: { error?: unknown } } }
  )?.response;
  if (response) {
    const detail =
      typeof response.data?.error === "string" ? `: ${response.data.error}` : "";
    return new Error(
      `Could not send the sign-in code (HTTP ${response.status})${detail}`,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Could not send the sign-in code: ${message}`);
}

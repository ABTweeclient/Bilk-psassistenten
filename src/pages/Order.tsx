import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import qlarLogo from "@/assets/qlar-logo.png";
import { TestModeBanner } from "@/components/TestModeBanner";
import { api } from "@/convex/_generated/api";
import { GeneratedReport } from "@/pages/Report";
import "@/styles/system.css";
import "@/components/report/report.css";
import "./Order.css";

/**
 * Ordens sida: /order/[token].
 *
 * Statusen kommer från servern och uppdateras reaktivt. Sidan litar aldrig på
 * att kunden kommit hit via Stripes success-URL – en obetald order stannar i
 * "Väntar på betalningsbekräftelse" oavsett hur adressen skrevs.
 */

function vehicleLine(vehicle: unknown): string {
  const car = vehicle as { make?: string; model?: string; year?: number; engine?: string } | undefined;
  if (!car) return "";
  return [car.make, car.model, car.year ? String(car.year) : "", car.engine].filter(Boolean).join(" · ");
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="order-page">
      <header className="order-header">
        <Link to="/" aria-label="Bilköpsassistenten, startsida">
          <img className="order-logo" src={qlarLogo} alt="Bilköpsassistenten" />
        </Link>
      </header>
      <main className="order-main">
        <TestModeBanner />
        <section className="order-panel" aria-live="polite">
          <p className="order-mono">DIN RAPPORT</p>
          <h1>{title}</h1>
          <div className="order-body">{children}</div>
        </section>
      </main>
    </div>
  );
}

export default function OrderPage() {
  const { token = "" } = useParams();
  const order = useQuery(api.orders.getOrder, token ? { token } : "skip");
  const retryOrder = useMutation(api.orders.retryOrder);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/order/${token}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    setRetryError("");
    try {
      await retryOrder({ token });
      setRetrying(false);
    } catch (error) {
      setRetrying(false);
      setRetryError(
        error instanceof Error && error.message.includes("RETRY_LIMIT_REACHED")
          ? "Inga fler försök återstår för den här ordern."
          : "Det gick inte att starta ett nytt försök just nu. Försök igen om en stund.",
      );
    }
  }

  if (order === undefined) {
    return (
      <Shell title="Hämtar din order…">
        <p>Ett ögonblick.</p>
      </Shell>
    );
  }

  if (order === null) {
    return (
      <Shell title="Ordern hittades inte">
        <p>
          Länken kan vara felstavad eller höra till en order som inte finns. Gå tillbaka till startsidan om du vill
          köpa en rapport.
        </p>
        <p>
          <Link className="order-button" to="/">Till startsidan</Link>
        </p>
      </Shell>
    );
  }

  if (order.status === "done" && order.reportId) {
    return (
      <>
        <div className="order-save">
          <div className="order-save__inner">
            <p>
              <strong>Spara den här länken – det är din rapport.</strong> Vi skickar den inte via e-post.
            </p>
            <button type="button" className="order-save__copy" onClick={() => void copyLink()}>
              {copied ? "Kopierad!" : "Kopiera länk"}
            </button>
          </div>
        </div>
        <GeneratedReport reportId={order.reportId} retryToken={token} />
      </>
    );
  }

  if (order.status === "failed") {
    return (
      <Shell title="Rapporten kunde inte skapas">
        <p>
          Betalningen är genomförd, men sammanställningen stötte på ett tekniskt fel. Det beror inte på uppgifterna du
          angav. Du kan försöka igen utan att betala något mer
          {order.canRetry ? ` – ${order.retriesLeft} ${order.retriesLeft === 1 ? "försök" : "försök"} kvar.` : "."}
        </p>
        <p className="order-vehicle">{vehicleLine(order.vehicle)}</p>
        {order.canRetry ? (
          <p>
            <button type="button" className="order-button" onClick={() => void retry()} disabled={retrying}>
              {retrying ? "Startar nytt försök…" : "Försök igen"}
            </button>
          </p>
        ) : (
          <p>
            Alla försök för den här ordern är använda. Kontakta oss så löser vi det, eller{" "}
            <Link to="/">köp en ny rapport</Link>.
          </p>
        )}
        {retryError && (
          <p className="order-error" role="alert">{retryError}</p>
        )}
      </Shell>
    );
  }

  if (order.status === "paid" || order.status === "generating") {
    return (
      <Shell title="Betalning mottagen, din rapport skapas (ca 1 min)">
        <p>
          Betalningen är bekräftad. Rapporten sammanställs nu och sidan uppdateras automatiskt när den är klar – du
          behöver inte ladda om.
        </p>
        <p className="order-vehicle">{vehicleLine(order.vehicle)}</p>
        <p className="order-progress" aria-busy="true">Arbetet pågår…</p>
      </Shell>
    );
  }

  return (
    <Shell title="Väntar på betalningsbekräftelse…">
      <p>
        Vi väntar på att betalningen ska bekräftas. Sidan uppdateras automatiskt så snart Stripe svarat – stäng den
        inte om du precis betalat.
      </p>
      <p className="order-vehicle">{vehicleLine(order.vehicle)}</p>
      <p>
        Avbröt du betalningen? <Link to="/">Gå tillbaka till startsidan</Link> – uppgifterna ligger kvar i fliken.
      </p>
    </Shell>
  );
}

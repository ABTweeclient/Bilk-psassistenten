import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import "./test-mode-banner.css";

/**
 * Liten banner när Stripe-nyckeln är en testnyckel. Flaggan kommer från
 * servern; nyckeln själv lämnar aldrig Convex.
 */
export function TestModeBanner() {
  const config = useQuery(api.orders.publicConfig);
  if (!config?.testMode) return null;
  return (
    <p className="test-mode-banner" role="status">
      <span>TESTLÄGE</span> Inga riktiga betalningar dras – använd testkortet 4242 4242 4242 4242.
    </p>
  );
}

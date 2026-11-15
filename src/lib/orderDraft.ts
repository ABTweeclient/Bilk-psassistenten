import type { VehicleFormValues, VehicleSubmission } from "@/lib/vehicleForm";

/**
 * Utkastet som sparas innan kunden skickas till Stripe.
 *
 * cancel_url är fast (/?avbruten=1), så uppgifterna kan inte komma tillbaka via
 * ordern. De sparas i sessionStorage – bara i den här fliken, och bara till
 * dess att betalningen är genomförd.
 */

const draftKey = "bilinsyn:order-draft";

const drivetrainFromSubmission: Record<string, VehicleFormValues["drivetrain"]> = {
  Framhjulsdrift: "Framhjul",
  Bakhjulsdrift: "Bakhjul",
  Fyrhjulsdrift: "Fyrhjul",
  "Vet ej": "Vet ej",
};

/** Gör om det inskickade underlaget till de värden formuläret visar. */
export function submissionToFormValues(submission: VehicleSubmission): VehicleFormValues {
  return {
    make: submission.make,
    model: submission.model,
    year: String(submission.year),
    engine: submission.engine,
    gearbox: submission.gearbox,
    drivetrain: drivetrainFromSubmission[submission.drivetrain] ?? "Vet ej",
    mileage: submission.mileage_km === null ? "" : String(Math.round(submission.mileage_km / 10)),
    purchase_timing: submission.purchase_timing,
  };
}

export function saveOrderDraft(submission: VehicleSubmission): void {
  try {
    window.sessionStorage.setItem(draftKey, JSON.stringify(submissionToFormValues(submission)));
  } catch {
    /* Privat läge eller fullt lagringsutrymme ska aldrig stoppa köpet. */
  }
}

export function readOrderDraft(): VehicleFormValues | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VehicleFormValues>;
    if (typeof parsed.make !== "string" || typeof parsed.model !== "string") return null;
    return {
      make: parsed.make ?? "",
      model: parsed.model ?? "",
      year: parsed.year ?? "",
      engine: parsed.engine ?? "",
      gearbox: parsed.gearbox ?? "Vet ej",
      drivetrain: parsed.drivetrain ?? "Vet ej",
      mileage: parsed.mileage ?? "",
      purchase_timing: parsed.purchase_timing ?? "",
    };
  } catch {
    return null;
  }
}

export function clearOrderDraft(): void {
  try {
    window.sessionStorage.removeItem(draftKey);
  } catch {
    /* Inget att städa. */
  }
}

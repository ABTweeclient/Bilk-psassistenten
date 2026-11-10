import { z } from "zod";
import { purchaseTimingSchema, reportRequestSchema } from "@/lib/report";

export const currentModelYear = new Date().getFullYear();

const purchaseTimingFormSchema = z.string().refine(
  (value): value is z.infer<typeof purchaseTimingSchema> => purchaseTimingSchema.safeParse(value).success,
  "Välj när du planerar att köpa.",
);

/** Raw browser values are parsed here, then normalized to the API's vehicle shape. */
export const vehicleFormSchema = z.object({
  make: z.string().trim().min(1, "Ange bilmärke.").max(60, "Märket får vara högst 60 tecken."),
  model: z.string().trim().min(1, "Ange bilmodell.").max(60, "Modellen får vara högst 60 tecken."),
  year: z.string().trim().min(1, "Ange årsmodell.").regex(/^\d{4}$/, "Skriv årsmodellen med fyra siffror.")
    .transform(Number)
    .pipe(z.number().int().min(1990, "Årsmodellen måste vara 1990 eller senare.").max(currentModelYear, `Årsmodellen kan inte vara senare än ${currentModelYear}.`)),
  engine: z.string().trim().min(1, "Ange motor eller bränsletyp.").max(60, "Uppgiften får vara högst 60 tecken."),
  gearbox: z.enum(["Manuell", "Automat", "Vet ej"], { error: "Välj växellåda." }),
  drivetrain: z.enum(["Framhjul", "Bakhjul", "Fyrhjul", "Vet ej"], { error: "Välj drivning." }),
  mileage: z.string().trim().refine((value) => value === "" || /^\d[\d\s]*$/.test(value), "Ange miltal med siffror.")
    .transform((value) => value === "" ? null : Number(value.replace(/\s/g, "")) * 10)
    .pipe(z.number().int().min(0, "Miltalet kan inte vara negativt.").max(2_000_000, "Miltalet får vara högst 200 000 mil.").nullable()),
  purchase_timing: purchaseTimingFormSchema,
}).transform((values) => ({
  make: values.make,
  model: values.model,
  year: values.year,
  engine: values.engine,
  gearbox: values.gearbox,
  drivetrain: values.drivetrain === "Framhjul" ? "Framhjulsdrift" as const
    : values.drivetrain === "Bakhjul" ? "Bakhjulsdrift" as const
      : values.drivetrain === "Fyrhjul" ? "Fyrhjulsdrift" as const
        : "Vet ej" as const,
  mileage_km: values.mileage,
  purchase_timing: values.purchase_timing,
}));

export type VehicleFormValues = z.input<typeof vehicleFormSchema>;
export type VehicleFormSubmission = z.output<typeof vehicleFormSchema>;

/**
 * Det underlag som skickas till backend. Samma schema valideras en gång till på
 * serversidan (reportRequestSchema i src/lib/report.ts), eftersom klientdata
 * aldrig är betrodd.
 */
export const vehicleSubmissionSchema = reportRequestSchema;
export type VehicleSubmission = z.infer<typeof vehicleSubmissionSchema>;

export const makeSuggestions = ["Volvo", "Toyota", "Volkswagen", "Kia", "Skoda", "BMW", "Audi"] as const;
export const modelSuggestions = ["Corolla", "Golf", "V60", "Octavia", "Ceed", "Modell X"] as const;
export const vehiclePurchaseLabels: Record<"within_month" | "later" | "curious", string> = {
  within_month: "Ja, inom en månad",
  later: "Senare",
  curious: "Bara nyfiken",
};

export const emptyVehicleForm: VehicleFormValues = {
  make: "",
  model: "",
  year: "",
  engine: "",
  gearbox: "Vet ej",
  drivetrain: "Vet ej",
  mileage: "",
  purchase_timing: "",
};

/** Explicit demo values are fictional and do not describe a real vehicle. */
export const exampleVehicleForm: VehicleFormValues = {
  make: "Exempelbil",
  model: "Modell X",
  year: "2020",
  engine: "Motor A / bränsletyp",
  gearbox: "Vet ej",
  drivetrain: "Vet ej",
  mileage: "8 500",
  purchase_timing: "curious",
};

export function vehicleFormErrors(error: z.ZodError): Partial<Record<keyof VehicleFormValues, string>> {
  const errors: Partial<Record<keyof VehicleFormValues, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in emptyVehicleForm && !errors[field as keyof VehicleFormValues]) {
      errors[field as keyof VehicleFormValues] = issue.message;
    }
  }
  return errors;
}

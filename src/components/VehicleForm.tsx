import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, CircleHelp } from "lucide-react";
import {
  emptyVehicleForm,
  makeSuggestions,
  modelSuggestions,
  vehicleFormErrors,
  vehicleFormSchema,
  vehiclePurchaseLabels,
  type VehicleFormValues,
  type VehicleSubmission,
} from "@/lib/vehicleForm";
import {
  isValidRegistrationNumber,
  normalizeRegistrationNumber,
  type VehicleLookupResponse,
  type VehicleSuggestion,
} from "@/lib/vehicleLookup";
import "./vehicle-form.css";

/** Det som skickas med utöver bilen: när ångerrätten godkändes. */
export type VehicleSubmitMeta = {
  consentAcceptedAt: number | null;
};

type VehicleFormProps = {
  onSubmit: (submission: VehicleSubmission, meta: VehicleSubmitMeta) => Promise<void> | void;
  isSubmitting?: boolean;
  /** Hämtar bilens uppgifter från registret. Utan den visas inte fältet. */
  onLookup?: (registrationNumber: string) => Promise<VehicleLookupResponse | null>;
  /** Skylt som redan skrivits på sidan, till exempel i hero-fältet. */
  registrationNumber?: string;
  /** Knappens text, till exempel "Köp rapport – 79 kr". */
  submitLabel?: string;
  /** Kräver att kunden godkänner att leveransen startar direkt. */
  requireConsent?: boolean;
  /** Ifyllda uppgifter att återställa, till exempel efter en avbruten betalning. */
  initialValues?: VehicleFormValues;
};

export function VehicleForm({
  onSubmit,
  isSubmitting = false,
  onLookup,
  registrationNumber,
  submitLabel = "Analysera bilen",
  requireConsent = false,
  initialValues,
}: VehicleFormProps) {
  const [values, setValues] = useState<VehicleFormValues>(emptyVehicleForm);
  const [errors, setErrors] = useState<Partial<Record<keyof VehicleFormValues, string>>>({});
  const [submitError, setSubmitError] = useState("");
  const id = useId();
  const idFor = (field: keyof VehicleFormValues) => `${id}-${field}`;
  const errorFor = (field: keyof VehicleFormValues) => errors[field] ? `${idFor(field)}-error` : undefined;
  const timingErrorId = `${id}-purchase-timing-error`;
  const [plate, setPlate] = useState(registrationNumber ?? "");
  const [lookup, setLookup] = useState<{ state: "idle" | "loading" | "found" | "none" | "error"; message: string }>({ state: "idle", message: "" });
  /* Bilen som registret svarade med, så att raden under skylten kan visa den. */
  const [matched, setMatched] = useState<VehicleSuggestion | null>(null);
  /* Standard är det korta formuläret: skylt, drivning och miltal. De fält som
     registret kan fylla i går att öppna manuellt med knappen under skylten. */
  const [showBasics, setShowBasics] = useState(() => Boolean(initialValues));
  const [consent, setConsent] = useState(false);
  /** Tiden då rutan kryssades i, inte då knappen trycktes. */
  const [consentAcceptedAt, setConsentAcceptedAt] = useState<number | null>(null);

  /* Skylten som skrevs i hero-fältet fylls i och slås upp direkt, så att man
     slipper skriva och hämta den igen. Tom skylt lämnar formuläret som det är.
     Ref-guarden hindrar att React StrictMode kör uppslaget två gånger. */
  /* Uppgifter som skickades iväg till betalning och kom tillbaka avbrutna. */
  useEffect(() => {
    if (initialValues) setValues(initialValues);
    // Bara vid montering: fälten ska inte skrivas över när kunden redigerar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoLookupDone = useRef<string | null>(null);
  useEffect(() => {
    if (!registrationNumber) return;
    setPlate(registrationNumber);
    setLookup({ state: "idle", message: "" });
    setMatched(null);
    setShowBasics(false);
    if (autoLookupDone.current === registrationNumber) return;
    autoLookupDone.current = registrationNumber;
    void lookupPlate(registrationNumber);
  }, [registrationNumber]);

  /**
   * Hämtar ett förslag på bilen från en webbsökning på registreringsnumret.
   * Uppgifterna är förslag: bara fält som går att fylla i sätts, och allt
   * valideras som vanligt när formuläret skickas.
   */
  async function handleLookup() {
    await lookupPlate(plate);
  }

  /** Slår upp en skylt som redan är känd, till exempel från hero-fältet. */
  async function lookupPlate(value: string) {
    if (!onLookup) return;
    const normalized = normalizeRegistrationNumber(value);
    if (!isValidRegistrationNumber(normalized)) {
      setMatched(null);
      setShowBasics(true);
      setLookup({ state: "error", message: "Skriv ett svenskt registreringsnummer, till exempel ABC123." });
      return;
    }
    setLookup({ state: "loading", message: "Söker efter bilen…" });
    try {
      const result = await onLookup(normalized);
      const suggestion = result?.suggestion ?? null;
      if (!suggestion?.found) {
        setMatched(null);
        setShowBasics(true);
        setLookup({
          state: "none",
          message: result?.notice ?? "Hittade ingen säker träff. Fyll i uppgifterna själv.",
        });
        return;
      }
      /* Registret är källan, så uppgifterna fylls i direkt. Drivning och miltal
         finns inte i Vägtrafikregistret och lämnas därför som de är. */
      setValues((current) => ({
        ...current,
        make: suggestion.make || current.make,
        model: suggestion.model || current.model,
        year: suggestion.year ? String(suggestion.year) : current.year,
        engine: suggestion.engine || current.engine,
        gearbox: suggestion.gearbox || current.gearbox,
      }));
      setErrors({});
      /* Fälten som registret fyllde i behövs inte längre: de döljs och
         ersätts av en kort rad med bilen. "Ändra" tar tillbaka dem. */
      setMatched(suggestion);
      setShowBasics(false);
      setLookup({
        state: "found",
        message: suggestion.source
          ? `Uppgifterna är hämtade från ${suggestion.source}. Drivning och miltal finns inte där – fyll i dem om du vet, annars går det bra som det är.`
          : "Uppgifterna är hämtade från registret. Drivning och miltal finns inte där – fyll i dem om du vet, annars går det bra som det är.",
      });
    } catch {
      setLookup({ state: "error", message: "Kunde inte hämta förslag just nu. Fyll i uppgifterna själv." });
    }
  }

  /* Det korta läget är standard; fälten visas när man väljer att fylla i bilen
     själv, eller automatiskt om ett obligatoriskt fält saknas vid inskickning. */
  const hideBasics = !showBasics;

  function update<K extends keyof VehicleFormValues>(field: K, value: VehicleFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = vehicleFormSchema.safeParse(values);
    if (!result.success) {
      const nextErrors = vehicleFormErrors(result.error);
      setErrors(nextErrors);
      setSubmitError("Kontrollera uppgifterna som är markerade nedan.");
      const basicFields = ["make", "model", "year", "engine", "gearbox"] as const;
      const basicError = basicFields.find((field) => nextErrors[field]);
      /* Ett fel i ett dolt fält går inte att rätta: visa fälten och fokusera det
         första som behöver fyllas i. */
      if (basicError) {
        setShowBasics(true);
        requestAnimationFrame(() => document.getElementById(idFor(basicError))?.focus());
        return;
      }
      const firstInvalid = (Object.keys(nextErrors) as Array<keyof VehicleFormValues>).find((field) => nextErrors[field]);
      if (firstInvalid === "purchase_timing") {
        document.querySelector<HTMLInputElement>(`input[name="${id}-purchase-timing"]`)?.focus();
      } else if (firstInvalid) {
        document.getElementById(idFor(firstInvalid))?.focus();
      }
      return;
    }

    setErrors({});
    setSubmitError("");
    try {
      await onSubmit(result.data, {
        consentAcceptedAt: requireConsent ? consentAcceptedAt : null,
      });
    } catch {
      setSubmitError("Det gick inte att skicka uppgifterna just nu. Försök igen.");
    }
  }

  function fieldClass(field: keyof VehicleFormValues) {
    return `vf-input${errors[field] ? " is-invalid" : ""}`;
  }

  function fieldProps(field: keyof VehicleFormValues) {
    return {
      id: idFor(field),
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": [errors[field] ? errorFor(field) : null, field === "mileage" ? `${idFor(field)}-hint` : null].filter(Boolean).join(" ") || undefined,
    };
  }

  return (
    <form className="vehicle-form" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
      <div className="vf-intro">
        <div>
          <p className="vf-eyebrow">Börja här <span className="vf-eyebrow__step">Steg 1 av 3</span></p>
          <h2 id={`${id}-title`}>Vilken bil funderar du på?</h2>
          <p className="vf-lede">Fyll i det du vet. Märke och modell är fritext – förslagen är bara hjälp på vägen.</p>
        </div>
        <span className="vf-intro-icon" aria-hidden="true"><CircleHelp size={21} /></span>
      </div>

      {onLookup && (
        <div className="vf-lookup">
          <label htmlFor={`${id}-plate`}>Registreringsnummer</label>
          <div className="vf-lookup__row">
            {/* Skylten ritas som en riktig svensk skylt: blå EU-remsa med S och
                svart ram runt ett monospace-fält. */}
            <div className="vf-plate">
              <span className="vf-plate__eu" aria-hidden="true">S</span>
                <input
                  id={`${id}-plate`}
                  className="vf-plate__input"
                  name="registration"
                  autoComplete="off"
                  maxLength={8}
                  placeholder="ABC 123"
                  value={plate}
                  onChange={(event) => {
                    setPlate(event.target.value);
                    /* Ny skylt = ny bil: glöm förra träffen, men behåll det korta läget. */
                    setMatched(null);
                    if (lookup.state !== "loading") setLookup({ state: "idle", message: "" });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleLookup();
                    }
                  }}
                />
            </div>
            <button
              type="button"
              className="vf-lookup__button"
              onClick={() => void handleLookup()}
              disabled={lookup.state === "loading"}
            >
              {lookup.state === "loading" ? "Söker…" : "Hämta förslag"}
            </button>
          </div>
          {!showBasics && !matched && (
            <button type="button" className="vf-manual" onClick={() => setShowBasics(true)}>
              Skriv in modellen manuellt
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          )}
          {matched && (
            <p className="vf-match">
              <Check size={13} strokeWidth={3} aria-hidden="true" />
              <span className="vf-match__name">
                {[matched.make, matched.model].filter(Boolean).join(" ")}
              </span>
              {[matched.year ? String(matched.year) : "", matched.engine, matched.gearbox === "Vet ej" ? "" : matched.gearbox]
                .filter(Boolean)
                .map((part) => (
                  <span key={part} className="vf-match__part">· {part}</span>
                ))}
              {!showBasics && (
                <button type="button" className="vf-match__change" onClick={() => setShowBasics(true)}>
                  Ändra
                </button>
              )}
            </p>
          )}
          <p className="vf-hint" aria-live="polite">
            {lookup.message || "Fyll i skylten och hämta – då fyller vi i märke, modell, år, motor, bränsle och växellåda. Drivning och miltal fyller du i själv om du vet."}
          </p>
        </div>
      )}

      <div className="vf-grid" aria-labelledby={`${id}-title`}>
        {!hideBasics && (
          <>
        <div className="vf-field">
          <label htmlFor={idFor("make")}>Märke <span aria-hidden="true">*</span></label>
          <input {...fieldProps("make")} className={fieldClass("make")} name="make" list="vehicle-make-options" autoComplete="off" maxLength={60} required value={values.make} onChange={(event) => update("make", event.target.value)} placeholder="Till exempel Volvo" />
          <datalist id="vehicle-make-options">{makeSuggestions.map((make) => <option key={make} value={make} />)}</datalist>
          {errors.make && <p className="vf-error" id={errorFor("make")}>{errors.make}</p>}
        </div>

        <div className="vf-field">
          <label htmlFor={idFor("model")}>Modell <span aria-hidden="true">*</span></label>
          <input {...fieldProps("model")} className={fieldClass("model")} name="model" list="vehicle-model-options" autoComplete="off" maxLength={60} required value={values.model} onChange={(event) => update("model", event.target.value)} placeholder="Till exempel V60" />
          <datalist id="vehicle-model-options">{modelSuggestions.map((model) => <option key={model} value={model} />)}</datalist>
          {errors.model && <p className="vf-error" id={errorFor("model")}>{errors.model}</p>}
        </div>

        <div className="vf-field">
          <label htmlFor={idFor("year")}>Årsmodell <span aria-hidden="true">*</span></label>
          <input {...fieldProps("year")} className={fieldClass("year")} name="year" type="number" inputMode="numeric" required min={1990} max={new Date().getFullYear()} step={1} value={values.year} onChange={(event) => update("year", event.target.value)} placeholder="Till exempel 2020" />
          {errors.year && <p className="vf-error" id={errorFor("year")}>{errors.year}</p>}
        </div>

        <div className="vf-field">
          <label htmlFor={idFor("engine")}>Motor / bränsle <span aria-hidden="true">*</span></label>
          <input {...fieldProps("engine")} className={fieldClass("engine")} name="engine" autoComplete="off" maxLength={60} required value={values.engine} onChange={(event) => update("engine", event.target.value)} placeholder="Till exempel 2.0 diesel, hybrid, el" />
          {errors.engine && <p className="vf-error" id={errorFor("engine")}>{errors.engine}</p>}
        </div>

        <div className="vf-field">
          <label htmlFor={idFor("gearbox")}>Växellåda <span aria-hidden="true">*</span></label>
          <select {...fieldProps("gearbox")} className={fieldClass("gearbox")} name="gearbox" required value={values.gearbox} onChange={(event) => update("gearbox", event.target.value as VehicleFormValues["gearbox"])}>
            <option value="">Välj växellåda</option><option>Manuell</option><option>Automat</option><option>Vet ej</option>
          </select>
          {errors.gearbox && <p className="vf-error" id={errorFor("gearbox")}>{errors.gearbox}</p>}
        </div>
          </>
        )}

        <div className="vf-field">
          <label htmlFor={idFor("drivetrain")}>Drivning <span>(valfritt)</span></label>
          <select {...fieldProps("drivetrain")} className={fieldClass("drivetrain")} name="drivetrain" required value={values.drivetrain} onChange={(event) => update("drivetrain", event.target.value as VehicleFormValues["drivetrain"])}>
            <option value="">Välj drivning</option><option value="Framhjul">Framhjul</option><option value="Bakhjul">Bakhjul</option><option value="Fyrhjul">Fyrhjul</option><option>Vet ej</option>
          </select>
          {errors.drivetrain && <p className="vf-error" id={errorFor("drivetrain")}>{errors.drivetrain}</p>}
        </div>

        <div className="vf-field vf-field--optional">
          <label htmlFor={idFor("mileage")}>Miltal <span>(valfritt)</span></label>
          <div className="vf-input-suffix">
            <input {...fieldProps("mileage")} className={fieldClass("mileage")} name="mileage" type="text" inputMode="numeric" autoComplete="off" value={values.mileage} onChange={(event) => update("mileage", event.target.value)} placeholder="Till exempel 8 500" />
            <span>mil</span>
          </div>
          <p className="vf-hint" id={`${idFor("mileage")}-hint`}>Ungefärligt miltal räcker.</p>
          {errors.mileage && <p className="vf-error" id={errorFor("mileage")}>{errors.mileage}</p>}
        </div>

        <fieldset className="vf-field vf-field--timing" aria-describedby={errors.purchase_timing ? timingErrorId : undefined}>
          <legend>Är du på väg att köpa den här bilen? <span>(valfritt)</span></legend>
          <div className="vf-radio-options">
            {Object.entries(vehiclePurchaseLabels).map(([value, label]) => (
              <label className="vf-radio" key={value}>
                <input type="radio" name={`${id}-purchase-timing`} value={value} checked={values.purchase_timing === value} onChange={() => update("purchase_timing", value as VehicleFormValues["purchase_timing"])} />
                <span className="vf-radio__mark" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                <span>{label}</span>
              </label>
            ))}
          </div>
          {errors.purchase_timing && <p className="vf-error" id={timingErrorId}>{errors.purchase_timing}</p>}
        </fieldset>
      </div>

      {requireConsent && (
        <label className="vf-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              setConsentAcceptedAt(event.target.checked ? Date.now() : null);
            }}
            required
          />
          <span>Jag godkänner att leveransen startar direkt och att jag därmed förlorar ångerrätten.</span>
        </label>
      )}

      <div className="vf-submit-row">
        <div className="vf-submit-copy">
          {submitError && <p className="vf-form-error" role="alert">{submitError}</p>}
          {!submitError && <p>Uppgifterna används för att ta fram en rapport som bygger på publicerade källor.</p>}
        </div>
        <button className="vf-submit" type="submit" disabled={isSubmitting || (requireConsent && !consent)}>
          <span>{isSubmitting ? "Skickar uppgifter…" : submitLabel}</span>
          {!isSubmitting && <ArrowRight size={17} aria-hidden="true" />}
          {isSubmitting && <span className="vf-spinner" aria-hidden="true" />}
        </button>
      </div>
    </form>
  );
}

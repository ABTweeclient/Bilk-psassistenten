import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Genererade Bilköpsrapporter. En post skapas direkt med status
    // "resolving_variant" så att gränssnittet kan visa verkliga steg, och
    // fylls på med rapport + generation_meta när pipelinen är klar.
    // Ingen ip-härledd ägaruppgift sparas längre: ownerKey togs bort eftersom
    // den aldrig lästes och var personligt identifierbar.
    vehicleReports: defineTable({
      reportId: v.string(),
      cacheKey: v.string(),
      vehicle: v.any(),
      status: v.string(),
      reviewStatus: v.string(),
      report: v.optional(v.any()),
      generationMeta: v.optional(v.any()),
      failureReason: v.optional(v.string()),
      // Felspåret för en misslyckad körning: kategori, HTTP-status och feltext
      // (utan nycklar), kvalitetskontrollernas anmärkningar, antal försök, varje
      // försöks sökningar/token/kostnad och modellens råsvar kortat till 2000
      // tecken. Se src/lib/reportFailure.ts. Lämnas aldrig ut publikt.
      failure: v.optional(v.any()),
      statusLog: v.array(v.object({ status: v.string(), at: v.number() })),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_report_id", ["reportId"])
      .index("by_cache_key", ["cacheKey"])
      .index("by_status", ["status"])
      .index("by_review_status", ["reviewStatus"])
      .index("by_created_at", ["createdAt"]),

    // Rate limiting per nyckel (hashad ip eller session) i ett rullande
    // timfönster. windowStart används också för att gallra bort gamla nycklar:
    // en nyckel som inte använts på RATE_LIMIT_RETENTION raderas automatiskt.
    reportUsage: defineTable({ key: v.string(), windowStart: v.number(), count: v.number() })
      .index("by_key", ["key"])
      .index("by_window_start", ["windowStart"]),

    // Globalt dygnstak för antalet genererade rapporter (DAILY_REPORT_CAP).
    reportDailyUsage: defineTable({ day: v.string(), count: v.number() }).index("by_day", ["day"]),

    // Flaggningar från användare på en rapport, underlag för /admin.
    reportFlags: defineTable({
      reportId: v.string(),
      kind: v.string(),
      message: v.string(),
      createdAt: v.number(),
      resolved: v.boolean(),
    })
      .index("by_report_id", ["reportId"])
      .index("by_created_at", ["createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;

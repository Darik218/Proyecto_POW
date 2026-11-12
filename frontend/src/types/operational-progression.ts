import type { z } from "zod";
import type {
  operationalStatusSchema,
  operationalReceiptSchema,
  automaticHistorySchema,
  automaticApplicationSchema,
  activationSchema,
  operationalRevocationSchema,
} from "../schemas/operational-progression.schema";
export type OperationalStatus = z.infer<typeof operationalStatusSchema>;
export type OperationalReceipt = z.infer<typeof operationalReceiptSchema>;
export type AutomaticHistory = z.infer<typeof automaticHistorySchema>;
export type AutomaticApplication = z.infer<typeof automaticApplicationSchema>;
export type OperationalActivation = z.infer<typeof activationSchema>;
export type OperationalRevocation = z.infer<typeof operationalRevocationSchema>;

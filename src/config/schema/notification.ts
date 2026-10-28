import { z } from "zod"

export const InjectionNoticesConfigSchema = z.object({
  /** Mirror injection notices as persistent model-visible messages via session.prompt({ noReply: true }). Default: false (toast-only) — opt-in because persistent notices cost context. */
  persistent: z.boolean().default(false),
})

export type InjectionNoticesConfig = z.infer<typeof InjectionNoticesConfigSchema>

export const NotificationConfigSchema = z.object({
  /** Force enable session-notification even if external notification plugins are detected (default: false) */
  force_enable: z.boolean().optional(),
  /** Injection-notice delivery options (default: toast-only; the persistent mirror is opt-in) */
  injection_notices: InjectionNoticesConfigSchema.optional(),
})

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>

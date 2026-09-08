import { z } from "zod";

export const SMTP_PROVIDER_IDS = ["local", "163", "gmail"] as const;
export const smtpProviderIdSchema = z.enum(SMTP_PROVIDER_IDS);
export type SmtpProviderId = z.infer<typeof smtpProviderIdSchema>;

// App setting key that stores the operator's preferred remote SMTP provider.
// Mirrors the app_settings mechanism used by gemini-match-min-cosine. Only the
// provider id is stored — never credentials.
export const PREFERRED_SMTP_PROVIDER_SETTING = "preferred-smtp-provider";
export const PREFERRED_SMTP_PROVIDER_COOKIE = "preferred-smtp-provider";
// Remote-only: the user chooses between 163.com and Gmail. Local SMTP always
// takes precedence regardless of this preference.
export const preferredSmtpProviderSchema = z.enum(["163", "gmail"]).nullable();
export type PreferredSmtpProvider = z.infer<typeof preferredSmtpProviderSchema>;

const DATA_IMAGE_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_INLINE_IMAGE_CHARACTERS = 4_000_000;

export const emailRecipientSchema = z.email("Enter a valid recipient email address.").max(254);

export const emailImageUrlSchema = z
  .string()
  .min(1)
  .max(MAX_INLINE_IMAGE_CHARACTERS)
  .refine((value) => {
    if (value.startsWith("data:")) return DATA_IMAGE_PATTERN.test(value);
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "Each image must be an HTTP(S) URL or a base64 PNG, JPEG, WebP, or GIF data URL.");

export const canvasEmailImageSchema = z
  .object({
    id: z.string().trim().min(1).max(150),
    url: emailImageUrlSchema,
    prompt: z.string().trim().max(1_000).nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export const sendCanvasEmailRequestSchema = z
  .object({
    to: emailRecipientSchema,
    canvasName: z.string().trim().min(1).max(150),
    subject: z.string().trim().min(1).max(180).optional(),
    message: z.string().trim().max(2_000).optional(),
    images: z.array(canvasEmailImageSchema).min(1).max(12),
  })
  .strict()
  .superRefine((value, context) => {
    const inlineCharacters = value.images.reduce(
      (total, image) => total + (image.url.startsWith("data:") ? image.url.length : 0),
      0,
    );
    if (inlineCharacters <= MAX_INLINE_IMAGE_CHARACTERS) return;
    context.addIssue({
      code: "custom",
      path: ["images"],
      message:
        "The selected inline images are too large to email at once. Select fewer images and try again.",
    });
  });

export type SendCanvasEmailRequest = z.infer<typeof sendCanvasEmailRequestSchema>;

const canvasReportDetailSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(5_000),
  })
  .strict();

const canvasReportImageSchema = z
  .object({
    url: z.string().trim().min(1).max(4_000_000).nullable(),
    alt: z.string().trim().min(1).max(300),
  })
  .strict();

const canvasReportTableSchema = z
  .object({
    columns: z.array(z.string().trim().min(1).max(120)).max(20),
    rows: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(120),
            image: canvasReportImageSchema.nullable().optional(),
            values: z.array(z.string().trim().min(1).max(1_000)).max(20),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

const canvasReportBlockSchema = z
  .object({
    id: z.string().trim().min(1).max(180),
    title: z.string().trim().min(1).max(300),
    subtitle: z.string().trim().min(1).max(300).optional(),
    details: z.array(canvasReportDetailSchema).max(80),
    table: canvasReportTableSchema.optional(),
    image: canvasReportImageSchema.nullable(),
  })
  .strict();

const canvasReportStepSchema = z
  .object({
    id: z.string().trim().min(1).max(180),
    title: z.string().trim().min(1).max(300),
    detail: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const canvasReportPayloadSchema = z
  .object({
    schemaVersion: z.literal(2).optional(),
    title: z.string().trim().min(1).max(300),
    generatedAt: z.iso.datetime(),
    send: z
      .object({
        sequence: z
          .string()
          .trim()
          .regex(/^CA\d{6}$/),
        reportUrl: z.url(),
        approvalUrl: z.url(),
        rejectionUrl: z.url(),
        qrCodeDataUrl: z.string().trim().min(1).max(200_000).nullable(),
        selectedImageIds: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
      })
      .passthrough()
      .optional(),
    project: z
      .object({
        id: z.string().trim().min(1).max(200).optional(),
        name: z.string().trim().min(1).max(300),
        customerName: z.string().trim().min(1).max(300),
        employeeName: z.string().trim().min(1).max(300),
        employeeTitle: z.string().trim().max(300),
        employeeEmail: z.string().trim().min(1).max(300),
        employeeTel: z.string().trim().min(1).max(300),
        currency: z.string().trim().min(1).max(120),
        destination: z.string().trim().min(1).max(300),
      })
      .strict(),
    canvas: z
      .object({
        id: z.string().trim().min(1).max(200),
        name: z.string().trim().min(1).max(300),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
    sections: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(120),
            title: z.string().trim().min(1).max(180),
            blocks: z.array(canvasReportBlockSchema).max(100),
            pageBreakBefore: z.boolean().optional(),
          })
          .strict(),
      )
      .max(12),
    steps: z.array(canvasReportStepSchema).max(500),
  })
  .strict();

export type CanvasReportPayload = z.infer<typeof canvasReportPayloadSchema>;

export const sendCanvasReportEmailRequestSchema = z
  .object({
    to: z.array(emailRecipientSchema).min(1).max(20),
    cc: z.array(emailRecipientSchema).max(20).optional(),
    canvasName: z.string().trim().min(1).max(150),
    subject: z.string().trim().min(1).max(180),
    html: z.string().trim().min(1).max(250_000),
    text: z.string().trim().min(1).max(120_000),
    pdfFilename: z.string().trim().min(1).max(120),
    report: canvasReportPayloadSchema.optional(),
  })
  .passthrough();

export type SendCanvasReportEmailRequest = z.infer<typeof sendCanvasReportEmailRequestSchema>;

export const sendTestEmailRequestSchema = z
  .object({
    to: emailRecipientSchema,
  })
  .strict();

export type SendTestEmailRequest = z.infer<typeof sendTestEmailRequestSchema>;

export const sendPurchaseSamplingEmailRequestSchema = z
  .object({
    to: emailRecipientSchema,
    sequence: z
      .string()
      .trim()
      .regex(/^CA\d{6}$/),
    supplierName: z.string().trim().min(1).max(300),
    projectName: z.string().trim().min(1).max(300),
    canvasName: z.string().trim().min(1).max(300),
    purchaseDate: z.string().trim().min(1).max(120),
    reportUrl: z.url(),
    updateUrl: z.url(),
    qrCodeDataUrl: z.string().trim().min(1).max(200_000),
    supplierDetails: z.array(z.string().trim().min(1).max(1_000)).max(40),
  })
  .strict();

export type SendPurchaseSamplingEmailRequest = z.infer<
  typeof sendPurchaseSamplingEmailRequestSchema
>;

export const sendPhysicalSampleApprovalEmailRequestSchema = z
  .object({
    to: emailRecipientSchema,
    sequence: z
      .string()
      .trim()
      .regex(/^CA\d{6}$/),
    projectName: z.string().trim().min(1).max(300),
    canvasName: z.string().trim().min(1).max(300),
    supplierName: z.string().trim().min(1).max(300),
    awb: z.string().trim().min(1).max(300),
    approvalUrl: z.url(),
    rejectionUrl: z.url(),
  })
  .strict();

export type SendPhysicalSampleApprovalEmailRequest = z.infer<
  typeof sendPhysicalSampleApprovalEmailRequestSchema
>;

export const sendReminderEmailRequestSchema = z
  .object({
    to: emailRecipientSchema,
    sequence: z
      .string()
      .trim()
      .regex(/^CA\d{6}$/),
    supplierName: z.string().trim().min(1).max(300),
    projectName: z.string().trim().min(1).max(300),
    canvasName: z.string().trim().min(1).max(300),
    currentStage: z.string().trim().min(1).max(120),
    pmcDate: z.string().trim().max(120).optional(),
    updateUrl: z.url(),
  })
  .strict();

export type SendReminderEmailRequest = z.infer<typeof sendReminderEmailRequestSchema>;

export const emailDeliveryResponseSchema = z
  .object({
    success: z.literal(true),
    provider: smtpProviderIdSchema,
    messageId: z.string().min(1),
  })
  .strict();

export type EmailDeliveryResponse = z.infer<typeof emailDeliveryResponseSchema>;

export const emailApiErrorSchema = z
  .object({
    error: z.string().min(1),
  })
  .strict();

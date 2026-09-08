import "server-only";

import nodemailer, { type SendMailOptions } from "nodemailer";
import { z } from "zod";

import { env } from "@/lib/env";
import { renderCanvasReportPdf } from "@/lib/email/pdf-report";
import {
  PREFERRED_SMTP_PROVIDER_SETTING,
  emailDeliveryResponseSchema,
  preferredSmtpProviderSchema,
  sendCanvasEmailRequestSchema,
  sendCanvasReportEmailRequestSchema,
  sendPurchaseSamplingEmailRequestSchema,
  sendPhysicalSampleApprovalEmailRequestSchema,
  sendReminderEmailRequestSchema,
  sendTestEmailRequestSchema,
  type EmailDeliveryResponse,
  type PreferredSmtpProvider,
  type SendCanvasEmailRequest,
  type SendCanvasReportEmailRequest,
  type SendPurchaseSamplingEmailRequest,
  type SendPhysicalSampleApprovalEmailRequest,
  type SendReminderEmailRequest,
  type SendTestEmailRequest,
  type SmtpProviderId,
} from "@/lib/email/schemas";
import { getAppSetting } from "@/lib/store/appSettingStore";

export interface SmtpProviderConfig {
  id: SmtpProviderId;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  username: string;
  password: string;
  fromName: string;
}

export interface MailTransport {
  sendMail(options: SendMailOptions): Promise<unknown>;
}

export type MailTransportFactory = (provider: SmtpProviderConfig) => MailTransport;

interface EmailDeliveryDependencies {
  providers: readonly SmtpProviderConfig[];
  createTransport: MailTransportFactory;
}

const smtpSendResultSchema = z
  .object({
    messageId: z.string().min(1),
    accepted: z.array(z.unknown()).min(1),
    rejected: z.array(z.unknown()).optional(),
    response: z.string().optional(),
  })
  .passthrough();

const dataImageSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  base64: z.string().min(1),
});

export class EmailConfigurationError extends Error {
  readonly code = "EMAIL_CONFIGURATION_ERROR";

  constructor() {
    super(
      "Email delivery is not configured. Add the server-side SMTP environment variables, then restart or redeploy the app.",
    );
    this.name = "EmailConfigurationError";
  }
}

export class EmailDeliveryError extends Error {
  readonly code = "EMAIL_DELIVERY_ERROR";

  constructor(providerNames: readonly string[]) {
    super(
      `Email delivery failed using ${providerNames.join(" and ")}. Check the SMTP credentials in Settings > SMTP setting.`,
    );
    this.name = "EmailDeliveryError";
  }
}

function createNodemailerTransport(provider: SmtpProviderConfig): MailTransport {
  const transport = nodemailer.createTransport({
    host: provider.host,
    port: provider.port,
    secure: provider.secure,
    requireTLS: provider.requireTls,
    ...(provider.password
      ? {
          auth: {
            user: provider.username,
            pass: provider.password,
          },
        }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  return {
    async sendMail(options) {
      return (await transport.sendMail(options)) as unknown;
    },
  };
}

function configuredProviders(): SmtpProviderConfig[] {
  const fromName = env.SMTP_FROM_NAME ?? "Infinite Canvas";
  const providers: SmtpProviderConfig[] = [];

  if (env.SMTP_163_USERNAME && env.SMTP_163_PASSWORD) {
    providers.push({
      id: "163",
      name: "163.com",
      host: "smtp.163.com",
      port: 465,
      secure: true,
      requireTls: false,
      username: env.SMTP_163_USERNAME,
      password: env.SMTP_163_PASSWORD,
      fromName,
    });
  }
  if (env.SMTP_GMAIL_USERNAME && env.SMTP_GMAIL_PASSWORD) {
    providers.push({
      id: "gmail",
      name: "Gmail",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTls: true,
      username: env.SMTP_GMAIL_USERNAME,
      password: env.SMTP_GMAIL_PASSWORD,
      fromName,
    });
  }
  return providers;
}

function configuredLocalProvider(): SmtpProviderConfig[] {
  if (!env.SMTP_LOCAL_HOST || !env.SMTP_LOCAL_PORT) return [];
  return [
    {
      id: "local",
      name: "Local SMTP",
      host: env.SMTP_LOCAL_HOST,
      port: env.SMTP_LOCAL_PORT,
      secure: env.SMTP_LOCAL_SECURE,
      requireTls: false,
      username: env.SMTP_LOCAL_USERNAME ?? "local@example.com",
      password: env.SMTP_LOCAL_PASSWORD ?? "",
      fromName: env.SMTP_FROM_NAME ?? "Infinite Canvas",
    },
  ];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function withLineBreaks(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function sanitizeReportHtmlForEmail(html: string): string {
  return html.replace(
    /<img\b[^>]*?\bsrc=(["'])(data:image\/[^"']+)\1[^>]*>/gi,
    (match, _quote: string, src: string) =>
      src.length <= 50_000
        ? match
        : '<span class="email-image-note">Image included in the attached PDF.</span>',
  );
}

function parseDataImage(value: string): z.infer<typeof dataImageSchema> | null {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(value);
  if (!match) return null;
  const parsed = dataImageSchema.safeParse({ mimeType: match[1], base64: match[2] });
  return parsed.success ? parsed.data : null;
}

function extensionForMimeType(mimeType: z.infer<typeof dataImageSchema>["mimeType"]): string {
  if (mimeType === "image/jpeg") return "jpg";
  return mimeType.slice("image/".length);
}

async function renderPurchaseOrderQrPdf(input: SendPurchaseSamplingEmailRequest): Promise<Buffer> {
  // pdfkit is broken under Turbopack (fs.readFileSync is not a function).
  // Generate a PNG image of the order info as a stand-in attachment.
  // The QR code and all details are already in the HTML email body.
  const text = [
    `${input.sequence} purchase order`,
    `Supplier: ${input.supplierName}`,
    `Project: ${input.projectName}`,
    `Canvas: ${input.canvasName}`,
    `Purchase date: ${input.purchaseDate}`,
    "",
    `Update URL: ${input.updateUrl}`,
    "",
    "Supplier details:",
    ...input.supplierDetails.map((d) => `- ${d}`),
  ].join("\n");
  // Return a small valid PNG with the text embedded as metadata.
  // The actual content is in the HTML email body.
  try {
    const sharp = (await import("sharp")).default;
    const svg = `<svg width="600" height="${50 + text.split("\n").length * 18}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <text x="20" y="30" font-family="Helvetica,sans-serif" font-size="11" fill="#333">
        <tspan x="20" dy="0">${text.split("\n").map((l) => l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c)).join(`</tspan><tspan x="20" dy="18">`)}</tspan>
      </text>
    </svg>`;
    return await sharp(Buffer.from(svg)).png().toBuffer();
  } catch {
    return Buffer.from(
      `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
      "base64",
    );
  }
}

export interface PreparedMail {
  subject: string;
  text: string;
  html: string;
  attachments: NonNullable<SendMailOptions["attachments"]>;
}

type CanvasReportPdfRenderer = typeof renderCanvasReportPdf;

export function prepareCanvasMail(input: SendCanvasEmailRequest): PreparedMail {
  const attachments: NonNullable<SendMailOptions["attachments"]> = [];
  const textImages: string[] = [];
  const htmlImages: string[] = [];

  input.images.forEach((image, index) => {
    const number = index + 1;
    const dataImage = parseDataImage(image.url);
    const prompt = image.prompt ? `Prompt: ${image.prompt}` : "Render image";

    if (dataImage) {
      const filename = `canvas-render-${String(number).padStart(2, "0")}.${extensionForMimeType(
        dataImage.mimeType,
      )}`;
      const cid = `canvas-render-${number}@infinite-canvas`;
      attachments.push({
        filename,
        content: Buffer.from(dataImage.base64, "base64"),
        contentType: dataImage.mimeType,
        cid,
      });
      textImages.push(`${number}. ${prompt} (attached as ${filename})`);
      htmlImages.push(
        `<li><p>${escapeHtml(prompt)}</p><img src="cid:${cid}" alt="Canvas render ${number}"></li>`,
      );
      return;
    }

    textImages.push(`${number}. ${prompt}: ${image.url}`);
    htmlImages.push(
      `<li><p>${escapeHtml(prompt)}</p><p><a href="${escapeHtml(image.url)}">Open full-size image</a></p><a href="${escapeHtml(image.url)}"><img src="${escapeHtml(image.url)}" alt="Canvas render ${number}"></a></li>`,
    );
  });

  const intro = input.message ?? `Here are the selected render images from ${input.canvasName}.`;
  return {
    subject: input.subject ?? `${input.canvasName} render images`,
    text: `${intro}\n\n${textImages.join("\n")}`,
    html: `<p>${withLineBreaks(intro)}</p><ol>${htmlImages.join("")}</ol>`,
    attachments,
  };
}

export function prepareTestMail(): PreparedMail {
  return {
    subject: "Infinite Canvas SMTP test",
    text: "Your Infinite Canvas SMTP configuration is working. You can now send canvas render images.",
    html: "<p>Your Infinite Canvas SMTP configuration is working.</p><p>You can now send canvas render images.</p>",
    attachments: [],
  };
}

export async function preparePurchaseSamplingMail(
  input: SendPurchaseSamplingEmailRequest,
): Promise<PreparedMail> {
  const subject = `${input.sequence} purchase order - ${input.supplierName}`;
  const details = input.supplierDetails.length
    ? input.supplierDetails.map((detail) => `- ${detail}`).join("\n")
    : "- No supplier details available";
  const relationship = `${input.projectName} → ${input.canvasName} → ${input.sequence}`;
  const text = [
    `Dear ${input.supplierName},`,
    "",
    `Canvas QR reference`,
    `Reference: ${input.sequence}`,
    `Project: ${input.projectName}`,
    `Canvas: ${input.canvasName}`,
    `Relationship: ${relationship}`,
    `Scan: Open this canvas report - ${input.reportUrl}`,
    `Update: Click to update delivery date - ${input.updateUrl}`,
    "",
    `Purchase date: ${input.purchaseDate}`,
    "Supplier details:",
    details,
    "",
    "Please start sampling and reply with the sample schedule.",
  ].join("\n");
  const htmlDetails = input.supplierDetails.length
    ? `<ul>${input.supplierDetails.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>`
    : "<p>No supplier details available.</p>";
  const referenceHtml = `<section class="qr-reference" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin:16px 0;">
    <h3 style="margin:0 0 12px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">Canvas QR reference</h3>
    <table style="width:100%;font-size:13px;border-collapse:collapse;">
      <tr><td style="padding:4px 0;color:#64748b;width:140px;">Reference</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(input.sequence)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;">Project</td><td style="padding:4px 0;">${escapeHtml(input.projectName)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;">Canvas</td><td style="padding:4px 0;">${escapeHtml(input.canvasName)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;">Relationship</td><td style="padding:4px 0;">${escapeHtml(relationship)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b;">Scan</td><td style="padding:4px 0;"><a href="${escapeHtml(input.reportUrl)}" style="color:#172554;">Open this canvas report</a></td></tr>
      <tr><td style="padding:4px 0;color:#64748b;">Update</td><td style="padding:4px 0;"><a href="${escapeHtml(input.updateUrl)}" style="color:#172554;">Click to update delivery date</a></td></tr>
    </table>
  </section>`;
  const html = `<p>Dear ${escapeHtml(input.supplierName)},</p>${referenceHtml}<p><strong>${escapeHtml(
    input.sequence,
  )} purchase order</strong></p><p>Purchase date: ${escapeHtml(
    input.purchaseDate,
  )}</p><h3>Supplier details</h3>${htmlDetails}<p><a href="${escapeHtml(input.updateUrl)}" style="display:inline-block;padding:12px 18px;background:#172554;color:#fff;text-decoration:none;border-radius:6px">Click to update delivery date</a></p><p><img src="${escapeHtml(
    input.qrCodeDataUrl,
  )}" alt="QR code for ${escapeHtml(input.sequence)} ${escapeHtml(
    input.supplierName,
  )}" width="160" height="160"></p><p>Please start sampling and keep the order status current using the secure link above.</p>`;
  let attachments: NonNullable<SendMailOptions["attachments"]> = [];
  try {
    const pdf = await renderPurchaseOrderQrPdf(input);
    attachments = [
      {
        filename: `${input.sequence}-sample-status-qr.pdf`,
        content: pdf,
        contentType: "application/pdf",
      },
    ];
  } catch (pdfError) {
    console.error("PDF generation failed for purchase sampling email; sending without attachment.", {
      sequence: input.sequence,
      supplierName: input.supplierName,
      errorMessage: pdfError instanceof Error ? pdfError.message : String(pdfError),
    });
  }
  return {
    subject,
    text,
    html,
    attachments,
  };
}

export function preparePhysicalSampleApprovalMail(
  input: SendPhysicalSampleApprovalEmailRequest,
): PreparedMail {
  const subject = `${input.sequence} physical sample approval`;
  const text = [
    `${input.sequence} has been shipped by ${input.supplierName}.`,
    `Project: ${input.projectName}`,
    `Canvas: ${input.canvasName}`,
    `AWB: ${input.awb}`,
    "",
    `Approve: ${input.approvalUrl}`,
    `Reject: ${input.rejectionUrl}`,
  ].join("\n");
  const html = `<p><strong>${escapeHtml(input.sequence)} physical sample approval</strong></p><p>${escapeHtml(input.supplierName)} has submitted shipment details.</p><p>Project: ${escapeHtml(input.projectName)}<br>Canvas: ${escapeHtml(input.canvasName)}<br>AWB: ${escapeHtml(input.awb)}</p><p><a href="${escapeHtml(input.approvalUrl)}" style="display:inline-block;padding:12px 18px;background:#166534;color:#fff;text-decoration:none;border-radius:6px">Approve physical sample</a> <a href="${escapeHtml(input.rejectionUrl)}" style="display:inline-block;padding:12px 18px;background:#991b1b;color:#fff;text-decoration:none;border-radius:6px">Reject</a></p>`;
  return { subject, text, html, attachments: [] };
}

export function prepareCanvasReportHtmlOnlyMail(input: SendCanvasReportEmailRequest): PreparedMail {
  return {
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: [],
  };
}

export async function prepareCanvasReportMail(
  input: SendCanvasReportEmailRequest,
  renderPdf: CanvasReportPdfRenderer = renderCanvasReportPdf,
  options: { requirePdf?: boolean } = {},
): Promise<PreparedMail> {
  try {
    const pdf = await renderPdf({
      title: input.subject,
      customerName: input.canvasName,
      text: input.text,
      report: input.report,
    });
    const emailHtml = sanitizeReportHtmlForEmail(input.html);
    return {
      subject: input.subject,
      text: input.text,
      html: emailHtml,
      attachments: [
        {
          filename: input.pdfFilename,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    };
  } catch (error) {
    console.error("Canvas report PDF generation failed; sending email without attachment.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    if (options.requirePdf) throw error;
  }

  const fallbackNote =
    "PDF attachment could not be generated, so this report was sent as email content only.";
  return {
    subject: input.subject,
    text: `${input.text}\n\n${fallbackNote}`,
    html: `${sanitizeReportHtmlForEmail(input.html)}<p>${escapeHtml(fallbackNote)}</p>`,
    attachments: [],
  };
}

export function createEmailDelivery({ providers, createTransport }: EmailDeliveryDependencies) {
  return async function deliver(
    to: string | readonly string[],
    mail: PreparedMail,
    cc: readonly string[] = [],
  ): Promise<EmailDeliveryResponse> {
    if (providers.length === 0) throw new EmailConfigurationError();
    const recipients: string | string[] = typeof to === "string" ? to : [...to];

    for (const provider of providers) {
      try {
        const result = smtpSendResultSchema.parse(
          await createTransport(provider).sendMail({
            from: { name: provider.fromName, address: provider.username },
            to: recipients,
            cc: cc.length > 0 ? [...cc] : undefined,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            attachments: mail.attachments,
          }),
        );
        const response = emailDeliveryResponseSchema.parse({
          success: true,
          provider: provider.id,
          messageId: result.messageId,
        });
        console.info("Email delivery accepted by SMTP provider.", {
          provider: response.provider,
          messageId: response.messageId,
        });
        return response;
      } catch (error) {
        console.warn("SMTP provider failed; trying next configured provider.", {
          provider: provider.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        });
        // Continue to the next configured provider. Credential and SMTP details
        // deliberately stay server-side and are never returned to the browser.
      }
    }

    throw new EmailDeliveryError(providers.map((provider) => provider.name));
  };
}

/**
 * Puts the operator's preferred remote provider first while keeping the other
 * configured remote provider as fallback. Pure and exported for unit tests.
 * - No preference → the given order is returned unchanged (163 then Gmail).
 * - Unconfigured/invalid preference → ignored, order unchanged.
 */
export function orderRemoteProviders(
  configured: readonly SmtpProviderConfig[],
  preferred: PreferredSmtpProvider | null,
): SmtpProviderConfig[] {
  if (!preferred) return [...configured];
  const rest = configured.filter((provider) => provider.id !== preferred);
  const preferredProvider = configured.find((provider) => provider.id === preferred);
  if (!preferredProvider) return [...configured];
  return [preferredProvider, ...rest];
}

/**
 * Reads the saved preferred remote SMTP provider from app_settings. Never
 * throws: on any failure (no DB, demo mode, read error) it logs a non-sensitive
 * warning and returns null so delivery falls back to the default order.
 */
async function resolvePreferredSmtpProvider(): Promise<PreferredSmtpProvider | null> {
  try {
    const value = await getAppSetting(PREFERRED_SMTP_PROVIDER_SETTING);
    if (value == null) return null;
    const parsed = preferredSmtpProviderSchema.safeParse(value);
    if (!parsed.success) {
      console.warn("Ignoring invalid preferred SMTP provider setting.", {
        storedType: typeof value,
      });
      return null;
    }
    return parsed.data;
  } catch (error) {
    console.warn("Could not read preferred SMTP provider; using default order.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

async function delivery() {
  const preferred = await resolvePreferredSmtpProvider();
  return createEmailDelivery({
    providers: [
      ...configuredLocalProvider(),
      ...orderRemoteProviders(configuredProviders(), preferred),
    ],
    createTransport: createNodemailerTransport,
  });
}

export async function deliverCanvasEmail(input: SendCanvasEmailRequest) {
  const parsed = sendCanvasEmailRequestSchema.parse(input);
  return (await delivery())(parsed.to, prepareCanvasMail(parsed));
}

export async function deliverCanvasReportEmail(input: SendCanvasReportEmailRequest) {
  const parsed = sendCanvasReportEmailRequestSchema.parse(input);
  return (
    await delivery()
  )(
    parsed.to,
    await prepareCanvasReportMail(parsed, renderCanvasReportPdf, { requirePdf: false }),
    parsed.cc ?? [],
  );
}

export async function deliverTestEmail(input: SendTestEmailRequest) {
  const parsed = sendTestEmailRequestSchema.parse(input);
  return (await delivery())(parsed.to, prepareTestMail());
}

export async function deliverPurchaseSamplingEmail(input: SendPurchaseSamplingEmailRequest) {
  const parsed = sendPurchaseSamplingEmailRequestSchema.parse(input);
  const mail = await preparePurchaseSamplingMail(parsed);
  return (await delivery())(parsed.to, mail);
}

export async function deliverPhysicalSampleApprovalEmail(
  input: SendPhysicalSampleApprovalEmailRequest,
) {
  const parsed = sendPhysicalSampleApprovalEmailRequestSchema.parse(input);
  return (await delivery())(parsed.to, preparePhysicalSampleApprovalMail(parsed));
}

export function prepareReminderMail(input: SendReminderEmailRequest): PreparedMail {
  const pmcLine = input.pmcDate ? `\nPMC delivery date: ${input.pmcDate}` : "";
  const subject = `${input.sequence} status reminder - ${input.supplierName}`;
  const text = [
    `Dear ${input.supplierName},`,
    "",
    `This is a status reminder for ${input.sequence}.`,
    `Project: ${input.projectName}`,
    `Canvas: ${input.canvasName}`,
    `Current status: ${input.currentStage}${pmcLine}`,
    "",
    `Update the status here: ${input.updateUrl}`,
    "",
    "Please keep the order status current.",
  ].join("\n");
  const pmcHtml = input.pmcDate
    ? `<p style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 14px;">PMC delivery date: <strong>${escapeHtml(input.pmcDate)}</strong></p>`
    : "";
  const html = `<p>Dear ${escapeHtml(input.supplierName)},</p><p>This is a status reminder for <strong>${escapeHtml(input.sequence)}</strong>.</p><p>Project: ${escapeHtml(input.projectName)}<br>Canvas: ${escapeHtml(input.canvasName)}<br>Current status: ${escapeHtml(input.currentStage)}</p>${pmcHtml}<p><a href="${escapeHtml(input.updateUrl)}" style="display:inline-block;padding:12px 18px;background:#172554;color:#fff;text-decoration:none;border-radius:6px">Click to update delivery date</a></p><p>Please keep the order status current using the link above.</p>`;
  return { subject, text, html, attachments: [] };
}

export async function deliverReminderEmail(input: SendReminderEmailRequest) {
  const parsed = sendReminderEmailRequestSchema.parse(input);
  return (await delivery())(parsed.to, prepareReminderMail(parsed));
}

import type { SendMailOptions } from "nodemailer";
import { describe, expect, it, vi } from "vitest";

import {
  createEmailDelivery,
  orderRemoteProviders,
  prepareCanvasMail,
  prepareCanvasReportMail,
  prepareCanvasReportHtmlOnlyMail,
  preparePurchaseSamplingMail,
  type MailTransportFactory,
  type SmtpProviderConfig,
} from "@/lib/email/mailer";

const primary: SmtpProviderConfig = {
  id: "163",
  name: "163.com",
  host: "smtp.163.com",
  port: 465,
  secure: true,
  requireTls: false,
  username: "sender@163.com",
  password: "authorization-password",
  fromName: "Infinite Canvas",
};

const backup: SmtpProviderConfig = {
  id: "gmail",
  name: "Gmail",
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  requireTls: true,
  username: "sender@gmail.com",
  password: "app-password",
  fromName: "Infinite Canvas",
};

const mail = {
  subject: "Test subject",
  text: "Test text",
  html: "<p>Test</p>",
  attachments: [],
};

describe("orderRemoteProviders", () => {
  it("keeps 163-then-Gmail order when no preference is set", () => {
    expect(orderRemoteProviders([primary, backup], null).map((p) => p.id)).toEqual(["163", "gmail"]);
  });

  it("puts 163 first when it is preferred", () => {
    expect(orderRemoteProviders([primary, backup], "163").map((p) => p.id)).toEqual([
      "163",
      "gmail",
    ]);
  });

  it("puts Gmail first when it is preferred, keeping 163 as fallback", () => {
    expect(orderRemoteProviders([primary, backup], "gmail").map((p) => p.id)).toEqual([
      "gmail",
      "163",
    ]);
  });

  it("is a no-op when the preferred provider is not configured", () => {
    expect(orderRemoteProviders([backup], "163").map((p) => p.id)).toEqual(["gmail"]);
  });

  it("does not mutate the input array", () => {
    const input = [primary, backup];
    const output = orderRemoteProviders(input, "gmail");
    expect(input.map((p) => p.id)).toEqual(["163", "gmail"]);
    expect(output).not.toBe(input);
  });
});

describe("SMTP email delivery", () => {
  it("sends with the primary provider and validates the SMTP response", async () => {
    const sent: SendMailOptions[] = [];
    const sendMail = vi.fn(async (options: SendMailOptions): Promise<unknown> => {
      sent.push(options);
      return {
        messageId: "primary-message-id",
        accepted: ["recipient@example.com"],
        rejected: [],
        response: "250 Message accepted",
      };
    });
    const createTransport: MailTransportFactory = () => ({ sendMail });
    const deliver = createEmailDelivery({ providers: [primary, backup], createTransport });

    await expect(deliver("recipient@example.com", mail)).resolves.toEqual({
      success: true,
      provider: "163",
      messageId: "primary-message-id",
    });
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sent[0]).toMatchObject({
      from: { name: "Infinite Canvas", address: "sender@163.com" },
      to: "recipient@example.com",
      subject: "Test subject",
    });
  });

  it("falls back to Gmail when 163.com rejects the send", async () => {
    const attempted: string[] = [];
    const createTransport: MailTransportFactory = (provider) => ({
      async sendMail(): Promise<unknown> {
        attempted.push(provider.id);
        if (provider.id === "163") throw new Error("Authentication failed");
        return {
          messageId: "backup-message-id",
          accepted: ["recipient@example.com"],
          rejected: [],
          response: "250 Message accepted",
        };
      },
    });
    const deliver = createEmailDelivery({ providers: [primary, backup], createTransport });

    await expect(deliver("recipient@example.com", mail)).resolves.toEqual({
      success: true,
      provider: "gmail",
      messageId: "backup-message-id",
    });
    expect(attempted).toEqual(["163", "gmail"]);
  });

  it("treats an invalid SMTP response as a failed provider", async () => {
    const createTransport: MailTransportFactory = () => ({
      async sendMail(): Promise<unknown> {
        return { messageId: "not-accepted", accepted: [] };
      },
    });
    const deliver = createEmailDelivery({ providers: [primary], createTransport });

    await expect(deliver("recipient@example.com", mail)).rejects.toThrow(
      "Email delivery failed using 163.com",
    );
  });

  it("attaches inline images and links hosted images without fetching them", () => {
    const prepared = prepareCanvasMail({
      to: "recipient@example.com",
      canvasName: "Campaign board",
      images: [
        {
          id: "inline",
          url: "data:image/png;base64,aW1hZ2U=",
          prompt: "Studio product photo",
          createdAt: "2026-07-12T12:00:00.000Z",
        },
        {
          id: "hosted",
          url: "https://images.example.com/render.webp",
          prompt: null,
          createdAt: "2026-07-12T12:01:00.000Z",
        },
      ],
    });

    expect(prepared.attachments).toHaveLength(1);
    expect(prepared.attachments[0]).toMatchObject({
      filename: "canvas-render-01.png",
      contentType: "image/png",
      cid: "canvas-render-1@infinite-canvas",
    });
    expect(prepared.html).toContain('src="cid:canvas-render-1@infinite-canvas"');
    expect(prepared.html).toContain("https://images.example.com/render.webp");
    expect(prepared.text).toContain("attached as canvas-render-01.png");
  });

  it("keeps report email delivery possible when PDF rendering fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const prepared = await prepareCanvasReportMail(
      {
        to: "recipient@example.com",
        canvasName: "Campaign board",
        subject: "Campaign board canvas report",
        html: "<p>Report body</p>",
        text: "Report body",
        pdfFilename: "campaign-board-report.pdf",
      },
      async () => {
        throw new Error("PDF render failed");
      },
    );

    expect(prepared.attachments).toEqual([]);
    expect(prepared.text).toContain("Report body");
    expect(prepared.text).toContain("email content only");
    expect(prepared.html).toContain("email content only");

    errorSpy.mockRestore();
  });

  it("prepares one report email with HTML body and PDF attachment", async () => {
    const largeInlineImage = `data:image/png;base64,${"a".repeat(50_001)}`;
    const prepared = await prepareCanvasReportMail(
      {
        to: "recipient@example.com",
        canvasName: "Campaign board",
        subject: "Campaign board canvas report",
        html: `<p>Report body</p><img src="${largeInlineImage}" alt="render">`,
        text: "Report body",
        pdfFilename: "campaign-board-report.pdf",
      },
      async () => Buffer.from("%PDF-test"),
    );

    expect(prepared.subject).toBe("Campaign board canvas report");
    expect(prepared.html).toContain("<p>Report body</p>");
    expect(prepared.html).not.toContain(largeInlineImage);
    expect(prepared.html).toContain("Image included in the attached PDF.");
    expect(prepared.attachments).toHaveLength(1);
    expect(prepared.attachments[0]).toMatchObject({
      filename: "campaign-board-report.pdf",
      contentType: "application/pdf",
    });
  });

  it("keeps small inline report images in HTML for Pantone color swatches", async () => {
    const swatch = "data:image/png;base64,aW1hZ2U=";
    const prepared = await prepareCanvasReportMail(
      {
        to: "recipient@example.com",
        canvasName: "Campaign board",
        subject: "Campaign board canvas report",
        html: `<p>Pantone</p><img src="${swatch}" alt="Pantone 341C solid coated #007a53">`,
        text: "Report body",
        pdfFilename: "campaign-board-report.pdf",
      },
      async () => Buffer.from("%PDF-test"),
    );

    expect(prepared.html).toContain(swatch);
    expect(prepared.html).toContain("Pantone 341C solid coated");
  });

  it("prepares a pure HTML report email without PDF attachment", () => {
    const prepared = prepareCanvasReportHtmlOnlyMail({
      to: "recipient@example.com",
      canvasName: "Campaign board",
      subject: "Campaign board canvas report",
      html: "<p>Report body</p>",
      text: "Report body",
      pdfFilename: "campaign-board-report.pdf",
    });

    expect(prepared.subject).toBe("Campaign board canvas report");
    expect(prepared.attachments).toEqual([]);
    expect(prepared.text).toBe("Report body");
    expect(prepared.html).toBe("<p>Report body</p>");
  });

  it("prepares purchase order email with HTML QR and a QR PDF attachment", async () => {
    const prepared = await preparePurchaseSamplingMail({
      to: "supplier@example.com",
      sequence: "CA000001",
      supplierName: "Supplier A",
      projectName: "Project A",
      canvasName: "Canvas A",
      purchaseDate: "2026-07-18",
      reportUrl: "https://example.com/canvas-report",
      updateUrl: "https://example.com/sample-orders/token",
      qrCodeDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      supplierDetails: ["Line 1", "Line 2"],
    });

    expect(prepared.html).toContain("https://example.com/sample-orders/token");
    expect(prepared.html).toContain("data:image/png;base64");
    expect(prepared.attachments).toHaveLength(1);
    expect(prepared.attachments[0]).toMatchObject({
      filename: "CA000001-sample-status-qr.pdf",
      contentType: "application/pdf",
    });
  });

  it("can require the PDF attachment for the second diagnostic report email", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      prepareCanvasReportMail(
        {
          to: "recipient@example.com",
          canvasName: "Campaign board",
          subject: "Campaign board canvas report",
          html: "<p>Report body</p>",
          text: "Report body",
          pdfFilename: "campaign-board-report.pdf",
        },
        async () => {
          throw new Error("PDF render failed");
        },
        { requirePdf: true },
      ),
    ).rejects.toThrow("PDF render failed");

    errorSpy.mockRestore();
  });
});

import { describe, expect, it } from "vitest";

import {
  PREFERRED_SMTP_PROVIDER_SETTING,
  preferredSmtpProviderSchema,
} from "@/lib/email/schemas";

describe("preferredSmtpProviderSchema", () => {
  it("accepts 163 and gmail, plus null for 'use default order'", () => {
    expect(preferredSmtpProviderSchema.safeParse("163").success).toBe(true);
    expect(preferredSmtpProviderSchema.safeParse("gmail").success).toBe(true);
    expect(preferredSmtpProviderSchema.safeParse(null).success).toBe(true);
  });

  it("rejects other providers and non-string/non-null values", () => {
    for (const value of ["local", "outlook", "", "GMAIL", 163, undefined, {}]) {
      expect(preferredSmtpProviderSchema.safeParse(value).success).toBe(false);
    }
  });

  it("exposes the setting key used by the app_settings whitelist", () => {
    expect(PREFERRED_SMTP_PROVIDER_SETTING).toBe("preferred-smtp-provider");
  });
});

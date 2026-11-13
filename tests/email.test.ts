import { describe, expect, it, vi } from "vitest";

import {
  codeEmailHtml,
  codeEmailText,
  sendEmail,
  sendEmailUpdateVerification,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/helpers/emailService";
import { validateEnv } from "@/lib/config/env";
import { storageConfig } from "@/lib/helpers/storage";

const env = { RESEND_API_KEY: "re_test_SECRETVALUE", RESEND_FROM_EMAIL: "TrackBot <no-reply@shop.test>" };

function fakeFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 200 ? '{"id":"1"}' : '{"message":"bad key re_test_SECRETVALUE"}', { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("sendEmail (Resend)", () => {
  it("posts to the Resend API with the key in the Authorization header and the configured sender", async () => {
    const f = fakeFetch();
    await sendEmail({ to: "ada@example.com", subject: "Hi", html: "<p>x</p>" }, { fetchImpl: f.impl, env });

    expect(f.calls[0].url).toBe("https://api.resend.com/emails");
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer re_test_SECRETVALUE");
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({
      from: "TrackBot <no-reply@shop.test>",
      to: ["ada@example.com"],
      subject: "Hi",
      html: "<p>x</p>",
    });
  });

  it("fails clearly when not configured, without calling the network", async () => {
    const f = fakeFetch();
    await expect(sendEmail({ to: "a@b.test", subject: "s", html: "h" }, { fetchImpl: f.impl, env: {} })).rejects.toThrow(/not configured/);
    await expect(sendEmail({ to: "a@b.test", subject: "s", html: "h" }, { fetchImpl: f.impl, env: { RESEND_API_KEY: "k" } })).rejects.toThrow(/not configured/);
    expect(f.calls).toHaveLength(0);
  });

  it("reports only the HTTP status when the provider refuses (no body, no key)", async () => {
    const f = fakeFetch(403);
    const err = await sendEmail({ to: "a@b.test", subject: "s", html: "h" }, { fetchImpl: f.impl, env }).catch((e: Error) => e);
    expect((err as Error).message).toBe("Email provider answered HTTP 403");
    expect((err as Error).message).not.toContain("SECRET");
  });
});

describe("code emails", () => {
  it("are in English, carry the code and the brand, and escape HTML", () => {
    const html = codeEmailHtml({ title: "T <b>", intro: "Hello & welcome", code: "123456", ignoreNote: "Ignore it." });
    expect(html).toContain("123456");
    expect(html).toContain("TrackBot");
    expect(html).toContain("5 minutes");
    expect(html).toContain("T &lt;b&gt;");
    expect(html).toContain("Hello &amp; welcome");
    expect(html).not.toMatch(/Bonjour|boutique|Ce code/);
  });

  it("the three sending functions use the right subjects and report a generic error on failure", async () => {
    const f = fakeFetch();
    vi.stubGlobal("fetch", f.impl);
    vi.stubEnv("RESEND_API_KEY", env.RESEND_API_KEY);
    vi.stubEnv("RESEND_FROM_EMAIL", env.RESEND_FROM_EMAIL);

    await sendVerificationEmail("a@b.test", "111111");
    await sendEmailUpdateVerification("a@b.test", "222222");
    await sendPasswordResetEmail("a@b.test", "333333");
    const sent = f.calls.map((c) => JSON.parse(c.init.body as string));
    expect(sent.map((m) => m.subject)).toEqual(["Verify your TrackBot account", "Confirm your new email address", "Your TrackBot password reset code"]);
    // The code appears in the highlighted code box and in the plain-text version.
    expect(sent.map((m) => m.html.match(/color:#000000;">(\d{6})</)?.[1])).toEqual(["111111", "222222", "333333"]);
    expect(sent.map((m) => m.text.match(/Your code: (\d{6})/)?.[1])).toEqual(["111111", "222222", "333333"]);

    vi.stubGlobal("fetch", fakeFetch(500).impl);
    await expect(sendPasswordResetEmail("a@b.test", "1")).rejects.toThrow("Failed to send password-reset email.");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});

describe("the designed code email", () => {
  const opts = { title: "Reset your password", intro: "Use the code below.", code: "482915", ignoreNote: "Ignore it if this was not you." };

  it("shows the logo (inline attachment), the brand, a hidden preview line and a security warning", () => {
    const html = codeEmailHtml(opts);
    expect(html).toContain('src="cid:logo"');
    expect(html).toContain("TrackBot");
    expect(html).toMatch(/display:none[^>]*>Your TrackBot code is 482915\. It expires in 5 minutes\./);
    expect(html).toContain("Keep this code private");
    expect(html).toContain("482915");
  });

  it("uses only inline styles and tables, with no scripts or remote images", () => {
    const html = codeEmailHtml(opts);
    expect(html).not.toMatch(/<script|<link |@import|<img[^>]+src="https?:/i);
    expect(html).toContain('role="presentation"');
  });

  it("can omit the logo, or show it from another source (preview)", () => {
    expect(codeEmailHtml({ ...opts, logoSrc: null })).not.toContain("<img");
    expect(codeEmailHtml({ ...opts, logoSrc: "data:image/png;base64,AAAA" })).toContain('src="data:image/png;base64,AAAA"');
  });

  it("is sent with the logo attached inline, a plain-text part and the code in both", async () => {
    const f = fakeFetch();
    vi.stubGlobal("fetch", f.impl);
    vi.stubEnv("RESEND_API_KEY", env.RESEND_API_KEY);
    vi.stubEnv("RESEND_FROM_EMAIL", env.RESEND_FROM_EMAIL);

    await sendPasswordResetEmail("a@b.test", "482915");
    const body = JSON.parse(f.calls[0].init.body as string);

    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({ filename: "logo.png", content_id: "logo" });
    expect(Buffer.from(body.attachments[0].content, "base64").subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(body.text).toContain("Your code: 482915");
    expect(body.html).toContain("482915");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("the plain-text version carries the same facts", () => {
    const text = codeEmailText(opts);
    expect(text).toContain("Your code: 482915");
    expect(text).toContain("valid for 5 minutes");
    expect(text).toContain("Keep this code private");
  });
});

describe("accepted variable names (so existing Railway variables can be reused)", () => {
  const base = { DATABASE_URL: "x" };

  it("warns when online payment is not configured, without printing any key", () => {
    const { warnings } = validateEnv({ ...base, AUTH_SECRET: "a-long-enough-secret-value" });
    expect(warnings.join(" ")).toContain("PAYSTACK_SECRET_KEY");
    const configured = validateEnv({ ...base, AUTH_SECRET: "a-long-enough-secret-value", PAYSTACK_SECRET_KEY: "sk_test_abc123" });
    expect(configured.warnings.join(" ")).not.toContain("PAYSTACK_SECRET_KEY");
    expect(JSON.stringify(configured)).not.toContain("sk_test_abc123");
  });

  it("JWT_SECRET counts as the auth secret", () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: "a-long-enough-secret-value" })).not.toThrow();
    expect(() => validateEnv({ ...base, JWT_SECRET: "short" })).toThrow();
  });

  it("R2_BUCKET_NAME and R2_PUBLIC_URL are accepted by the startup check and by storage", () => {
    const names = { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET_NAME: "bucket", R2_PUBLIC_URL: "https://pub-x.r2.dev" };
    const { warnings } = validateEnv({ ...base, AUTH_SECRET: "a-long-enough-secret-value", ...names, ...env, DEEPSEEK_API_KEY: "sk-real", PAYSTACK_SECRET_KEY: "sk_test_x" });
    expect(warnings).toEqual([]);
    expect(storageConfig(names)?.bucket).toBe("bucket");
  });

  it("warns about missing Resend settings by name only", () => {
    const { warnings } = validateEnv({ ...base, AUTH_SECRET: "a-long-enough-secret-value" });
    expect(warnings.join(" ")).toContain("RESEND_API_KEY / RESEND_FROM_EMAIL");
  });
});

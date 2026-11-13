import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { UserRole as R } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/helpers/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helpers/storage")>();
  return { ...actual, requireStorage: vi.fn(actual.requireStorage) };
});

import { auth } from "@/lib/auth";
import { POST as uploadRoute } from "@/app/api/uploads/image/route";
import { createStorage, detectImageType, requireStorage, storageConfig, StorageError } from "@/lib/helpers/storage";
import { getImageUrlFromPublicId } from "@/lib/utils";
import { validateEnv } from "@/lib/config/env";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const WEBP = [...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBP"), 0x56, 0x50];
const GIF = [...Buffer.from("GIF89a"), 1, 0, 1, 0];
const PDF = [...Buffer.from("%PDF-1.7\n")];

const file = (bytes: number[] | Uint8Array, name = "photo.jpg", type = "image/jpeg") =>
  new File([new Uint8Array(bytes)], name, { type });

function fakeClient() {
  const sent: object[] = [];
  const client = {
    send: vi.fn(async (cmd: object) => {
      sent.push(cmd);
      return {};
    }),
  };
  return { client: client as never, sent, send: client.send };
}

describe("detectImageType (looks at the bytes, not the name)", () => {
  it("recognises JPEG, PNG and WebP", () => {
    expect(detectImageType(new Uint8Array(JPEG))).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(detectImageType(new Uint8Array(PNG))).toEqual({ ext: "png", mime: "image/png" });
    expect(detectImageType(new Uint8Array(WEBP))).toEqual({ ext: "webp", mime: "image/webp" });
  });

  it("rejects other formats, empty and truncated data", () => {
    for (const bytes of [GIF, PDF, [], [0xff], [0xff, 0xd8], [0x89, 0x50], [...Buffer.from("RIFF....WAVE")]]) {
      expect(detectImageType(new Uint8Array(bytes))).toBeNull();
    }
  });
});

describe("uploadImage", () => {
  it("stores a valid image under a random key and sets the type from the bytes", async () => {
    const { client, sent } = fakeClient();
    const storage = createStorage({ client, bucket: "shop-bucket" });

    // The file claims to be a JPEG named "../../evil.jpg", but its bytes are PNG.
    const { key } = await storage.uploadImage(file(PNG, "../../evil.jpg", "image/jpeg"), "products");

    expect(key).toMatch(/^products\/[0-9a-f-]{36}\.png$/);
    expect(key).not.toContain("evil");
    const cmd = sent[0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toMatchObject({
      Bucket: "shop-bucket",
      Key: key,
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000, immutable",
    });
  });

  it("gives every upload a different key", async () => {
    const storage = createStorage({ ...fakeClient(), bucket: "b" });
    const a = await storage.uploadImage(file(JPEG), "avatars");
    const b = await storage.uploadImage(file(JPEG), "avatars");
    expect(a.key).not.toBe(b.key);
  });

  it("rejects non-images even when the name and type claim otherwise", async () => {
    const f = fakeClient();
    const storage = createStorage({ client: f.client, bucket: "b" });
    for (const bytes of [GIF, PDF, [...Buffer.from("<script>alert(1)</script>")], []]) {
      await expect(storage.uploadImage(file(bytes, "x.png", "image/png"), "products")).rejects.toMatchObject({
        name: "StorageError",
        code: expect.stringMatching(/INVALID_FILE|TOO_LARGE/),
      });
    }
    expect(f.send).not.toHaveBeenCalled();
  });

  it("rejects files over the size limit without reading them into storage", async () => {
    const f = fakeClient();
    const storage = createStorage({ client: f.client, bucket: "b" });
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(JPEG);
    await expect(storage.uploadImage(file(big), "products")).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("rejects unsafe folder names", async () => {
    const f = fakeClient();
    const storage = createStorage({ client: f.client, bucket: "b" });
    for (const folder of ["../x", "a/b", "UPPER", "", "x".repeat(41), "with space"]) {
      await expect(storage.uploadImage(file(JPEG), folder)).rejects.toMatchObject({ code: "INVALID_FILE" });
    }
    expect(f.send).not.toHaveBeenCalled();
  });

  it("reports a failed upload without leaking the underlying error", async () => {
    const storage = createStorage({
      client: { send: vi.fn(async () => { throw new Error("secret-account-id 12345 denied"); }) } as never,
      bucket: "b",
    });
    const err = await storage.uploadImage(file(JPEG), "products").catch((e: Error) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("UPLOAD_FAILED");
    expect((err as Error).message).not.toContain("secret");
  });
});

describe("deleteImage", () => {
  it("deletes keys this module created", async () => {
    const f = fakeClient();
    const storage = createStorage({ client: f.client, bucket: "b" });
    const { key } = await storage.uploadImage(file(JPEG), "products");
    await storage.deleteImage(key);
    const del = f.sent[1] as DeleteObjectCommand;
    expect(del).toBeInstanceOf(DeleteObjectCommand);
    expect(del.input).toEqual({ Bucket: "b", Key: key });
  });

  it("ignores foreign, traversal and legacy keys", async () => {
    const f = fakeClient();
    const storage = createStorage({ client: f.client, bucket: "b" });
    for (const key of ["../../etc/passwd", "products/../x.png", "other.png", "pic7_hfywjb_bd7zuk", "https://x.test/a.png", "", "products/not-a-uuid.png"]) {
      await storage.deleteImage(key);
    }
    expect(f.send).not.toHaveBeenCalled();
  });

  it("never throws when the storage service fails", async () => {
    const storage = createStorage({ client: { send: vi.fn(async () => { throw new Error("down"); }) } as never, bucket: "b" });
    await expect(storage.deleteImage("products/123e4567-e89b-12d3-a456-426614174000.jpg")).resolves.toBeUndefined();
  });
});

describe("configuration", () => {
  const full = { R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "bkt" };

  it("is null unless every R2 credential is present", () => {
    expect(storageConfig({})).toBeNull();
    for (const missing of Object.keys(full)) {
      const env = { ...full } as Record<string, string | undefined>;
      delete env[missing];
      expect(storageConfig(env)).toBeNull();
    }
    expect(storageConfig(full)?.bucket).toBe("bkt");
  });

  it("the startup check lists exactly what is missing, never values", () => {
    const base = { DATABASE_URL: "x", AUTH_SECRET: "a-long-enough-secret-value" };
    const none = validateEnv(base).warnings.join(" ");
    expect(none).toContain("R2_BUCKET");
    expect(none).toContain("NEXT_PUBLIC_R2_PUBLIC_URL");
    const all = validateEnv({ ...base, ...full, NEXT_PUBLIC_R2_PUBLIC_URL: "https://pub-x.r2.dev", RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "a@b.test", OPENAI_API_KEY: "sk-real", PAYSTACK_SECRET_KEY: "sk_test_x" });
    expect(all.warnings).toEqual([]);
    expect(JSON.stringify(none)).not.toContain("secret");
  });
});

describe("getImageUrlFromPublicId", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("joins the bucket URL and the key, with or without a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_URL", "https://pub-abc.r2.dev");
    expect(getImageUrlFromPublicId("products/a.jpg")).toBe("https://pub-abc.r2.dev/products/a.jpg");
    vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_URL", "https://pub-abc.r2.dev/");
    expect(getImageUrlFromPublicId("products/a.jpg")).toBe("https://pub-abc.r2.dev/products/a.jpg");
  });

  it("passes absolute URLs through and falls back to a placeholder when unconfigured", () => {
    vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_URL", "");
    expect(getImageUrlFromPublicId("products/a.jpg")).toBe("/images/no-image.png");
    expect(getImageUrlFromPublicId("https://cdn.test/x.png")).toBe("https://cdn.test/x.png");
  });
});

describe("POST /api/uploads/image", () => {
  const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
  const mockedRequire = vi.mocked(requireStorage);
  const loginAs = (role: R | null) =>
    mockedAuth.mockResolvedValue(role ? { user: { id: "u1", role } } : null);

  const send = (parts: Record<string, string | File | undefined>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(parts)) if (v !== undefined) fd.append(k, v);
    return uploadRoute(new NextRequest("http://localhost/api/uploads/image", { method: "POST", body: fd }));
  };

  beforeEach(() => {
    mockedAuth.mockReset();
    mockedRequire.mockReset();
  });

  it("401 anonymous and 403 for non-admins", async () => {
    loginAs(null);
    expect((await send({ file: file(JPEG), folder: "products" })).status).toBe(401);
    for (const role of [R.CLIENT, R.LIVREUR, R.VENDEUR]) {
      loginAs(role);
      expect((await send({ file: file(JPEG), folder: "products" })).status).toBe(403);
    }
  });

  it("400 for a missing file or a folder outside the allowed list", async () => {
    loginAs(R.ADMIN);
    expect((await send({ folder: "products" })).status).toBe(400);
    expect((await send({ file: file(JPEG), folder: "secrets" })).status).toBe(400);
    expect((await send({ file: file(JPEG) })).status).toBe(400);
  });

  it("503 with a clear message when R2 is not configured", async () => {
    loginAs(R.ADMIN);
    mockedRequire.mockImplementation(() => { throw new StorageError("NOT_CONFIGURED", "Image storage is not configured on the server."); });
    const res = await send({ file: file(JPEG), folder: "products" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("not configured");
  });

  it("200 and the object key for a valid image; 400 for a fake image", async () => {
    loginAs(R.ADMIN);
    const f = fakeClient();
    mockedRequire.mockReturnValue(createStorage({ client: f.client, bucket: "b" }) as never);

    const ok = await send({ file: file(JPEG), folder: "products" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.publicId).toMatch(/^products\/[0-9a-f-]{36}\.jpg$/);

    const fake = await send({ file: file(PDF, "invoice.png", "image/png"), folder: "products" });
    expect(fake.status).toBe(400);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("413 for an oversized image and 502 when R2 rejects the upload", async () => {
    loginAs(R.ADMIN);
    mockedRequire.mockReturnValue(createStorage({ client: fakeClient().client, bucket: "b" }) as never);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(JPEG);
    expect((await send({ file: file(big), folder: "products" })).status).toBe(413);

    mockedRequire.mockReturnValue(
      createStorage({ client: { send: vi.fn(async () => { throw new Error("denied"); }) } as never, bucket: "b" }) as never
    );
    expect((await send({ file: file(JPEG), folder: "products" })).status).toBe(502);
  });
});

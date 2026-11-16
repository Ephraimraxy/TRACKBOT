import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/getAuth", () => ({ default: vi.fn() }));

import getAuth from "@/lib/auth/getAuth";
import { middleware } from "@/middleware";
import { homeFor } from "@/lib/helpers/roleHome";

const mockedAuth = vi.mocked(getAuth) as unknown as ReturnType<typeof vi.fn>;
const as = (role: string | null) =>
  mockedAuth.mockResolvedValue(role ? { user: { id: "u1", role, emailVerifie: true } } : null);

/** Where the middleware sends a request for `path`, or "stay" when it lets it through. */
async function go(path: string) {
  const res = await middleware(new NextRequest(`http://localhost${path}`));
  const location = res.headers.get("location");
  return location ? new URL(location).pathname + new URL(location).search : "stay";
}

beforeEach(() => vi.stubEnv("ALLOW_VENDORS", ""));
afterEach(() => vi.unstubAllEnvs());

describe("sending people to their own area", () => {
  it("a delivery person who opens a customer link lands on their deliveries, not the home page", async () => {
    as("LIVREUR");
    expect(await go("/client/orders")).toBe("/driver/deliveries");
    expect(await go("/client/settings")).toBe("/driver/deliveries");
  });

  it("a customer who opens the driver or admin area lands on their orders", async () => {
    as("CLIENT");
    expect(await go("/driver/deliveries")).toBe("/client/orders");
    expect(await go("/admin/dashboard")).toBe("/client/orders");
  });

  it("the owner who opens a customer or driver link lands on the dashboard", async () => {
    as("ADMIN");
    expect(await go("/client/orders")).toBe("/admin/dashboard");
    expect(await go("/driver/deliveries")).toBe("/admin/dashboard");
  });

  it("each role can open its own area", async () => {
    as("CLIENT");
    expect(await go("/client/orders")).toBe("stay");
    as("LIVREUR");
    expect(await go("/driver/deliveries")).toBe("stay");
    as("ADMIN");
    expect(await go("/admin/dashboard")).toBe("stay");
  });

  it("the switched-off vendor area never loops: it goes to the home page", async () => {
    as("VENDEUR");
    expect(await go("/vendor/dashboard")).toBe("/");
    expect(await go("/client/orders")).toBe("/");
  });

  it("an anonymous visitor is still asked to log in first", async () => {
    as(null);
    expect(await go("/client/orders")).toBe("/auth/login?callbackUrl=%2Fclient%2Forders");
    expect(await go("/admin/dashboard")).toBe("/admin");
  });

  it("homeFor gives every role an area that role may open", () => {
    expect(homeFor("ADMIN")).toBe("/admin/dashboard");
    expect(homeFor("LIVREUR")).toBe("/driver/deliveries");
    expect(homeFor("CLIENT")).toBe("/client/orders");
    expect(homeFor(undefined)).toBe("/");
  });
});

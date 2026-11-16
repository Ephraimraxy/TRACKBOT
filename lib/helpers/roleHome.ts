/**
 * Where a signed-in person belongs. Someone who opens an area that is not theirs (for example a delivery person
 * following a customer link) is sent to their own area, not silently back to the home page.
 */
export function homeFor(role: string | undefined): string {
  switch (role) {
    case "ADMIN":
      return "/admin/dashboard";
    case "LIVREUR":
      return "/driver/deliveries";
    case "CLIENT":
      return "/client/orders";
    case "VENDEUR":
      return process.env.ALLOW_VENDORS === "true" ? "/vendor/dashboard" : "/";
    default:
      return "/";
  }
}

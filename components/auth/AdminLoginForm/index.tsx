"use client";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FormErrorMessage from "@/components/auth/FormErrorMessage";
import FieldErrorMessage from "@/components/auth/FieldErrorMessage";

/**
 * The shop owner's sign-in, shown at /admin. It posts to the same login route as the customers'
 * form, but with portal "admin", so only the administrator account is accepted here. There is no
 * sign-up link: customers register at /auth/register, and the administrator account comes from
 * the ADMIN_EMAIL / ADMIN_PASSWORD variables set on the server.
 */
export function AdminLoginForm() {
  const { t } = useI18n();
  const { update } = useSession();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage("");
    setFieldErrors({});

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, portal: "admin" }),
      });

      const responseJson = await response.json();
      if (!response.ok) {
        setErrorMessage(responseJson?.error || "An error occurred. Please try again.");
        if (Array.isArray(responseJson?.data)) {
          const errors: Record<string, string> = {};
          responseJson.data.forEach((err: { field: string; message: string }) => {
            errors[err.field] = err.message;
          });
          setFieldErrors(errors);
        }
        return;
      }

      await update();
      toast(t("Logged in successfully"));
      router.push("/admin/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <T>Administrator sign-in</T>
        </CardTitle>
        <CardDescription>
          <T>Sign in with the administrator email and password.</T>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="grid gap-3">
            <Label htmlFor="email">
              <T>Email</T>
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              required
            />
            {fieldErrors.email && <FieldErrorMessage message={fieldErrors.email} />}
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">
                <T>Password</T>
              </Label>
              <Link href="/auth/reset-password?from=admin" className="text-sm underline-offset-4 hover:underline">
                <T>Forgot password?</T>
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              required
            />
            {fieldErrors.password && <FieldErrorMessage message={fieldErrors.password} />}
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? t("Logging in...") : t("Log in")}
          </Button>
          <FormErrorMessage message={errorMessage} />
        </form>
      </CardContent>
    </Card>
  );
}

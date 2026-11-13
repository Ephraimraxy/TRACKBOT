"use client";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

// UI components
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Components
import FormErrorMessage from "@/components/auth/FormErrorMessage";
import FieldErrorMessage from "@/components/auth/FieldErrorMessage";

// Utils
import { cn } from "@/lib/utils";

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { t } = useI18n();
  const { update } = useSession();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl");
  const registerHref = callbackUrl
    ? `/auth/register?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : "/auth/register";

  // Handle the form submission
  const handleSubmitForm = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage("");
    setFieldErrors({});

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const responseJson = await response.json();
      if (!response.ok) {
        setErrorMessage(
          responseJson?.error || "An error occurred. Please try again."
        );
        if (responseJson?.data) {
          const errors: Record<string, string> = {};
          responseJson.data.forEach(
            (err: { field: string; message: string }) => {
              errors[err.field] = err.message;
            }
          );
          setFieldErrors(errors);
        }
        return;
      }

      // update the session
      await update();
      toast(responseJson.message || "Login successful.");

      // The administrator lands in the admin area; everyone else goes back where they came from
      // (internal addresses only).
      const callbackUrl = searchParams.get("callbackUrl");
      const redirectUrl = responseJson.role === "ADMIN"
        ? "/admin/dashboard"
        : responseJson.role === "LIVREUR"
        ? "/driver/deliveries"
        : callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") && !callbackUrl.startsWith("/admin")
        ? callbackUrl
        : "/";
      router.push(redirectUrl);
      router.refresh();
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle><T>Log in to your account</T></CardTitle>
          <CardDescription>
            <T>Enter your email below to log in.</T>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmitForm}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-3">
                {/* email */}
                <Label htmlFor="email"><T>Email</T></Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("example@email.com")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  required
                />
                {fieldErrors.email && (
                  <FieldErrorMessage message={fieldErrors.email} />
                )}
              </div>

              {/* password */}
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password"><T>Password</T></Label>
                  <Link
                    href="/auth/reset-password"
                    className="text-sm underline-offset-4 hover:underline"
                  >
                    <T>Forgot password?</T>
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
                {fieldErrors.password && (
                  <FieldErrorMessage message={fieldErrors.password} />
                )}
              </div>

              {/* submit button */}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t("Logging in...") : t("Log in")}
              </Button>

              <FormErrorMessage message={errorMessage} />
            </div>

            {/* link to login page */}
            <div className="mt-4 text-center text-sm">
              <T>Don&apos;t have an account?</T>{" "}
              <Link
                href={registerHref}
                className="underline underline-offset-4"
              >
                <T>Sign up</T>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

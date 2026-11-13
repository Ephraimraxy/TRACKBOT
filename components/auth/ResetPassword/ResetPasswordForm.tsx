"use client";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import FormErrorMessage from "@/components/auth/FormErrorMessage";
import FieldErrorMessage from "@/components/auth/FieldErrorMessage";

const ResetPasswordForm = ({ email }: { email: string }) => {
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, newPassword: password }),
      });

      const responseJson = await res.json();
      if (!res.ok) {
        setErrorMessage(responseJson.error || "Reset error.");

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

      toast(t("Password reset successfully."));
      // The administrator reached this page from /admin, so they go back there to sign in.
      const fromAdmin = new URLSearchParams(window.location.search).get("from") === "admin";
      router.push(fromAdmin ? "/admin" : "/auth/login");
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle><T>Enter the verification code</T></CardTitle>
        <CardDescription>
          <T>Check your email (</T>{email}<T>) and enter the code you received along with a new password.</T>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="grid gap-3">
            <Label htmlFor="code"><T>Verification code</T></Label>
            <Input
              id="code"
              type="text"
              placeholder={t("6-digit code")}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              disabled={isLoading}
            />
            {fieldErrors.code && (
              <FieldErrorMessage message={fieldErrors.code} />
            )}
          </div>
          <div className="grid gap-3">
            <Label htmlFor="password"><T>New password</T></Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
            {fieldErrors.newPassword && (
              <FieldErrorMessage message={fieldErrors.newPassword} />
            )}
          </div>
          <FormErrorMessage message={errorMessage} />
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Resetting..." : "Confirm"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default ResetPasswordForm;

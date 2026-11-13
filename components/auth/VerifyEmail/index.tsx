"use client";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";

import { useEffect, useRef, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { User } from "next-auth";
import { toast } from "sonner";
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
import FormErrorMessage from "@/components/auth/FormErrorMessage";

interface VerifyEmailProps {
  user: User;
}

export default function VerifyEmail({ user }: VerifyEmailProps) {
  const { t } = useI18n();
  const { data: session, update } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [emailSent, setEmailSent] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    const refresh = searchParams.get("refresh");
    if (refresh) {
      router.replace("/auth/verify-email");
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSubmitForm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMessage(null);
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const verificationCode = formData.get("verification-code") as string;

    try {
      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, code: verificationCode }),
      });

      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error || "An unknown error occurred.");
      }

      const { message } = await response.json();
      await update({ ...session });
      toast(message || "Verification successful");

      // Valider l'URL de redirection (interne uniquement)
      const callbackUrl = searchParams.get("callbackUrl");
      const safeCallbackUrl =
        callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//")
          ? callbackUrl
          : "/";

      // Redirect to email verification page, preserving callback
      router.push(safeCallbackUrl);
      router.refresh();
    } catch (error) {
      console.error("Error verifying email:", error);
      setErrorMessage(
        (error as Error).message || "Network error. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const sentKey = `verify-code-sent:${user.email}`;

  const sendCode = async () => {
    try {
      const response = await fetch("/api/auth/email/send-verification-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });

      if (!response.ok)
        throw new Error("Unable to send the email. Please try again.");

      try {
        sessionStorage.setItem(sentKey, String(Date.now()));
      } catch {
        // Private window: the code was still sent, we just cannot remember when.
      }
      setEmailSent(true);
      setCountdown(60);
      setErrorMessage(null);
      toast(t("A code was sent to your email address."));
    } catch (error) {
      console.error("Error sending verification code:", error);
      setErrorMessage(t("Unable to send the email. Please try again."));
    }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;
    await sendCode();
  };

  // A new customer lands here straight after signing up, so the code is sent automatically.
  // If one was sent in the last minute (a page refresh), wait out the rest of that minute instead
  // of sending another.
  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSent.current) return;
    autoSent.current = true;

    let last = 0;
    try {
      last = Number(sessionStorage.getItem(sentKey) ?? 0);
    } catch {
      // Unreadable storage counts as "never sent".
    }
    const waitMs = 60_000 - (Date.now() - last);
    if (waitMs > 0) {
      setEmailSent(true);
      setCountdown(Math.ceil(waitMs / 1000));
      return;
    }
    void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle><T>Verify your email address</T></CardTitle>
        <CardDescription>
          {emailSent
            ? t("Enter the verification code sent to")
            : t("Click below to receive a verification code at")}{" "}
          <strong>{user.email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmitForm} className="flex flex-col gap-6">
          <div className="grid gap-3">
            <Label htmlFor="verification-code"><T>Verification code</T></Label>
            <Input
              id="verification-code"
              name="verification-code"
              type="text"
              placeholder={t("Enter the 6-digit code")}
              maxLength={6}
              required
              disabled={isSubmitting}
            />
          </div>
          <FormErrorMessage message={errorMessage} />
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t("Verifying...") : t("Verify email")}
          </Button>
        </form>

        <Button
          type="button"
          variant="outline"
          className="w-full mt-4"
          onClick={handleResendCode}
          disabled={countdown > 0}
        >
          {countdown > 0
            ? t("Resend code ({n}s)", { n: countdown })
            : emailSent
            ? t("Resend code")
            : t("Send code")}
        </Button>
      </CardContent>
    </Card>
  );
}

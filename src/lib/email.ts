import "server-only";

import type { GateReviewInvitationAttemptResult } from "./gates";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<GateReviewInvitationAttemptResult>;
}

type ResendResponse = {
  id?: unknown;
};

class ResendEmailTransport implements EmailTransport {
  readonly name = "resend";

  async send(message: EmailMessage): Promise<GateReviewInvitationAttemptResult> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    if (!apiKey || !from) {
      return {
        status: "failed",
        error: {
          code: "email_not_configured",
          message: "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.",
        },
      };
    }

    const recipient = message.to.trim();
    if (!isEmailAddress(recipient)) {
      return {
        status: "failed",
        error: {
          code: "email_recipient_invalid",
          message: "The Gate Review Approver email address is invalid.",
        },
      };
    }
    if (!isValidSender(from)) {
      return {
        status: "failed",
        error: {
          code: "email_sender_invalid",
          message: "EMAIL_FROM must contain a valid sender email address.",
        },
      };
    }
    const idempotencyKey = message.idempotencyKey.trim();
    if (!idempotencyKey) {
      return {
        status: "failed",
        error: {
          code: "email_idempotency_key_missing",
          message: "The invitation delivery identifier is missing.",
        },
      };
    }

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return {
        status: "indeterminate",
        error: {
          code: "email_provider_unreachable",
          message: "The email provider could not be reached. Delivery could not be confirmed.",
        },
      };
    }

    if (!response.ok) {
      const deliveryUncertain = response.status === 408 || response.status >= 500;
      return {
        status: deliveryUncertain ? "indeterminate" : "failed",
        error: {
          code: `email_provider_http_${response.status}`,
          message: deliveryUncertain
            ? `The email provider could not confirm the invitation (HTTP ${response.status}).`
            : `The email provider rejected the invitation (HTTP ${response.status}).`,
        },
      };
    }

    let body: ResendResponse;
    try {
      body = await response.json() as ResendResponse;
    } catch {
      return {
        status: "indeterminate",
        error: {
          code: "email_provider_invalid_response",
          message: "The email provider response could not be verified.",
        },
      };
    }

    if (typeof body.id !== "string" || !body.id) {
      return {
        status: "indeterminate",
        error: {
          code: "email_provider_missing_id",
          message: "The email provider did not confirm the invitation message ID.",
        },
      };
    }

    return { status: "sent", providerMessageId: body.id };
  }
}

const emailTransport: EmailTransport = new ResendEmailTransport();

export function sendEmail(message: EmailMessage) {
  return emailTransport.send(message);
}

function isEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+$/.test(value);
}

function isValidSender(value: string) {
  if (/[\r\n]/.test(value)) return false;
  const bracketedAddress = value.match(/<([^<>]+)>$/)?.[1]?.trim();
  return isEmailAddress(bracketedAddress ?? value);
}

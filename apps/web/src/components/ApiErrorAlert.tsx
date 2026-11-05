import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { EvaluationExplainer } from "./EvaluationExplainer";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Alert } from "./ui/feedback";

/**
 * Shows any error from the API. Access-denied errors get a "Why was this denied?" button that
 * explains the IAM decision step by step.
 */
export function ApiErrorAlert({
  error,
  title,
  className,
}: {
  error: unknown;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!error) return null;

  if (error instanceof ApiError && error.code === "AccessDenied") {
    return (
      <Alert variant="error" title={title ?? "Access denied"} className={className}>
        <p className="break-words">{error.message}</p>
        {error.evaluation && (
          <>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => setOpen(true)}>
              <HelpCircle className="size-4" aria-hidden /> Why was this denied?
            </Button>
            <Dialog
              open={open}
              onOpenChange={setOpen}
              size="lg"
              title="Why was this denied?"
              description="How IAM evaluated your request"
            >
              <EvaluationExplainer evaluation={error.evaluation} />
            </Dialog>
          </>
        )}
      </Alert>
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof ApiError ? error.code : undefined;
  return (
    <Alert variant="error" title={title ?? code ?? "Something went wrong"} className={className}>
      <p className="break-words">{message}</p>
    </Alert>
  );
}

/** True for AccessDenied errors, e.g. to show a friendlier card instead of the data. */
export const isAccessDenied = (error: unknown) =>
  error instanceof ApiError && error.code === "AccessDenied";

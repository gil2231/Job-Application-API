"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, RotateCcw, Send, SkipForward, Trash2 } from "lucide-react";
import type { ApplicationStatus, JobStatus } from "@autoapply/shared";
import { applyToJobsAction, deleteJobsAction, retryJobsAction, skipJobsAction } from "@/actions/jobs";
import { useServerAction } from "@/components/action-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function JobActions({
  jobId,
  applicationId,
  applicationStatus,
  jobStatus,
}: {
  jobId: string;
  applicationId: string | null;
  applicationStatus: ApplicationStatus | null;
  jobStatus: JobStatus;
}) {
  const router = useRouter();
  const { pending, run } = useServerAction();
  const skippable = applicationStatus ? ["QUEUED", "FAILED", "WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"].includes(applicationStatus) : jobStatus !== "SKIPPED";
  return (
    <>
      {applicationId ? (
        <Button asChild variant="outline" size="sm">
          <Link href={`/applications/${applicationId}`}>
            <Eye /> View application
          </Link>
        </Button>
      ) : (
        <Button size="sm" disabled={pending} onClick={() => run(() => applyToJobsAction([jobId]))}>
          <Send /> Apply
        </Button>
      )}
      {applicationStatus === "FAILED" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryJobsAction([jobId]))}>
          <RotateCcw /> Retry
        </Button>
      )}
      {skippable && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => skipJobsAction([jobId]))}>
          <SkipForward /> Skip
        </Button>
      )}
      {applicationStatus !== "PROCESSING" && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" className="text-destructive" disabled={pending}>
              <Trash2 /> Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this job?</AlertDialogTitle>
              <AlertDialogDescription>It will be hidden and won&apos;t be re-imported. A pending application for it is withdrawn.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => run(() => deleteJobsAction([jobId]), { onSuccess: () => router.push("/jobs"), refresh: false })}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

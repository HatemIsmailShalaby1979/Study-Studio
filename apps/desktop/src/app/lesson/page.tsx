import { Suspense } from "react";
import LessonContent from "./LessonContent";

export default function LessonPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center pt-16">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin h-8 w-8 border-[3px] border-primary border-t-transparent rounded-full" />
        <span className="text-sm text-muted animate-pulse">Loading lesson...</span>
      </div>
    </div>}>
      <LessonContent />
    </Suspense>
  );
}

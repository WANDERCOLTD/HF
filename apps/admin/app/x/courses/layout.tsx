import { Suspense } from "react";

export default function CoursesLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}

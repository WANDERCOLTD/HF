import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import DashboardClient from "./_dashboards/DashboardClient";

export default async function XDashboardPage() {
  const session = await auth();
  const role = session?.user?.role;

  // Educator and Student have their own dedicated pages
  if (role === "EDUCATOR") redirect("/x/educator");
  if (role === "STUDENT") redirect("/x/student/progress");

  return <DashboardClient role={role || "DEMO"} />;
}

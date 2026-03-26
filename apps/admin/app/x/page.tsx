import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import DashboardClient from "./_dashboards/DashboardClient";

export default async function XDashboardPage() {
  const session = await auth();
  const role = session?.user?.role;

  // Educator: redirect to dashboard only if they have a TEACHER caller profile,
  // otherwise send to get-started wizard to complete setup first
  if (role === "EDUCATOR") {
    const hasProfile = await prisma.caller.findFirst({
      where: { userId: session!.user.id, role: "TEACHER" },
      select: { id: true },
    });
    redirect(hasProfile ? "/x/educator" : "/x/get-started-v5");
  }

  if (role === "STUDENT") redirect("/x/student/progress");

  return <DashboardClient role={role || "DEMO"} />;
}

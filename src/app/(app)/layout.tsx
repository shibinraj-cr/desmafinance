import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { SideNav } from "@/components/SideNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return (
    <div className="flex min-h-screen bg-surface">
      <SideNav user={{ name: session.user.name, email: session.user.email }} />
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}

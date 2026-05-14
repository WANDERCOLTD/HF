"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useStudentNotifications } from "@/hooks/useStudentNotifications";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const isStudent = session?.user?.role === "STUDENT";

  // Only poll notifications for actual students
  const { hasNew, unreadCount, clearNew } = useStudentNotifications(isStudent);
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    if (hasNew && unreadCount > 0) {
      setToastVisible(true);
      clearNew();
      const timer = setTimeout(() => setToastVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [hasNew, unreadCount, clearNew]);

  return (
    <>
      {children}
      {toastVisible && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--surface-primary)",
            border: "1px solid var(--border-default)",
            color: "var(--text-primary)",
            padding: "10px 20px",
            borderRadius: 8,
            fontSize: 14,
            zIndex: 200,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            animation: "fadeInUp 0.3s ease",
            cursor: "pointer",
          }}
          onClick={() => setToastVisible(false)}
        >
          You have {unreadCount} new study {unreadCount === 1 ? "note" : "notes"}
        </div>
      )}
    </>
  );
}

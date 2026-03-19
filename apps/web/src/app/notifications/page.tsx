"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/firestore";
import type { NotificationDoc, NotificationType } from "@hi/shared";
import Link from "next/link";
import {
  Bell,
  Loader2,
  CheckCheck,
  ClipboardList,
  MessageSquare,
  Users,
  Calendar,
  CreditCard,
  Info,
  Circle,
  KeyRound,
} from "lucide-react";

const TYPE_CONFIG: Record<NotificationType, { icon: typeof Bell; color: string; label: string }> = {
  rfx_new: { icon: ClipboardList, color: "text-indigo-600 bg-indigo-50", label: "New RFx" },
  rfx_response: { icon: MessageSquare, color: "text-blue-600 bg-blue-50", label: "RFx Response" },
  referral: { icon: Users, color: "text-emerald-600 bg-emerald-50", label: "Referral" },
  event_registration: { icon: Calendar, color: "text-purple-600 bg-purple-50", label: "Event" },
  payment: { icon: CreditCard, color: "text-amber-600 bg-amber-50", label: "Payment" },
  system: { icon: Info, color: "text-slate-600 bg-slate-100", label: "System" },
  access_pin_issued: { icon: KeyRound, color: "text-emerald-600 bg-emerald-50", label: "Access Code" },
  access_pin_revoked: { icon: KeyRound, color: "text-red-600 bg-red-50", label: "Access Revoked" },
};

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <NotificationsContent />
    </RequireAuth>
  );
}

function NotificationsContent() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setNotifications(await getNotifications(user.uid));
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleMarkAllRead = async () => {
    if (!user) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsRead(user.uid);
      fetchData();
    } catch (err) {
      console.error("Failed to mark all read:", err);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleMarkRead = async (notifId: string) => {
    try {
      await markNotificationRead(notifId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, read: true } : n))
      );
    } catch (err) {
      console.error("Failed to mark read:", err);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <Bell className="h-8 w-8 text-slate-400" />
              Notifications
            </h1>
            <p className="text-slate-500 mt-1">
              {unreadCount > 0
                ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`
                : "All caught up!"}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-60"
            >
              {markingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              Mark All Read
            </button>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-24">
            <Bell className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-1">No notifications</h2>
            <p className="text-sm text-slate-500">You&apos;re all caught up.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((notif) => {
              const cfg = TYPE_CONFIG[notif.type] || TYPE_CONFIG.system;
              const Icon = cfg.icon;
              const timeAgo = getTimeAgo(notif.createdAt);

              const content = (
                <div
                  className={`p-4 rounded-xl ring-1 transition-all ${
                    notif.read
                      ? "bg-white ring-slate-200"
                      : "bg-white ring-slate-300 shadow-sm"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${cfg.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 line-clamp-1">
                          {notif.title}
                        </span>
                        {!notif.read && (
                          <Circle className="h-2 w-2 fill-indigo-500 text-indigo-500 shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                        {notif.body}
                      </p>
                      <span className="text-[10px] text-slate-400 mt-1 block">{timeAgo}</span>
                    </div>
                    {!notif.read && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleMarkRead(notif.id); }}
                        className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium shrink-0 mt-1"
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </div>
              );

              if (notif.linkTo) {
                return (
                  <Link key={notif.id} href={notif.linkTo} onClick={() => !notif.read && handleMarkRead(notif.id)}>
                    {content}
                  </Link>
                );
              }
              return <div key={notif.id}>{content}</div>;
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

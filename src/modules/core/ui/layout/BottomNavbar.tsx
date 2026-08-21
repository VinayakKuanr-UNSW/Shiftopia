import React, { useState, useEffect, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Calendar,
  Fingerprint,
  CalendarDays,
  BadgeCheck,
  RefreshCw,
  Radio,
  BellRing,
  Menu,
  X,
  Gavel,
  ArrowLeftRight,
  ClipboardList,
  LayoutTemplate,
  LayoutGrid,
  Megaphone,
  BarChart3,
  Grid3x3,
  Users,
  ShieldCheck,
  Settings,
  LogOut,
  Moon,
  Sun,
  Palmtree,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/modules/core/lib/utils";
import { text, touch } from "@/modules/core/ui/typography";
import { motion, AnimatePresence } from "framer-motion";
import {
  useEmployeeBroadcastGroups,
  useBroadcastNotifications,
} from "@/modules/broadcasts/state/useBroadcasts";
import { useAuth } from "@/platform/auth/useAuth";
import { useTheme } from "@/modules/core/contexts/ThemeContext";

type MoreNavPermission =
  | "my-broadcasts"
  | "rosters"
  | "management"
  | "timesheet-view"
  | "templates"
  | "broadcast"
  | "insights"
  | "users";

type BottomNavItem = {
  label: string;
  icon: LucideIcon;
  path: string;
  badgeKey?: "broadcasts" | "notifications";
  requiredPermission?: MoreNavPermission;
};

type MoreNavItem = {
  label: string;
  Icon: LucideIcon;
  path: string;
  requiredPermission?: MoreNavPermission;
};

const activeIndicatorClasses =
  "absolute inset-0 rounded-full bg-foreground shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_12px_rgba(255,255,255,0.05)]";

const activeIndicatorTransition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
} as const;

const middleItems: BottomNavItem[] = [
  { label: "Roster", icon: Calendar, path: "/my-roster" },
  { label: "Atten", icon: Fingerprint, path: "/my-attendance" },
  { label: "Avail", icon: CalendarDays, path: "/my-availabilities" },
  { label: "Bids", icon: BadgeCheck, path: "/my-bids" },
  { label: "Swaps", icon: RefreshCw, path: "/my-swaps" },
  {
    label: "Radio",
    icon: Radio,
    path: "/my-broadcasts",
    badgeKey: "broadcasts",
    requiredPermission: "my-broadcasts",
  },
  { label: "Leave", icon: Palmtree, path: "/my-leave" },
  {
    label: "Notif",
    icon: BellRing,
    path: "/my-notifications",
    badgeKey: "notifications",
  },
];

const visibleItems = middleItems.slice(0, 4);

const workspaceMoreItems: MoreNavItem[] = middleItems
  .slice(4)
  .map(({ label, icon: Icon, path, requiredPermission }) => ({
    label,
    Icon,
    path,
    requiredPermission,
  }));

const toolMoreItems: MoreNavItem[] = [
  { label: "Rosters", Icon: LayoutGrid, path: "/rosters", requiredPermission: "rosters" },
  { label: "Manager Bids", Icon: Gavel, path: "/management/bids", requiredPermission: "management" },
  { label: "Manager Swaps", Icon: ArrowLeftRight, path: "/management/swaps", requiredPermission: "management" },
  { label: "Timesheets", Icon: ClipboardList, path: "/timesheet", requiredPermission: "timesheet-view" },
  { label: "Templates", Icon: LayoutTemplate, path: "/templates", requiredPermission: "templates" },
  { label: "Broadcast", Icon: Megaphone, path: "/broadcast", requiredPermission: "broadcast" },
  { label: "Insights", Icon: BarChart3, path: "/insights", requiredPermission: "insights" },
  // Replaced the old "Grid" entry. Same matrix, now inside the Availability
  // Manager and with a phone composition, so it is allowlisted again.
  // `requiredPermission` takes one value; the route itself admits `insights`
  // too, and those users reach it from the sidebar.
  // "Avail" above is the employee's own availability; this is the team's.
  { label: "Team Avail", Icon: CalendarDays, path: "/team-availability", requiredPermission: "management" },
  { label: "Users", Icon: Users, path: "/users", requiredPermission: "users" },
  { label: "Settings", Icon: Settings, path: "/settings" },
  { label: "Leave Mgmt", Icon: Palmtree, path: "/management/leave", requiredPermission: "management" },
];

const moreItems = [...workspaceMoreItems, ...toolMoreItems];

const MobileNavItem = ({
  item,
  badgeCount,
}: {
  item: BottomNavItem;
  badgeCount: number;
}) => (
  <NavLink
    to={item.path}
    aria-label={item.label}
    className={({ isActive }) =>
      cn(
        "relative flex items-center justify-center h-full min-h-11 rounded-full transition-all duration-300 ease-out flex-shrink-0 overflow-hidden",
        isActive
          ? "text-background px-4 max-w-[160px] nav-item-active"
          : "w-[52px] max-w-[52px] px-0 text-muted-foreground hover:bg-muted/50",
      )
    }
  >
    {({ isActive }) => {
      return (
        <>
          {isActive && (
            <motion.span
              layoutId="bottom-nav-active-indicator"
              className={activeIndicatorClasses}
              transition={activeIndicatorTransition}
            />
          )}

          <div className="relative z-10 flex items-center gap-2">
            <div className="relative">
              <item.icon
                className={cn(
                  "h-6 w-6 flex-shrink-0 transition-colors",
                  isActive ? "text-background" : "text-muted-foreground",
                )}
                strokeWidth={isActive ? 2.4 : 1.9}
                aria-hidden="true"
              />
              {badgeCount > 0 && (
                <span
                  className={cn(
                    "absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-none font-bold tabular-nums border-2",
                    isActive
                      ? "bg-red-500 text-white border-foreground"
                      : "bg-red-500 text-white border-card",
                  )}
                >
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </div>

            <div
              className={cn(
                "overflow-hidden transition-all duration-300 ease-out flex items-center",
                isActive ? "max-w-[100px] opacity-100" : "max-w-0 opacity-0",
              )}
            >
              <span className={cn(text.overlineBare, "whitespace-nowrap pt-[1px] block")}>
                {item.label}
              </span>
            </div>
          </div>
        </>
      );
    }}
  </NavLink>
);

const BottomNavbar: React.FC = () => {
  const [moreOpen, setMoreOpen] = useState(false);
  // Two-step confirm for sign-out; reset whenever the drawer closes.
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [isBottomDrawerActive, setIsBottomDrawerActive] = useState(false);
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    const checkDrawer = () => {
      const activeElements = document.querySelectorAll(
        '[data-state="open"], [data-vaul-drawer], [data-hide-bottom-nav="true"]',
      );
      let found = false;

      activeElements.forEach((el) => {
        const className = el.className || "";
        const hasBottomClass =
          typeof className === "string" &&
          (className.includes("bottom-0") ||
            className.includes("slide-in-from-bottom") ||
            className.includes("inset-x-0"));
        const isVaulDrawer =
          el.hasAttribute("data-vaul-drawer") ||
          el.closest("[data-vaul-drawer]") !== null;
        const explicitlyHidesBottomNav = el.getAttribute("data-hide-bottom-nav") === "true";

        if (hasBottomClass || isVaulDrawer || explicitlyHidesBottomNav) {
          found = true;
        }
      });

      setIsBottomDrawerActive(found);
    };

    checkDrawer();

    const observer = new MutationObserver(() => {
      checkDrawer();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "class", "data-vaul-drawer", "data-hide-bottom-nav"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (isBottomDrawerActive) {
      setMoreOpen(false);
    }
  }, [isBottomDrawerActive]);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  // Never leave the drawer armed — reopening it should not be one tap away
  // from ending the session.
  useEffect(() => {
    if (!moreOpen) setConfirmSignOut(false);
  }, [moreOpen]);

  // UNREAD COUNTS INTEGRATION
  const { logout, hasPermission } = useAuth();
  const { groups: broadcastGroups } = useEmployeeBroadcastGroups();
  const { unreadCount: notificationsUnread } = useBroadcastNotifications();

  const broadcastsUnread = useMemo(
    () => broadcastGroups.reduce((acc, g) => acc + (g.unreadCount || 0), 0),
    [broadcastGroups],
  );

  const getBadgeCount = (key?: string) => {
    if (key === "broadcasts") return broadcastsUnread;
    if (key === "notifications") return notificationsUnread;
    return 0;
  };

  const accessibleMoreItems = moreItems.filter(
    (item) => !item.requiredPermission || hasPermission(item.requiredPermission),
  );

  const isMoreRouteActive = accessibleMoreItems.some((item) =>
    location.pathname.startsWith(item.path),
  );

  return (
    <>
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            key="more-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[58] bg-background/40 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {moreOpen && (
          <motion.div
            key="more-panel"
            initial={{ opacity: 0, y: 30, scale: 0.95, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 20, scale: 0.95, filter: "blur(10px)" }}
            transition={{
              default: { type: "spring", damping: 25, stiffness: 350 },
              filter: { type: "tween", duration: 0.2, ease: "easeOut" },
            }}
            className="fixed bottom-[calc(var(--mobile-bottom-nav-clearance,90px)+20px)] left-[calc(env(safe-area-inset-left,0px)+1rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)] z-[59] rounded-[32px] bg-card/80 backdrop-blur-3xl border border-white/20 dark:border-white/10 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.3)] overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-white/0 dark:from-white/10 dark:to-white/0 pointer-events-none" />
            <div className="relative p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className={cn(text.overline, "ml-1")}>
                  Management &amp; Tools
                </h3>
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
                  className={cn(
                    text.overlineBare,
                    touch.target,
                    "flex items-center gap-2 rounded-2xl border border-border/50 bg-background/70 px-3 text-foreground shadow-sm transition-transform active:scale-95",
                  )}
                >
                  {isDark ? (
                    <Sun className="h-5 w-5 text-amber-500" aria-hidden="true" />
                  ) : (
                    <Moon className="h-5 w-5 text-indigo-500" aria-hidden="true" />
                  )}
                  <span>{isDark ? "Light" : "Dark"}</span>
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {accessibleMoreItems.map(({ label, Icon, path }) => {
                  const isActive = location.pathname.startsWith(path);
                  return (
                    <NavLink
                      key={path}
                      to={path}
                      className={({ isActive }) =>
                        cn(
                          "flex min-h-[76px] flex-col items-center justify-center gap-2 p-3.5 rounded-2xl transition-colors duration-200",
                          isActive
                            ? "bg-foreground text-background shadow-lg"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                        )
                      }
                    >
                      <Icon
                        className="h-7 w-7"
                        strokeWidth={isActive ? 2.3 : 1.9}
                        aria-hidden="true"
                      />
                      <span
                        className={cn(
                          text.overlineBare,
                          "text-center leading-tight",
                          isActive ? "text-background" : "text-muted-foreground",
                        )}
                      >
                        {label}
                      </span>
                    </NavLink>
                  );
                })}
              </div>

              {/* Sign out. Every other entry here is a route; this is the one
                  action, so it sits apart and asks once before committing —
                  a mis-tap in a grid of navigation should not end the session.

                  It exists at all because the only sign-out in the app was in
                  the desktop sidebar, and Navbar.tsx — which has one in a
                  profile dropdown — is rendered nowhere. On a phone there was
                  no way to leave an account short of clearing app data. */}
              <button
                type="button"
                onClick={() => {
                  if (!confirmSignOut) {
                    setConfirmSignOut(true);
                    return;
                  }
                  setMoreOpen(false);
                  setConfirmSignOut(false);
                  void logout();
                }}
                className={cn(
                  text.label,
                  "mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border uppercase transition-colors active:scale-[0.98]",
                  confirmSignOut
                    ? "border-rose-500/50 bg-rose-500/15 text-rose-500"
                    : "border-border/50 bg-background/70 text-muted-foreground hover:text-foreground",
                )}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>{confirmSignOut ? "Tap again to confirm" : "Sign out"}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

        <motion.nav
          initial={{ y: 100, opacity: 0 }}
          animate={{
            y: isBottomDrawerActive ? 120 : 0,
            opacity: isBottomDrawerActive ? 0 : 1,
          }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          style={{ pointerEvents: isBottomDrawerActive ? "none" : "auto" }}
          className="md:hidden fixed bottom-[var(--mobile-bottom-nav-offset,calc(env(safe-area-inset-bottom,0px)+1.5rem))] left-[calc(env(safe-area-inset-left,0px)+1rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)] z-[60] h-[var(--mobile-bottom-nav-height,72px)] bg-background/80 dark:bg-black/60 backdrop-blur-3xl border border-white/20 dark:border-white/10 shadow-[0_24px_40px_-10px_rgba(0,0,0,0.3)] rounded-[36px] flex items-center p-2 gap-2 overflow-hidden"
        >
          <div className="flex-1 h-full min-w-0 flex items-center justify-around px-2 relative">
            {visibleItems.map((item) => (
              <MobileNavItem
                key={item.path}
                item={item}
                badgeCount={getBadgeCount(item.badgeKey)}
              />
            ))}
          </div>

          {/* DIVIDER */}
          <div className="w-px h-8 bg-border/40 rounded-full flex-shrink-0 mx-0.5" />

          {/* MORE TOGGLE (Pinned Right - Fixed Width) */}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            aria-label={
              moreOpen ? "Close more navigation" : "Open more navigation"
            }
            aria-expanded={moreOpen}
            className={cn(
              "relative flex items-center justify-center h-full min-h-11 w-[52px] rounded-full transition-colors duration-200 flex-shrink-0 z-10 overflow-hidden",
              moreOpen || isMoreRouteActive
                ? "text-background"
                : "bg-card text-foreground shadow-sm hover:bg-muted",
            )}
          >
            {isMoreRouteActive && (
              <motion.span
                layoutId="bottom-nav-active-indicator"
                className={activeIndicatorClasses}
                transition={activeIndicatorTransition}
              />
            )}
            {moreOpen && !isMoreRouteActive && (
              <span className={activeIndicatorClasses} />
            )}
            <AnimatePresence mode="wait" initial={false}>
              {moreOpen ? (
                <motion.span
                  key="close"
                  initial={{ opacity: 0, rotate: -45, scale: 0.75 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 45, scale: 0.75 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="relative z-10"
                >
                  <X className="h-6 w-6" strokeWidth={2.3} aria-hidden="true" />
                </motion.span>
              ) : (
                <motion.span
                  key="menu"
                  initial={{ opacity: 0, rotate: 45, scale: 0.75 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: -45, scale: 0.75 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="relative z-10"
                >
                  <Menu
                    className="h-6 w-6"
                    strokeWidth={isMoreRouteActive ? 2.3 : 1.9}
                    aria-hidden="true"
                  />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </motion.nav>
      </>
    );
  };

export default BottomNavbar;

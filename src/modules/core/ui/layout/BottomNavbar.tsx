import React, { useState, useEffect, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ArrowLeftRight,
  BadgeCheck,
  BarChart3,
  BellRing,
  Briefcase,
  Calendar,
  CalendarDays,
  ClipboardList,
  Fingerprint,
  Gavel,
  Grid3x3,
  LayoutGrid,
  LayoutTemplate,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  Palmtree,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
  TrendingUp,
  UserRound,
  Users,
  X,
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
import { usePersona } from "@/platform/auth/PersonaProvider";
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

/**
 * The mobile nav is split by persona, the same way the sidebar is. A phone has
 * four tab slots and one drawer, so mixing an employee's "My Roster" with a
 * manager's "Timesheets" in one undifferentiated list cost more here than it
 * did on the desktop: the four most valuable slots on the screen were always
 * spent on employee pages, whichever hat the user was wearing.
 *
 * Employer entries all carry a `requiredPermission` and are filtered BEFORE the
 * first four are taken, so a user who holds only `insights` gets KPI in a tab
 * rather than three inaccessible tabs and one real one.
 *
 * Every path below is in ALLOWED_MOBILE_ROUTES, so no tab can land on the
 * Desktop Only screen — which is exactly what the Leave button used to do.
 */
const employeeItems: BottomNavItem[] = [
  { label: "Roster", icon: Calendar, path: "/my-roster" },
  { label: "Avail", icon: CalendarDays, path: "/my-availabilities" },
  // "Requests" is one slot for the bids/swaps pair. Bids is the entry point;
  // Swaps sits beside it in More rather than spending a second tab on a pair.
  { label: "Requests", icon: BadgeCheck, path: "/my-bids" },
  { label: "Leave", icon: Palmtree, path: "/my-leave" },
  { label: "Swaps", icon: RefreshCw, path: "/my-swaps" },
  { label: "Atten", icon: Fingerprint, path: "/my-attendance" },
  { label: "Performance", icon: TrendingUp, path: "/performance" },
  {
    label: "Radio",
    icon: Radio,
    path: "/my-broadcasts",
    badgeKey: "broadcasts",
    requiredPermission: "my-broadcasts",
  },
];

/** Manager surfaces, in tab-priority order. All permission-gated. */
const employerItems: BottomNavItem[] = [
  { label: "Roster", icon: LayoutGrid, path: "/rosters", requiredPermission: "rosters" },
  // The team's availability, not the user's own.
  { label: "Team", icon: CalendarDays, path: "/team-availability", requiredPermission: "management" },
  { label: "Requests", icon: Gavel, path: "/management/bids", requiredPermission: "management" },
  // A destination in its own right, and more useful held permanently than
  // Broadcast or Compliance, which sit comfortably in More.
  { label: "Insights", icon: BarChart3, path: "/insights", requiredPermission: "insights" },
  { label: "Swaps", icon: ArrowLeftRight, path: "/management/swaps", requiredPermission: "management" },
  { label: "Leave Appr", icon: Palmtree, path: "/management/leave", requiredPermission: "management" },
  { label: "Templates", icon: LayoutTemplate, path: "/templates", requiredPermission: "templates" },
  { label: "New Shift", icon: Plus, path: "/rosters/shift/new", requiredPermission: "rosters" },
  { label: "Demand", icon: TrendingUp, path: "/labor-demand", requiredPermission: "rosters" },
  { label: "Times", icon: ClipboardList, path: "/timesheet", requiredPermission: "timesheet-view" },
  { label: "Broadcast", icon: Megaphone, path: "/broadcast", requiredPermission: "broadcast" },
  { label: "Compliance", icon: ShieldAlert, path: "/compliance/rejections", requiredPermission: "management" },
  { label: "Users", icon: Users, path: "/users", requiredPermission: "users" },
  // /management/payroll is deliberately ABSENT. It is in the router but NOT in
  // ALLOWED_MOBILE_ROUTES, so a tab or drawer entry for it would land on the
  // Desktop Only screen — the same failure the Leave button used to have.
  // Allowlisting a wide payroll table is a design decision, not a nav one.
];

/**
 * Reachable from either persona, because none of them is persona work.
 * Notifications is workspace-wide; Profile, Settings and Search belong to the
 * application. Hiding any of them behind the toggle would strand it.
 */
const sharedMoreItems: MoreNavItem[] = [
  { label: "Notif", Icon: BellRing, path: "/my-notifications" },
  { label: "Profile", Icon: UserRound, path: "/profile" },
  { label: "Settings", Icon: Settings, path: "/settings" },
  { label: "Search", Icon: Search, path: "/search" },
];

const toMoreItem = ({ label, icon: Icon, path, requiredPermission }: BottomNavItem): MoreNavItem => ({
  label,
  Icon,
  path,
  requiredPermission,
});

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
  const { persona, canSwitch, togglePersona } = usePersona();
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

  // Filter BEFORE slicing: an employer holding only `insights` must get KPI in
  // a tab, not three dead tabs and one real one.
  const accessiblePersonaItems = useMemo(() => {
    const source = persona === "employer" ? employerItems : employeeItems;
    return source.filter(
      (item) => !item.requiredPermission || hasPermission(item.requiredPermission),
    );
  }, [persona, hasPermission]);

  const visibleItems = accessiblePersonaItems.slice(0, 4);

  const accessibleMoreItems = useMemo(
    () => [
      ...accessiblePersonaItems.slice(4).map(toMoreItem),
      ...sharedMoreItems.filter(
        (item) => !item.requiredPermission || hasPermission(item.requiredPermission),
      ),
    ],
    [accessiblePersonaItems, hasPermission],
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
                  {persona === "employer" ? "Management & Tools" : "My Workspace"}
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

              {/* The only way to change persona on a phone — there is no
                  sidebar here. It sits directly above Sign out rather than
                  above the grid: both are ACTIONS on the session, not routes,
                  so they belong together beneath the destinations. Labelled
                  with the destination rather than the current state, and the
                  accessible name is the visible text verbatim (SC 2.5.3). */}
              {canSwitch && (
                <button
                  type="button"
                  onClick={() => {
                    togglePersona();
                    setMoreOpen(false);
                  }}
                  aria-label={
                    persona === "employee"
                      ? "Switch to employer view"
                      : "Switch to employee view"
                  }
                  className={cn(
                    touch.target,
                    "mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-border/50 bg-background/70 px-3 text-foreground shadow-sm transition-transform active:scale-95",
                  )}
                >
                  {persona === "employee" ? (
                    <Briefcase className="h-5 w-5 text-indigo-500" aria-hidden="true" />
                  ) : (
                    <UserRound className="h-5 w-5 text-emerald-500" aria-hidden="true" />
                  )}
                  <span className={text.overlineBare}>
                    {persona === "employee"
                      ? "Switch to employer view"
                      : "Switch to employee view"}
                  </span>
                </button>
              )}

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

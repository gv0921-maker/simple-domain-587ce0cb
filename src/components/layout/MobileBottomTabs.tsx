import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Home, Clock, MessageCircle, CheckSquare, Menu, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessRoute } from "@/lib/services/settings";
import glfLogo from "@/assets/glf-logo.png";

const MODULES: { label: string; href: string }[] = [
  { label: "Home", href: "/" },
  { label: "Inventory", href: "/inventory" },
  { label: "Sales", href: "/sales" },
  { label: "Barcode", href: "/barcode" },
  { label: "Manufacturing", href: "/manufacturing" },
  { label: "Invoices", href: "/invoicing" },
  { label: "CRM", href: "/crm" },
  { label: "Employees", href: "/employees" },
  { label: "Attendance", href: "/attendance/clock-in" },
  { label: "Leave", href: "/leave/my-leaves" },
  { label: "Payroll", href: "/payroll" },
  { label: "Appraisals", href: "/appraisals" },
  { label: "Chat", href: "/chat" },
  { label: "Settings", href: "/settings" },
];

export function MobileBottomTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? location.pathname === "/" : location.pathname.startsWith(href);

  const tabs = [
    { label: "Home", href: "/", icon: Home },
    { label: "Clock", href: "/attendance/clock-in", icon: Clock },
    { label: "Chat", href: "/chat", icon: MessageCircle },
    { label: "Tasks", href: "/leave/my-leaves", icon: CheckSquare },
  ];

  const visibleModules = MODULES.filter((m) =>
    user ? canAccessRoute(user.id, m.href) : false,
  );

  return (
    <>
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Bottom navigation"
      >
        <ul className="grid grid-cols-5">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = isActive(t.href);
            return (
              <li key={t.href}>
                <Link
                  to={t.href}
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] min-h-[56px]",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="w-full flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] min-h-[56px] text-muted-foreground"
                >
                  <Menu className="h-5 w-5" />
                  More
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 p-0 flex flex-col">
                <SheetHeader className="p-4 border-b">
                  <SheetTitle className="flex items-center gap-2">
                    <img src={glfLogo} alt="GLF" className="h-8 w-8 rounded-full object-contain" />
                    <span>GLF ERP</span>
                  </SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-auto p-2 space-y-1">
                  {visibleModules.map((m) => (
                    <Button
                      key={m.href}
                      variant="ghost"
                      className="w-full justify-start min-h-[44px]"
                      onClick={() => {
                        setOpen(false);
                        navigate(m.href);
                      }}
                    >
                      {m.label}
                    </Button>
                  ))}
                </div>
                <div className="border-t p-2 space-y-1">
                  {user && canAccessRoute(user.id, "/settings") && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start min-h-[44px]"
                      onClick={() => {
                        setOpen(false);
                        navigate("/settings");
                      }}
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="w-full justify-start min-h-[44px] text-destructive"
                    onClick={async () => {
                      setOpen(false);
                      await logout();
                      navigate("/login");
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </li>
        </ul>
      </nav>
      {/* Spacer so page content isn't hidden behind the bar */}
      <div className="md:hidden h-16" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-hidden />
    </>
  );
}
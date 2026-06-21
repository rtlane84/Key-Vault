import { Link, useLocation } from "wouter";
import { Package, ShoppingCart, ListTree, Activity, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { label: "Dashboard", href: "/", icon: Activity },
    { label: "Products", href: "/products", icon: Package },
    { label: "Orders", href: "/orders", icon: ShoppingCart },
    { label: "Logs", href: "/logs", icon: ListTree },
    { label: "eBay Sync", href: "/ebay", icon: Settings },
  ];

  return (
    <aside className="w-64 bg-card border-r border-border h-screen flex flex-col fixed left-0 top-0">
      <div className="h-16 flex items-center px-6 border-b border-border">
        <h1 className="text-primary font-bold text-lg tracking-wider uppercase">EBAY KEY OPS</h1>
      </div>
      <nav className="flex-1 py-4 flex flex-col gap-1 px-3">
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-border">
        <div className="text-xs text-muted-foreground font-mono">v1.0.4-rc2</div>
      </div>
    </aside>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background dark text-foreground">
      <Sidebar />
      <main className="ml-64 p-8 min-h-screen">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

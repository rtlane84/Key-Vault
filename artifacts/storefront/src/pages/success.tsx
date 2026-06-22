import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Mail, ArrowRight, Zap, Package } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SuccessPage() {
  const [, navigate] = useLocation();
  const [countdown, setCountdown] = useState(10);

  // Parse session_id from URL for display
  const sessionId = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("session_id")
    : null;

  // Auto-redirect back to store after countdown
  useEffect(() => {
    if (countdown <= 0) {
      navigate("/");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      {/* Background accent */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="w-full max-w-md text-center">
        {/* Success icon */}
        <div className="relative inline-flex mb-8">
          <div className="w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400" />
          </div>
          <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-primary" />
          </div>
        </div>

        <h1 className="text-3xl font-bold text-foreground mb-3">
          Order Confirmed!
        </h1>
        <p className="text-muted-foreground text-lg mb-2">
          Your payment was successful.
        </p>
        <p className="text-muted-foreground">
          Your license key is on its way — check your inbox now.
        </p>

        {/* Steps */}
        <div className="mt-8 bg-card border border-card-border rounded-xl p-6 text-left space-y-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">What happens next</h3>
          {[
            { icon: Mail, label: "Check your email", desc: "Your license key is being delivered to your inbox right now." },
            { icon: Package, label: "Activate your product", desc: "Use the key to activate your software. Instructions included." },
            { icon: Zap, label: "You're all set!", desc: "Enjoy your purchase. Reply to the email if you need support." },
          ].map(({ icon: Icon, label, desc }, i) => (
            <div key={label} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <Icon className="w-3.5 h-3.5 text-primary" />
                </div>
                {i < 2 && <div className="w-px flex-1 bg-border/60 mt-2 mb-1" />}
              </div>
              <div className="pt-1 pb-2">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Session ID for reference */}
        {sessionId && (
          <div className="mt-4 bg-muted/30 border border-border/40 rounded-lg px-4 py-2.5 text-xs text-muted-foreground text-left">
            <span className="font-medium">Order ref:</span>{" "}
            <code className="font-mono text-xs">{sessionId.slice(0, 24)}…</code>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3">
          <Button size="lg" className="w-full" onClick={() => navigate("/")}>
            Back to Store
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
          <p className="text-xs text-muted-foreground">
            Redirecting to store in {countdown}s
          </p>
        </div>
      </div>
    </div>
  );
}

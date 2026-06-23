import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Search, Package, Zap, ArrowLeft, Key, Calendar, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { setBaseUrl, customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
setBaseUrl(apiUrl);

interface OrderLookupResult {
  status: 'pending' | 'paid' | 'fulfilled' | 'failed' | 'refunded';
  productName: string;
  quantity: number;
  keys: string[] | null;
  activationInstructions: string | null;
  fulfilledAt: string | null;
  createdAt: string;
}

export default function LookupPage() {
  const [email, setEmail] = useState("");
  const [reference, setReference] = useState("");
  const [searchParams, setSearchParams] = useState<{ email: string; reference: string } | null>(null);

  const { data: order, isLoading, error } = useQuery<OrderLookupResult>({
    queryKey: ["order-lookup", searchParams?.email, searchParams?.reference],
    queryFn: async () => {
      if (!searchParams) throw new Error("No search params");
      return customFetch<OrderLookupResult>(`/orders/lookup?email=${encodeURIComponent(searchParams.email)}&reference=${encodeURIComponent(searchParams.reference)}`);
    },
    enabled: !!searchParams,
    retry: false,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim() && reference.trim()) {
      setSearchParams({ email: email.trim(), reference: reference.trim() });
    }
  };

  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (searchParams) setSearchParams(null);
  };

  const handleReferenceChange = (val: string) => {
    setReference(val);
    if (searchParams) setSearchParams(null);
  };

  const statusMap = {
    pending: { label: "Payment Pending", icon: Loader2, color: "text-amber-400 bg-amber-400/10" },
    paid: { label: "Processing", icon: Loader2, color: "text-blue-400 bg-blue-400/10" },
    fulfilled: { label: "Delivered", icon: CheckCircle2, color: "text-emerald-400 bg-emerald-400/10" },
    failed: { label: "Needs Attention", icon: AlertCircle, color: "text-red-400 bg-red-400/10" },
    refunded: { label: "Refunded", icon: ArrowLeft, color: "text-muted-foreground bg-muted" },
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer">
              <Zap className="w-4 h-4 text-primary" />
              <span className="font-bold text-foreground">KeyVault</span>
            </div>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-muted-foreground gap-2">
              <ArrowLeft className="w-4 h-4" />
              Store
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-3">Track Your Order</h1>
          <p className="text-muted-foreground">
            Enter your email and order reference to view your license keys and status.
          </p>
        </div>

        <Card className="mb-8">
          <CardContent className="pt-6">
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Email Address</label>
                  <Input 
                    type="email" 
                    placeholder="you@example.com" 
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Order Reference</label>
                  <Input 
                    placeholder="Order ID or Checkout ID" 
                    value={reference}
                    onChange={(e) => handleReferenceChange(e.target.value)}
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full gap-2" disabled={isLoading}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Look Up Order
              </Button>
            </form>
          </CardContent>
        </Card>

        {error && (
          <div className="p-4 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400 text-sm text-center mb-8">
            Order not found. Please check your details and try again.
          </div>
        )}

        {order && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Card className="overflow-hidden border-primary/20">
              <div className={`h-1.5 w-full ${statusMap[order.status].color.split(' ')[1]}`} />
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline" className={`gap-1.5 ${statusMap[order.status].color}`}>
                    {(() => {
                      const Icon = statusMap[order.status].icon;
                      return <Icon className={`w-3.5 h-3.5 ${order.status === 'paid' ? 'animate-spin' : ''}`} />;
                    })()}
                    {statusMap[order.status].label}
                  </Badge>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(order.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <CardTitle className="text-xl">{order.productName}</CardTitle>
                <CardDescription>
                  Quantity: {order.quantity} {order.quantity > 1 ? 'items' : 'item'}
                </CardDescription>
              </CardHeader>
              
              {order.status === 'fulfilled' && order.keys && (
                <CardContent className="space-y-6">
                  <Separator />
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Key className="w-4 h-4 text-primary" />
                      Your License Keys
                    </h3>
                    <div className="grid gap-2">
                      {order.keys.map((key, i) => (
                        <div key={i} className="p-3 bg-muted/50 border border-border rounded-lg font-mono text-center text-primary font-bold">
                          {key}
                        </div>
                      ))}
                    </div>
                  </div>

                  {order.activationInstructions && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        How to Activate
                      </h3>
                      <div className="p-4 bg-primary/5 border border-primary/10 rounded-lg text-sm text-foreground whitespace-pre-line leading-relaxed">
                        {order.activationInstructions}
                      </div>
                    </div>
                  )}
                  
                  <div className="p-3 bg-emerald-400/10 border border-emerald-400/20 rounded-lg flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <p className="text-xs text-emerald-400">
                      This order was fulfilled on {new Date(order.fulfilledAt!).toLocaleString()}. A copy of these keys was also sent to your email.
                    </p>
                  </div>
                </CardContent>
              )}

              {order.status === 'pending' && (
                <CardContent>
                  <Separator className="mb-6" />
                  <div className="text-center py-6 text-muted-foreground">
                    <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin opacity-20" />
                    <p className="text-sm">We are waiting for payment confirmation from Stripe.</p>
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

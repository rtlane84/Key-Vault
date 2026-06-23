import { setBaseUrl, customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Package, Zap, Shield, Clock, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

// Ensure base URL is set (it's also set in main.tsx)
const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5001/api";
setBaseUrl(apiUrl);

interface PublicProduct {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  price: number;
  imageUrl: string | null;
  category: string | null;
  stripePriceId: string | null;
  activationInstructions: string | null;
  availableKeyCount: number;
}

interface PublicTenant {
  id: number;
  name: string;
  slug: string;
  supportEmail: string | null;
}

function formatPrice(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function ProductPage() {
  const { tenantSlug, slug: productSlug } = useParams<{ tenantSlug?: string; slug: string }>();
  const [, navigate] = useLocation();

  const { data: tenant } = useQuery<PublicTenant | null>({
    queryKey: ["/public/tenants", tenantSlug],
    queryFn: async () => {
      if (!tenantSlug) return null;
      try {
        return await customFetch<PublicTenant>(`/public/tenants/${tenantSlug}`);
      } catch (err) {
        console.error("Tenant not found", err);
        return null;
      }
    },
    enabled: !!tenantSlug,
  });

  const { data: product, isLoading, error } = useQuery<PublicProduct>({
    queryKey: ["product", tenantSlug, productSlug],
    queryFn: async () => {
      try {
        if (!tenantSlug) throw new Error("No tenant slug");
        return await customFetch<PublicProduct>(`/public/tenants/${tenantSlug}/products/${encodeURIComponent(productSlug)}`);
      } catch (err: any) {
        if (err.status === 404) throw new Error("not_found");
        throw err;
      }
    },
    enabled: !!tenantSlug,
    retry: false,
  });

  const checkoutMutation = useMutation({
    mutationFn: async (productId: number) => {
      const origin = window.location.origin;
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const successUrl = tenantSlug 
        ? `${origin}${base}/s/${tenantSlug}/success?session_id={CHECKOUT_SESSION_ID}`
        : `${origin}${base}/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = tenantSlug
        ? `${origin}${base}/s/${tenantSlug}/product/${productSlug}`
        : `${origin}${base}/product/${productSlug}`;

      return customFetch<{ url: string }>("/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({
          productId,
          successUrl,
          cancelUrl,
        }),
      });
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-5 w-20" />
          </div>
        </header>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 grid md:grid-cols-2 gap-8">
          <Skeleton className="aspect-square rounded-xl" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-full mt-4" />
          </div>
        </div>
      </div>
    );
  }

  if (error?.message === "not_found" || !product) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center py-16 px-4">
          <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
          <h1 className="text-xl font-semibold text-foreground mb-2">Product Not Found</h1>
          <p className="text-muted-foreground mb-6">This product doesn't exist or is no longer available.</p>
          <Button variant="outline" onClick={() => navigate(tenantSlug ? `/s/${tenantSlug}` : "/")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Store
          </Button>
        </div>
      </div>
    );
  }

  const inStock = product.availableKeyCount > 0;
  const canBuy = inStock && !!product.stripePriceId;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <button
            onClick={() => navigate(tenantSlug ? `/s/${tenantSlug}` : "/")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Store
          </button>
          <span className="text-border/60">|</span>
          <span className="text-sm text-foreground truncate">{product.name}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-start">
          {/* Image */}
          <div className="aspect-square rounded-xl overflow-hidden bg-card border border-card-border flex items-center justify-center">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Package className="w-16 h-16 opacity-20" />
                <span className="text-sm">Digital Product</span>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col gap-5">
            <div>
              {product.category && (
                <Badge variant="secondary" className="mb-3 text-xs">{product.category}</Badge>
              )}
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight">{product.name}</h1>
              {product.shortDescription && (
                <p className="mt-2 text-muted-foreground">{product.shortDescription}</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold text-foreground">{formatPrice(product.price)}</span>
              {inStock ? (
                <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  In Stock
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  Out of Stock
                </span>
              )}
            </div>

            {product.description && (
              <>
                <Separator className="bg-border/60" />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Product Details</h3>
                  <div className="prose prose-sm prose-invert max-w-none">
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{product.description}</p>
                  </div>
                </div>
              </>
            )}

            {product.activationInstructions && (
              <>
                <Separator className="bg-border/60" />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Activation Instructions</h3>
                  <div className="p-4 rounded-lg bg-muted/40 border border-border/50 text-sm text-muted-foreground leading-relaxed whitespace-pre-line font-mono">
                    {product.activationInstructions}
                  </div>
                </div>
              </>
            )}

            <Separator className="bg-border/60" />

            {/* Features */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Zap, label: "Instant delivery" },
                { icon: Shield, label: "Secure payment" },
                { icon: Clock, label: "Sent via email" },
                { icon: Package, label: "Genuine key" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon className="w-3.5 h-3.5 text-primary/60 shrink-0" />
                  {label}
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="flex flex-col gap-3 pt-1">
              {!product.stripePriceId ? (
                <div className="rounded-lg bg-muted/50 border border-border p-4 text-sm text-muted-foreground text-center">
                  Online checkout not available for this product.<br />
                  <span className="text-xs mt-1 block">Contact seller to purchase.</span>
                </div>
              ) : (
                <>
                  <Button
                    size="lg"
                    className="w-full text-base font-semibold h-12"
                    disabled={!canBuy || checkoutMutation.isPending}
                    onClick={() => canBuy && checkoutMutation.mutate(product.id)}
                  >
                    {checkoutMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Redirecting to checkout…
                      </>
                    ) : !inStock ? (
                      "Out of Stock"
                    ) : (
                      <>
                        <Shield className="w-4 h-4 mr-2" />
                        Buy Now — {formatPrice(product.price)}
                      </>
                    )}
                  </Button>
                  {checkoutMutation.isError && (
                    <p className="text-sm text-red-400 text-center">
                      {checkoutMutation.error instanceof Error
                        ? checkoutMutation.error.message
                        : "Checkout failed. Please try again."}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground text-center">
                    Powered by Stripe · Your key arrives by email immediately after payment
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

import { setBaseUrl, customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ShoppingCart, Package, Zap, Shield, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
  availableKeyCount: number;
}

function formatPrice(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function ProductCard({ product }: { product: PublicProduct }) {
  const inStock = product.availableKeyCount > 0;
  return (
    <Link href={`/product/${product.slug}`}>
      <div className="group relative flex flex-col bg-card border border-card-border rounded-xl overflow-hidden hover:border-primary/40 transition-all duration-200 cursor-pointer hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5">
        {/* Image */}
        <div className="relative aspect-video bg-muted flex items-center justify-center overflow-hidden">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Package className="w-10 h-10 opacity-30" />
              <span className="text-xs">Digital Product</span>
            </div>
          )}
          {product.category && (
            <div className="absolute top-3 left-3">
              <Badge variant="secondary" className="text-xs font-medium bg-background/80 backdrop-blur-sm border-border">
                {product.category}
              </Badge>
            </div>
          )}
          {!inStock && (
            <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
              <Badge variant="destructive" className="text-sm px-3 py-1">Out of Stock</Badge>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 p-5 gap-3">
          <div className="flex-1">
            <h3 className="font-semibold text-foreground text-base leading-snug group-hover:text-primary transition-colors">
              {product.name}
            </h3>
            {product.shortDescription && (
              <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                {product.shortDescription}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border/60">
            <span className="text-xl font-bold text-foreground">
              {formatPrice(product.price)}
            </span>
            <div className="flex items-center gap-1.5">
              {inStock ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  In Stock
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Unavailable</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function ProductCardSkeleton() {
  return (
    <div className="flex flex-col bg-card border border-card-border rounded-xl overflow-hidden">
      <Skeleton className="aspect-video w-full" />
      <div className="p-5 flex flex-col gap-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <div className="flex justify-between pt-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
    </div>
  );
}

export default function StorePage() {
  const { data: products, isLoading, error } = useQuery<PublicProduct[]>({
    queryKey: ["public-products"],
    queryFn: async () => {
      return customFetch<PublicProduct[]>("/products/public");
    },
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold text-foreground tracking-tight">KeyVault</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Shield className="w-3.5 h-3.5" />
            Instant delivery
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-primary/5 via-background to-background border-b border-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-xs text-primary font-medium mb-6">
            <Zap className="w-3.5 h-3.5" />
            Instant digital delivery
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
            Software Keys &<br />
            <span className="text-primary">Digital Licenses</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Purchase and receive your license key instantly. No waiting, no hassle — delivered straight to your inbox.
          </p>
        </div>
        {/* Subtle grid background */}
        <div className="absolute inset-0 -z-10 opacity-[0.02]"
          style={{ backgroundImage: "radial-gradient(circle, hsl(199 89% 48%) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
      </section>

      {/* Features strip */}
      <div className="border-b border-border/40 bg-card/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap gap-6 justify-center sm:justify-between">
          {[
            { icon: Zap, label: "Instant delivery after payment" },
            { icon: Shield, label: "Secure Stripe checkout" },
            { icon: Package, label: "Genuine license keys" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="w-4 h-4 text-primary/70 shrink-0" />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Products */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        {error ? (
          <div className="text-center py-16 text-muted-foreground">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Unable to load products</p>
            <p className="text-sm mt-1">Please try again later.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Available Products</h2>
                {!isLoading && products && (
                  <p className="text-sm text-muted-foreground mt-0.5">{products.length} product{products.length !== 1 ? "s" : ""} available</p>
                )}
              </div>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)}
              </div>
            ) : products && products.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {products.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>
            ) : (
              <div className="text-center py-20 text-muted-foreground">
                <Package className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p className="font-medium text-lg">No products available</p>
                <p className="text-sm mt-1">Check back soon for new listings.</p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="w-3.5 h-3.5 text-primary/60" />
            <span className="font-medium text-foreground">KeyVault</span>
            <span>— Instant digital delivery</span>
          </div>
          <p className="text-xs text-muted-foreground">All sales final. Keys delivered via email within minutes.</p>
        </div>
      </footer>
    </div>
  );
}

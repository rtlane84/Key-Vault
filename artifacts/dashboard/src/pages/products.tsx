import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Package, Plus, Key } from "lucide-react";
import {
  useListProducts,
  useCreateProduct,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function AddProductDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [ebayListingId, setEbayListingId] = useState("");
  const [description, setDescription] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createProduct = useCreateProduct();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createProduct.mutateAsync({
        data: {
          name,
          sku,
          slug: slugify(name),
          price: parseFloat(price),
          ebayListingId: ebayListingId || undefined,
          description: description || undefined,
        },
      });
      toast({ title: "Product created" });
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      setOpen(false);
      setName(""); setSku(""); setPrice(""); setEbayListingId(""); setDescription("");
    } catch {
      toast({ title: "Failed to create product", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-2" />Add Product</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Product</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label htmlFor="name">Product Name</Label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} required placeholder="Windows 11 Pro" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sku">SKU</Label>
            <Input id="sku" value={sku} onChange={e => setSku(e.target.value)} required placeholder="WIN-PRO-2024" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="price">Price (USD)</Label>
            <Input id="price" type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} required placeholder="29.99" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="listing">eBay Listing ID</Label>
            <Input id="listing" value={ebayListingId} onChange={e => setEbayListingId(e.target.value)} placeholder="123456789" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="desc">Description</Label>
            <Input id="desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
          </div>
          <Button type="submit" className="w-full" disabled={createProduct.isPending}>
            {createProduct.isPending ? "Creating..." : "Create Product"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsPage() {
  const { data: products, isLoading } = useListProducts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Products</h1>
        <AddProductDialog />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : !products || products.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">No products yet. Add your first product to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {products.map((product) => (
            <Card key={product.id} className="hover:border-primary/40 transition-colors">
              <CardContent className="py-4 px-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <Package className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold">{product.name}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      SKU: {product.sku}
                      {product.ebayListingId && <span className="ml-3">eBay: {product.ebayListingId}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono text-sm">
                        <span className={product.availableKeyCount === 0 ? "text-destructive font-bold" : "text-primary font-semibold"}>
                          {product.availableKeyCount}
                        </span>
                        <span className="text-muted-foreground"> / {product.totalKeyCount}</span>
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">available keys</div>
                  </div>
                  {product.availableKeyCount === 0 && (
                    <Badge variant="destructive" className="text-xs">No Keys</Badge>
                  )}
                  <Link href={`/products/${product.id}`}>
                    <Button variant="outline" size="sm">Manage</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

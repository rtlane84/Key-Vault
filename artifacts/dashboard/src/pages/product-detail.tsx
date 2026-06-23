import { useState } from "react";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Key, Trash2, Edit } from "lucide-react";
import {
  useGetProduct,
  useUpdateProduct,
  useListKeys,
  useImportKeys,
  useDeleteKey,
  getListKeysQueryKey,
  getGetProductQueryKey,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

function EditProductDialog({ product }: { product: any }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku);
  const [price, setPrice] = useState((product.price / 100).toString());
  const [stripePriceId, setStripePriceId] = useState(product.stripePriceId || "");
  const [ebayListingId, setEbayListingId] = useState(product.ebayListingId || "");
  const [imageUrl, setImageUrl] = useState(product.imageUrl || "");
  const [activationInstructions, setActivationInstructions] = useState(product.activationInstructions || "");
  const [description, setDescription] = useState(product.description || "");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateProduct = useUpdateProduct();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProduct.mutateAsync({
        id: product.id,
        data: {
          name,
          sku,
          price: Math.round(parseFloat(price) * 100),
          stripePriceId: stripePriceId || null,
          ebayListingId: ebayListingId || null,
          imageUrl: imageUrl || null,
          activationInstructions: activationInstructions || null,
          description: description || null,
        },
      });
      toast({ title: "Product updated" });
      queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(product.id) });
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      setOpen(false);
    } catch {
      toast({ title: "Failed to update product", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Edit className="h-4 w-4 mr-2" />Edit Product</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label htmlFor="edit-name">Product Name</Label>
            <Input id="edit-name" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-sku">SKU</Label>
            <Input id="edit-sku" value={sku} onChange={e => setSku(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-price">Price (USD)</Label>
            <Input id="edit-price" type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-stripePriceId">Stripe Price ID</Label>
            <Input id="edit-stripePriceId" value={stripePriceId} onChange={e => setStripePriceId(e.target.value)} placeholder="price_..." />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-listing">eBay Listing ID</Label>
            <Input id="edit-listing" value={ebayListingId} onChange={e => setEbayListingId(e.target.value)} placeholder="123456789" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-imageUrl">Product Image URL</Label>
            <Input id="edit-imageUrl" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-activation">Activation Instructions</Label>
            <Textarea 
              id="edit-activation" 
              value={activationInstructions} 
              onChange={e => setActivationInstructions(e.target.value)} 
              placeholder="How to use the key..."
              rows={3}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-desc">Description</Label>
            <Input id="edit-desc" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={updateProduct.isPending}>
            {updateProduct.isPending ? "Updating..." : "Update Product"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const productId = parseInt(id ?? "0", 10);
  const [keysBulk, setKeysBulk] = useState("");

  const { data: product, isLoading: productLoading } = useGetProduct(productId, {
    query: { enabled: !!productId, queryKey: getGetProductQueryKey(productId) },
  });
  const { data: keys, isLoading: keysLoading } = useListKeys(
    { productId },
    { query: { enabled: !!productId, queryKey: getListKeysQueryKey({ productId }) } }
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const importKeys = useImportKeys();
  const deleteKey = useDeleteKey();

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = keysBulk.split("\n").map((k) => k.trim()).filter(Boolean);
    if (!lines.length) return;
    try {
      const result = await importKeys.mutateAsync({
        data: { productId, keys: lines },
      });
      toast({ title: `Imported ${result.imported} keys (${result.skipped} skipped as duplicates)` });
      queryClient.invalidateQueries({ queryKey: getListKeysQueryKey({ productId }) });
      queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      setKeysBulk("");
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    }
  };

  const handleDeleteKey = async (keyId: number) => {
    try {
      await deleteKey.mutateAsync({ id: keyId });
      toast({ title: "Key deleted" });
      queryClient.invalidateQueries({ queryKey: getListKeysQueryKey({ productId }) });
      queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
    } catch {
      toast({ title: "Failed to delete key", variant: "destructive" });
    }
  };

  if (productLoading) return <div className="text-muted-foreground text-sm">Loading...</div>;
  if (!product) return <div className="text-destructive text-sm">Product not found.</div>;

  const statusColor = {
    available: "bg-primary/10 text-primary border-primary/20",
    assigned: "bg-muted text-muted-foreground border-border",
    failed: "bg-destructive/10 text-destructive border-destructive/20",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/products">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Products</Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{product.name}</h1>
        <div className="ml-auto">
          <EditProductDialog product={product} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground mb-1">SKU</div>
            <div className="font-mono font-semibold">{product.sku}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground mb-1">Stripe Price ID</div>
            <div className="font-mono font-semibold">{product.stripePriceId ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground mb-1">eBay Listing ID</div>
            <div className="font-mono font-semibold">{product.ebayListingId ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs text-muted-foreground mb-1">Available Keys</div>
            <div className={`text-2xl font-bold ${product.availableKeyCount === 0 ? "text-destructive" : "text-primary"}`}>
              {product.availableKeyCount}
              <span className="text-base font-normal text-muted-foreground"> / {product.totalKeyCount}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import License Keys</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleImport} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="keys">Paste keys — one per line</Label>
              <Textarea
                id="keys"
                value={keysBulk}
                onChange={(e) => setKeysBulk(e.target.value)}
                placeholder={"AAAA-1111-BBBB-2222\nCCCC-3333-DDDD-4444\n..."}
                rows={6}
                className="font-mono text-sm"
              />
            </div>
            <Button type="submit" disabled={importKeys.isPending || !keysBulk.trim()}>
              {importKeys.isPending ? "Importing..." : "Import Keys"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" /> License Keys
            <Badge variant="outline" className="ml-auto font-mono">{keys?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {keysLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !keys || keys.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">No keys added yet. Import keys above.</p>
          ) : (
            <div className="divide-y divide-border">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-3">
                    <Badge className={`text-xs border ${statusColor[key.status as keyof typeof statusColor] ?? ""}`}>
                      {key.status}
                    </Badge>
                    <span className="font-mono text-sm">{key.keyValue}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {key.assignedAt && (
                      <span className="text-xs text-muted-foreground">
                        Assigned {format(new Date(key.assignedAt), "MMM d, HH:mm")}
                      </span>
                    )}
                    {key.status === "available" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteKey(key.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

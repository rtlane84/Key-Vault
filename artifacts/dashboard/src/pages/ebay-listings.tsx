import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, RefreshCw, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useListEbayListings,
  useSyncEbayListings,
  useMapEbayListing,
  useListProducts,
  getListEbayListingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function EbayListingsPage() {
  const [search, setSearch] = useState("");
  const { data: listings, isLoading: listingsLoading } = useListEbayListings({});
  const { data: products } = useListProducts();
  const syncListings = useSyncEbayListings();
  const mapListing = useMapEbayListing();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSync = async () => {
    try {
      await syncListings.mutateAsync();
      toast({ title: "eBay listings refreshed" });
      queryClient.invalidateQueries({ queryKey: getListEbayListingsQueryKey({}) });
    } catch (err) {
      toast({ title: "Sync failed", variant: "destructive" });
    }
  };

  const handleMap = async (listingId: number, productId: string) => {
    try {
      await mapListing.mutateAsync({
        id: listingId,
        data: { productId: productId === "none" ? null : parseInt(productId, 10) },
      });
      toast({ title: "Mapping updated" });
      queryClient.invalidateQueries({ queryKey: getListEbayListingsQueryKey({}) });
    } catch {
      toast({ title: "Failed to update mapping", variant: "destructive" });
    }
  };

  const filteredListings = listings?.filter(l =>
    l.title.toLowerCase().includes(search.toLowerCase()) ||
    l.sku?.toLowerCase().includes(search.toLowerCase()) ||
    l.listingId.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">eBay Listings</h1>
        <Button onClick={handleSync} disabled={syncListings.isPending}>
          <RefreshCw className={cn("h-4 w-4 mr-2", syncListings.isPending && "animate-spin")} />
          Refresh Listings
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search listings by title, SKU, or ID..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4">
        {listingsLoading ? (
          <p className="text-muted-foreground text-sm">Loading listings...</p>
        ) : !filteredListings || filteredListings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No listings found.
            </CardContent>
          </Card>
        ) : (
          filteredListings.map((listing) => (
            <Card key={listing.id}>
              <CardContent className="py-4 flex items-center justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{listing.title}</div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground font-mono">
                    <span>ID: {listing.listingId}</span>
                    {listing.sku && <span>SKU: {listing.sku}</span>}
                    <Badge variant={listing.status === "active" ? "default" : "secondary"} className="h-4 px-1 text-[10px]">
                      {listing.status}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-64">
                    <Select
                      value={listing.productId?.toString() || "none"}
                      onValueChange={(val) => handleMap(listing.id, val)}
                    >
                      <SelectTrigger className={cn("h-9", !listing.productId && "border-yellow-500/50 bg-yellow-500/5")}>
                        <SelectValue placeholder="Map to product..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unmapped</SelectItem>
                        {products?.map(p => (
                          <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {listing.productId ? (
                    <Badge variant="outline" className="text-primary border-primary/20 bg-primary/5">Mapped</Badge>
                  ) : (
                    <Badge variant="outline" className="text-yellow-500 border-yellow-500/20 bg-yellow-500/5">Unmapped</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

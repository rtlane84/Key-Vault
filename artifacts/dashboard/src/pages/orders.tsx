import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ShoppingCart, Plus, RefreshCw } from "lucide-react";
import {
  useListOrders,
  useListProducts,
  useCreateOrder,
  useFulfillOrder,
  getListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// getDashboardStatsQueryKey is not exported — use the path key
const DASHBOARD_STATS_KEY = ["/api/dashboard/stats"];

function StatusBadge({ status }: { status: string }) {
  if (status === "fulfilled") return <Badge className="bg-primary/10 text-primary border-primary/20 border text-xs">Fulfilled</Badge>;
  if (status === "failed") return <Badge variant="destructive" className="text-xs">Failed</Badge>;
  return <Badge variant="outline" className="text-xs">Pending</Badge>;
}

function SourceBadge({ source }: { source: string }) {
  if (source === "ebay") return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 border text-xs">eBay</Badge>;
  if (source === "stripe") return <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/20 border text-xs">Stripe</Badge>;
  return <Badge variant="outline" className="text-xs">Manual</Badge>;
}

function NewOrderDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [productId, setProductId] = useState<string>("");
  const { data: products } = useListProducts();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createOrder = useCreateOrder();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createOrder.mutateAsync({
        data: { buyerEmail: email, buyerName: buyerName || undefined, productId: parseInt(productId, 10) },
      });
      toast({ title: "Order created and fulfilled" });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      queryClient.invalidateQueries({ queryKey: DASHBOARD_STATS_KEY });
      setOpen(false);
      setEmail(""); setBuyerName(""); setProductId("");
    } catch {
      toast({ title: "Failed to create order", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-2" />New Manual Order</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Manual Order</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label htmlFor="email">Buyer Email</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="buyer@example.com" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="buyer-name">Buyer Name (optional)</Label>
            <Input id="buyer-name" value={buyerName} onChange={e => setBuyerName(e.target.value)} placeholder="John Doe" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="product">Product</Label>
            <Select value={productId} onValueChange={setProductId} required>
              <SelectTrigger>
                <SelectValue placeholder="Select a product" />
              </SelectTrigger>
              <SelectContent>
                {products?.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} ({p.availableKeyCount} available)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" className="w-full" disabled={createOrder.isPending || !productId}>
            {createOrder.isPending ? "Processing..." : "Create & Fulfill"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fulfillOrder = useFulfillOrder();

  const params: { status?: "pending" | "fulfilled" | "failed"; source?: "manual" | "ebay" | "stripe" } = {};
  if (statusFilter !== "all") params.status = statusFilter as "pending" | "fulfilled" | "failed";
  if (sourceFilter !== "all") params.source = sourceFilter as "manual" | "ebay" | "stripe";

  const { data: orders, isLoading } = useListOrders(Object.keys(params).length ? params : undefined);

  const handleFulfill = async (orderId: number) => {
    try {
      await fulfillOrder.mutateAsync({ id: orderId });
      toast({ title: "Order fulfilled" });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      queryClient.invalidateQueries({ queryKey: DASHBOARD_STATS_KEY });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Fulfillment failed";
      toast({ title: msg, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
        <NewOrderDialog />
      </div>

      <div className="flex gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="fulfilled">Fulfilled</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="ebay">eBay</SelectItem>
            <SelectItem value="stripe">Stripe</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground text-sm">Loading...</div>
          ) : !orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <ShoppingCart className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No orders found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Order</th>
                  <th className="text-left px-4 py-3">Buyer</th>
                  <th className="text-left px-4 py-3">Product</th>
                  <th className="text-left px-4 py-3">Key</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <SourceBadge source={order.source} />
                        <span className="font-mono text-xs text-muted-foreground">#{order.id}</span>
                      </div>
                      {order.ebayOrderId && (
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">eBay: {order.ebayOrderId}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{order.buyerEmail}</div>
                      {order.buyerName && <div className="text-xs text-muted-foreground">{order.buyerName}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div>{order.productName ?? `Product #${order.productId}`}</div>
                    </td>
                    <td className="px-4 py-3">
                      {order.assignedKeyValue ? (
                        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{order.assignedKeyValue}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status} />
                      {order.failureReason && (
                        <div className="text-xs text-destructive mt-0.5 max-w-[180px] truncate" title={order.failureReason}>
                          {order.failureReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {format(new Date(order.createdAt), "MMM d, HH:mm")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(order.status === "failed" || order.status === "pending") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleFulfill(order.id)}
                          disabled={fulfillOrder.isPending}
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Fulfill
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

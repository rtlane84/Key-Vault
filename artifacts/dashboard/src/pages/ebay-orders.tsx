import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, RefreshCw, Mail } from "lucide-react";
import {
  useListOrders,
  useFulfillOrder,
  getListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function EbayOrdersPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fulfillOrder = useFulfillOrder();

  const params: any = { source: "ebay" };
  if (statusFilter !== "all") params.status = statusFilter;

  const { data: orders, isLoading } = useListOrders(params);

  const handleRetry = async (id: number) => {
    try {
      await fulfillOrder.mutateAsync({ id });
      toast({ title: "Fulfillment retried" });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    } catch (err: any) {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    }
  };

  const handleResend = async (id: number) => {
    try {
      await fulfillOrder.mutateAsync({ id });
      toast({ title: "Key email resent" });
    } catch (err: any) {
      toast({ title: "Resend failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">eBay Orders</h1>
      </div>

      <div className="flex items-center gap-4 bg-card p-4 rounded-lg border border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Status:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="paid">Paid (Pending)</SelectItem>
              <SelectItem value="fulfilled">Fulfilled</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading orders...</p>
        ) : !orders || orders.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <ShoppingCart className="h-8 w-8 mx-auto mb-3 opacity-20" />
              No eBay orders found matching filters.
            </CardContent>
          </Card>
        ) : (
          orders.map((order) => (
            <Card key={order.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="grid grid-cols-1 md:grid-cols-6 items-center">
                  <div className="p-4 md:col-span-2">
                    <div className="font-semibold text-sm">Order #{order.ebayOrderId || order.id}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{order.buyerEmail}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-1">
                      {format(new Date(order.createdAt), "MMM d, yyyy HH:mm")}
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Product</div>
                    <div className="text-sm font-medium truncate">{order.productName || `Product #${order.productId}`}</div>
                  </div>
                  <div className="p-4">
                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Status</div>
                    <div className="flex flex-col gap-1">
                      <Badge variant={order.status === "fulfilled" ? "default" : order.status === "failed" ? "destructive" : "outline"} className="w-fit text-[10px]">
                        {order.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="p-4 md:col-span-2 flex justify-end gap-2 pr-6">
                    {order.status === "failed" && (
                      <Button size="sm" variant="outline" onClick={() => handleRetry(order.id)} disabled={fulfillOrder.isPending}>
                        <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", fulfillOrder.isPending && "animate-spin")} />
                        Retry
                      </Button>
                    )}
                    {order.status === "fulfilled" && (
                      <Button size="sm" variant="outline" onClick={() => handleResend(order.id)} disabled={fulfillOrder.isPending}>
                        <Mail className="h-3.5 w-3.5 mr-1.5" />
                        Resend Key
                      </Button>
                    )}
                    <Button size="sm" variant="ghost">View</Button>
                  </div>
                </div>
                {order.failureReason && (
                  <div className="px-4 py-2 bg-destructive/5 border-t border-destructive/10 text-[11px] text-destructive">
                    Error: {order.failureReason}
                  </div>
                )}
                {order.assignedKeyValue && (
                  <div className="px-4 py-2 bg-primary/5 border-t border-primary/10 text-[11px] text-primary font-mono">
                    Key: {order.assignedKeyValue}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

import { cn } from "@/lib/utils";

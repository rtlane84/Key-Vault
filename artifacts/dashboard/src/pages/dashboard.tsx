import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, Key, ShoppingCart, RefreshCw } from "lucide-react";
import { useGetDashboardStats, useGetDashboardAlerts, useGetRecentActivity, useTriggerEbaySync, useTriggerMockSync } from "@workspace/api-client-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: alerts, isLoading: alertsLoading } = useGetDashboardAlerts();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity();
  const { toast } = useToast();
  
  const queryClient = useQueryClient();
  const syncEbay = useTriggerEbaySync();
  const syncMock = useTriggerMockSync();

  const handleSync = async () => {
    try {
      await syncEbay.mutateAsync();
      toast({ title: "Sync initiated" });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    } catch (err) {
      toast({ title: "Sync failed", variant: "destructive" });
    }
  };

  const handleMockSync = async () => {
    try {
      await syncMock.mutateAsync();
      toast({ title: "Mock sync completed" });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    } catch (err) {
      toast({ title: "Sync failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">System Overview</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleMockSync} disabled={syncMock.isPending}>
            <RefreshCw className="mr-2 h-4 w-4" /> Mock Sync
          </Button>
          <Button size="sm" onClick={handleSync} disabled={syncEbay.isPending}>
            <Activity className="mr-2 h-4 w-4" /> Run eBay Sync
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Available Keys</CardTitle>
            <Key className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.availableKeys ?? 0}</div>
            <p className="text-xs text-muted-foreground">out of {stats?.totalKeys ?? 0} total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Orders</CardTitle>
            <ShoppingCart className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pendingOrders ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fulfilled Orders</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.fulfilledOrders ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">eBay Status</CardTitle>
            <RefreshCw className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.ebayConnected ? <span className="text-green-500">Connected</span> : <span className="text-red-500">Disconnected</span>}
            </div>
            <p className="text-xs text-muted-foreground">Last sync: {stats?.lastSyncAt ? format(new Date(stats.lastSyncAt), "HH:mm:ss") : 'Never'}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {alertsLoading ? (
              <p>Loading...</p>
            ) : alerts && alerts.length > 0 ? (
              <div className="space-y-4">
                {alerts.map(alert => (
                  <div key={alert.id} className="flex items-start gap-3 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-destructive-foreground">{alert.message}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(alert.createdAt), "MMM d, HH:mm")}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 text-center border rounded-md border-dashed border-border bg-card">
                <p className="text-sm text-muted-foreground">No active alerts. Systems normal.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <p>Loading...</p>
            ) : activity && activity.length > 0 ? (
              <div className="space-y-4">
                {activity.map(item => (
                  <div key={item.id} className="flex justify-between items-center text-sm border-b border-border pb-2 last:border-0">
                    <div>
                      <p className="font-medium">{item.message}</p>
                      <p className="text-xs text-muted-foreground">{item.buyerEmail || item.productName}</p>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs">{format(new Date(item.createdAt), "HH:mm")}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No recent activity.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

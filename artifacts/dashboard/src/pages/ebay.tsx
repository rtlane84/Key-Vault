import { useEffect } from "react";
import { useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, RefreshCw, Link as LinkIcon, Unlink } from "lucide-react";
import {
  useGetEbayStatus,
  useGetEbayConnectUrl,
  useDisconnectEbay,
  useTriggerEbaySync,
  useTriggerMockSync,
  useListSyncLogs,
  getGetEbayStatusQueryKey,
  getListSyncLogsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const levelColor: Record<string, string> = {
  info: "text-primary",
  warn: "text-yellow-500",
  error: "text-destructive",
};

export default function EbayPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const justConnected = params.get("connected") === "1";

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: status, isLoading: statusLoading } = useGetEbayStatus();
  const { data: connectData } = useGetEbayConnectUrl();
  const { data: logs, isLoading: logsLoading } = useListSyncLogs({ limit: 30 });

  const disconnect = useDisconnectEbay();
  const syncEbay = useTriggerEbaySync();
  const syncMock = useTriggerMockSync();

  useEffect(() => {
    if (justConnected) {
      toast({ title: "eBay account connected successfully" });
      queryClient.invalidateQueries({ queryKey: getGetEbayStatusQueryKey() });
    }
  }, [justConnected]);

  const handleConnect = () => {
    if (connectData?.url && connectData.url !== "#mock-mode-no-ebay-credentials") {
      window.location.href = connectData.url;
    } else {
      toast({ title: "Mock mode — no eBay credentials configured", description: "Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to enable real OAuth", variant: "destructive" });
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync({});
      toast({ title: "eBay account disconnected" });
      queryClient.invalidateQueries({ queryKey: getGetEbayStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSyncLogsQueryKey() });
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    }
  };

  const handleSync = async () => {
    try {
      const result = await syncEbay.mutateAsync({});
      toast({ title: `Sync complete — ${result.keysAssigned} keys assigned` });
      queryClient.invalidateQueries({ queryKey: getGetEbayStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSyncLogsQueryKey() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const handleMockSync = async () => {
    try {
      const result = await syncMock.mutateAsync({});
      toast({ title: `Mock sync complete — ${result.keysAssigned} keys assigned, ${result.skipped} skipped` });
      queryClient.invalidateQueries({ queryKey: getGetEbayStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSyncLogsQueryKey() });
    } catch {
      toast({ title: "Mock sync failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">eBay Integration</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Connection Status
              {status?.mockMode && <Badge variant="outline" className="text-xs ml-auto">Mock Mode</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusLoading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  {status?.connected ? (
                    <CheckCircle className="h-6 w-6 text-primary" />
                  ) : (
                    <XCircle className="h-6 w-6 text-destructive" />
                  )}
                  <div>
                    <div className="font-semibold">{status?.connected ? "Connected" : "Not Connected"}</div>
                    {status?.sellerId && (
                      <div className="text-xs text-muted-foreground font-mono">Seller: {status.sellerId}</div>
                    )}
                    {status?.tokenExpiresAt && (
                      <div className="text-xs text-muted-foreground">
                        Token expires: {format(new Date(status.tokenExpiresAt), "MMM d, yyyy HH:mm")}
                      </div>
                    )}
                    {status?.lastSyncAt && (
                      <div className="text-xs text-muted-foreground">
                        Last sync: {format(new Date(status.lastSyncAt), "MMM d, HH:mm")}
                      </div>
                    )}
                  </div>
                </div>

                {status?.mockMode && !status.connected && (
                  <div className="p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-sm text-yellow-500">
                    Running in mock mode. Set <code className="font-mono text-xs bg-black/20 px-1 rounded">EBAY_CLIENT_ID</code> and <code className="font-mono text-xs bg-black/20 px-1 rounded">EBAY_CLIENT_SECRET</code> to enable real eBay OAuth.
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  {status?.connected ? (
                    <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnect.isPending}>
                      <Unlink className="h-4 w-4 mr-2" />Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" onClick={handleConnect}>
                      <LinkIcon className="h-4 w-4 mr-2" />Connect eBay Account
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manual Sync</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Trigger a sync to pull recent paid eBay orders and assign license keys automatically.
            </p>
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleSync}
                disabled={syncEbay.isPending || !status?.connected}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {syncEbay.isPending ? "Syncing..." : "Run eBay Sync"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleMockSync}
                disabled={syncMock.isPending}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {syncMock.isPending ? "Syncing..." : "Run Mock Sync"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Mock sync uses built-in fake orders and doesn't require an eBay connection.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sync Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {logsLoading ? (
            <div className="p-6 text-muted-foreground text-sm">Loading...</div>
          ) : !logs || logs.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No sync activity yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {logs.map((log) => (
                <div key={log.id} className="px-4 py-3 flex items-start gap-3">
                  <span className={`text-xs font-mono font-semibold uppercase w-10 flex-shrink-0 mt-0.5 ${levelColor[log.level] ?? "text-muted-foreground"}`}>
                    {log.level}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm">{log.message}</span>
                    {log.ebayOrderId && (
                      <span className="ml-2 text-xs text-muted-foreground font-mono">({log.ebayOrderId})</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {format(new Date(log.createdAt), "MMM d, HH:mm:ss")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

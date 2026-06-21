import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ListTree } from "lucide-react";
import { useListSyncLogs } from "@workspace/api-client-react";
import { format } from "date-fns";

const levelColor: Record<string, string> = {
  info: "bg-primary/10 text-primary border-primary/20",
  warn: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
};

const eventLabels: Record<string, string> = {
  sync_started: "Sync Started",
  sync_completed: "Sync Completed",
  order_processed: "Order Processed",
  key_assigned: "Key Assigned",
  key_send_failed: "Send Failed",
  no_key_available: "No Key",
  duplicate_skipped: "Duplicate",
  oauth_connected: "Connected",
  oauth_disconnected: "Disconnected",
};

export default function LogsPage() {
  const { data: logs, isLoading } = useListSyncLogs({ limit: 200 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Sync Logs</h1>
        {logs && (
          <Badge variant="outline" className="font-mono">{logs.length} entries</Badge>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground text-sm">Loading...</div>
          ) : !logs || logs.length === 0 ? (
            <div className="p-12 text-center">
              <ListTree className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No sync activity yet. Run a sync to see logs here.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3 w-28">Time</th>
                  <th className="text-left px-4 py-3 w-20">Level</th>
                  <th className="text-left px-4 py-3 w-32">Event</th>
                  <th className="text-left px-4 py-3">Message</th>
                  <th className="text-left px-4 py-3 w-36">eBay Order ID</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-border last:border-0 hover:bg-accent/20 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {format(new Date(log.createdAt), "MMM d, HH:mm:ss")}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={`text-xs border ${levelColor[log.level] ?? ""}`}>
                        {log.level}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono text-muted-foreground">
                        {eventLabels[log.event] ?? log.event}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{log.message}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                      {log.ebayOrderId ?? "—"}
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

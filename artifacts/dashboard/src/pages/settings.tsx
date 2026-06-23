import { useState, useEffect } from "react";
import { useGetMyTenant, useUpdateMyTenant, useStripeConnect } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Save, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const { toast } = useToast();
  const { data: tenant, isLoading } = useGetMyTenant();
  const updateTenant = useUpdateMyTenant();
  const stripeConnect = useStripeConnect();

  const [name, setName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [resendApiKey, setResendApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe_success")) {
      toast({
        title: "Stripe Connected",
        description: "Your Stripe account has been linked successfully.",
      });
      // Clear params
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("stripe_error")) {
      toast({
        variant: "destructive",
        title: "Stripe Connection Failed",
        description: "There was an error linking your Stripe account.",
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast]);

  useEffect(() => {
    if (tenant) {
      setName(tenant.name || "");
      setSupportEmail(tenant.supportEmail || "");
      setResendApiKey(tenant.resendApiKey || "");
      setFromEmail(tenant.fromEmail || "");
      setStripeSecretKey(tenant.stripeSecretKey || "");
      setStripeWebhookSecret(tenant.stripeWebhookSecret || "");
    }
  }, [tenant]);

  async function handleStripeConnect() {
    try {
      const response = await stripeConnect.mutateAsync();
      const url = (response as any).url;
      if (url) {
        window.location.href = url;
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err.message || "Failed to start Stripe connection.",
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateTenant.mutateAsync({
        data: {
          name,
          supportEmail,
          resendApiKey,
          fromEmail,
          stripeSecretKey,
          stripeWebhookSecret,
        },
      });
      toast({
        title: "Settings saved",
        description: "Your tenant settings have been updated successfully.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Error saving settings",
        description: err.message || "Failed to update settings.",
      });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your business information and integrations.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Business Information</CardTitle>
            <CardDescription>General settings for your storefront.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Business Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="supportEmail">Support Email</Label>
              <Input
                id="supportEmail"
                type="email"
                placeholder="support@yourstore.com"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Email address shown to customers for support requests.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email Delivery (Resend)</CardTitle>
            <CardDescription>Configure how your license keys are delivered via email.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="resendApiKey">Resend API Key</Label>
              <Input
                id="resendApiKey"
                type="password"
                placeholder="re_..."
                value={resendApiKey}
                onChange={(e) => setResendApiKey(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fromEmail">From Email</Label>
              <Input
                id="fromEmail"
                placeholder="Keys <keys@yourdomain.com>"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Must be a verified domain in your Resend account.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments (Stripe)</CardTitle>
            <CardDescription>Configure Stripe to accept payments on your storefront.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">Stripe Connect</p>
                  {tenant?.stripeUserId ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3 h-3" />
                      Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                      <AlertCircle className="w-3 h-3" />
                      Not Connected
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {tenant?.stripeUserId 
                    ? `Connected to Stripe (ID: ${tenant.stripeUserId})` 
                    : "Automatically link your Stripe account to receive payments."}
                </p>
              </div>
              <Button 
                type="button" 
                variant={tenant?.stripeUserId ? "outline" : "default"}
                onClick={handleStripeConnect}
                disabled={stripeConnect.isPending}
              >
                {stripeConnect.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <ExternalLink className="w-4 h-4 mr-2" />
                )}
                {tenant?.stripeUserId ? "Reconnect Stripe" : "Connect Stripe"}
              </Button>
            </div>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or manual configuration</span>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="stripeSecretKey">Stripe Secret Key</Label>
              <Input
                id="stripeSecretKey"
                type="password"
                placeholder="sk_live_..."
                value={stripeSecretKey}
                onChange={(e) => setStripeSecretKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Manual keys override Stripe Connect if both are provided.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="stripeWebhookSecret">Stripe Webhook Secret</Label>
              <Input
                id="stripeWebhookSecret"
                type="password"
                placeholder="whsec_..."
                value={stripeWebhookSecret}
                onChange={(e) => setStripeWebhookSecret(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={updateTenant.isPending}>
            {updateTenant.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Settings
          </Button>
        </div>
      </form>
    </div>
  );
}

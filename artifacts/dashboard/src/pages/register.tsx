import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useSellerRegister } from "@workspace/api-client-react";
import { isAuthenticated } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const register = useSellerRegister();

  useEffect(() => {
    if (isAuthenticated()) navigate("/");
  }, [navigate]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    // Auto-generate slug if not manually edited yet
    setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    try {
      await register.mutateAsync({ data: { email, password, name, slug } });
      setIsSuccess(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || "Registration failed. Please try again.";
      setErrorMsg(msg);
    }
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-sm border-border">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
            </div>
            <CardTitle>Registration Successful!</CardTitle>
            <CardDescription>
              Your account has been created. Redirecting to login...
            </CardDescription>
            <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <span className="font-bold text-xl tracking-tight">Key Ops</span>
        </div>

        <Card className="border-border">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Create an account</CardTitle>
            <CardDescription>Enter your details to start selling digital goods</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Business Name</Label>
                <Input
                  id="name"
                  placeholder="My Store"
                  value={name}
                  onChange={handleNameChange}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">Store URL Slug</Label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm">/store/</span>
                  <Input
                    id="slug"
                    placeholder="my-store"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  {errorMsg}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={register.isPending}>
                {register.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating account…
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
